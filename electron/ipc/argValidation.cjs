/**
 * TransTrack - IPC Argument Validation
 *
 * Two layers, applied by the IPC middleware in handlers.cjs:
 *
 *   1. Universal structural guards, applied to EVERY channel. These reject
 *      prototype-pollution keys, pathologically nested or oversized payloads,
 *      and non-serializable values. They are shape-agnostic, so they cannot
 *      reject a legitimate payload the app already supports.
 *
 *   2. Per-channel schemas, applied only to the channels listed in
 *      CHANNEL_SCHEMAS. A channel with no schema gets layer 1 only.
 *
 * DELIBERATE OMISSION — Epic / FHIR / HL7 channels:
 * `fhir:validate`, `hl7:parse`, `hl7:ingest`, `hl7:buildAck` and the EHR
 * entity channels intentionally have NO per-channel schema. Their payloads are
 * externally defined by Epic/HL7 and vary by resource type, message type, and
 * site configuration. Constraining them here would risk rejecting valid Epic
 * Connection Hub traffic. They still receive the universal guards in layer 1,
 * which is where the actual injection/pollution risk lives, and the handlers
 * themselves perform domain validation (validateFHIRData.cjs, hl7v2.cjs).
 *
 * HIPAA 164.312(c)(1) - Integrity
 */

'use strict';

// Generous ceilings: large enough for FHIR bundles and HL7 batch messages,
// small enough to stop a memory-exhaustion attempt from the renderer.
const MAX_SERIALIZED_BYTES = 8 * 1024 * 1024; // 8 MB per IPC call
const MAX_DEPTH = 64;
const MAX_OBJECT_KEYS = 4096;
const MAX_ARRAY_LENGTH = 100000;
const MAX_STRING_LENGTH = 4 * 1024 * 1024; // 4 MB single string

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class IpcValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IpcValidationError';
    this.isValidationError = true;
  }
}

/**
 * Walk a value enforcing the universal structural guards.
 * Throws IpcValidationError on the first violation.
 */
function assertStructurallySafe(value, path = 'arg', depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) {
    throw new IpcValidationError(`Invalid request: ${path} exceeds maximum nesting depth (${MAX_DEPTH})`);
  }

  if (value === null || value === undefined) return;

  const type = typeof value;

  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    throw new IpcValidationError(`Invalid request: ${path} has unsupported type "${type}"`);
  }

  if (type === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      throw new IpcValidationError(`Invalid request: ${path} string exceeds ${MAX_STRING_LENGTH} characters`);
    }
    return;
  }

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new IpcValidationError(`Invalid request: ${path} must be a finite number`);
    }
    return;
  }

  if (type === 'boolean') return;

  if (type !== 'object') return;

  // Cycles cannot survive structured cloning across IPC, but a fabricated
  // event in-process could still carry one; refuse rather than loop forever.
  if (seen.has(value)) {
    throw new IpcValidationError(`Invalid request: ${path} contains a circular reference`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw new IpcValidationError(`Invalid request: ${path} array exceeds ${MAX_ARRAY_LENGTH} entries`);
    }
    for (let i = 0; i < value.length; i += 1) {
      assertStructurallySafe(value[i], `${path}[${i}]`, depth + 1, seen);
    }
    return;
  }

  if (value instanceof Date) return;
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer) return;

  const keys = Object.keys(value);
  if (keys.length > MAX_OBJECT_KEYS) {
    throw new IpcValidationError(`Invalid request: ${path} has more than ${MAX_OBJECT_KEYS} keys`);
  }

  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new IpcValidationError(`Invalid request: ${path} contains forbidden key "${key}"`);
    }
    assertStructurallySafe(value[key], `${path}.${key}`, depth + 1, seen);
  }
}

/** Reject payloads whose serialized size would be unreasonable. */
function assertWithinSizeBudget(args) {
  let serialized;
  try {
    serialized = JSON.stringify(args);
  } catch {
    // Non-JSON-serializable content is caught by assertStructurallySafe.
    return;
  }
  if (serialized && Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new IpcValidationError(
      `Invalid request: payload exceeds the ${Math.floor(MAX_SERIALIZED_BYTES / (1024 * 1024))}MB IPC limit`
    );
  }
}

// --- per-channel schemas ---

const isString = (v) => typeof v === 'string';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isOptional = (v) => v === undefined || v === null;

/**
 * A schema is { name, check(args) -> true | string }. Returning a string
 * reports the reason for rejection.
 *
 * Only channels whose payload shape is fully owned by TransTrack appear here.
 * See the module header for why Epic/FHIR/HL7 channels are excluded.
 */
const CHANNEL_SCHEMAS = {
  'auth:login': (args) => {
    const [credentials] = args;
    if (!isPlainObject(credentials)) return 'credentials must be an object';
    if (!isString(credentials.email)) return 'email must be a string';
    if (!isString(credentials.password)) return 'password must be a string';
    if (credentials.email.length > 320) return 'email is too long';
    if (credentials.password.length > 1024) return 'password is too long';
    return true;
  },

  'auth:changePassword': (args) => {
    const [payload] = args;
    if (!isPlainObject(payload)) return 'payload must be an object';
    if (!isString(payload.newPassword)) return 'newPassword must be a string';
    if (payload.newPassword.length > 1024) return 'newPassword is too long';
    return true;
  },

  'entity:create': (args) => {
    const [entityName, data] = args;
    if (!isString(entityName)) return 'entityName must be a string';
    if (!isPlainObject(data)) return 'data must be an object';
    return true;
  },

  'entity:get': (args) => {
    const [entityName, id] = args;
    if (!isString(entityName)) return 'entityName must be a string';
    if (!isString(id)) return 'id must be a string';
    return true;
  },

  'entity:update': (args) => {
    const [entityName, id, data] = args;
    if (!isString(entityName)) return 'entityName must be a string';
    if (!isString(id)) return 'id must be a string';
    if (!isPlainObject(data)) return 'data must be an object';
    return true;
  },

  'entity:delete': (args) => {
    const [entityName, id] = args;
    if (!isString(entityName)) return 'entityName must be a string';
    if (!isString(id)) return 'id must be a string';
    return true;
  },

  'entity:list': (args) => {
    const [entityName, orderBy, limit] = args;
    if (!isString(entityName)) return 'entityName must be a string';
    if (!isOptional(orderBy) && !isString(orderBy)) return 'orderBy must be a string';
    if (!isOptional(limit) && !Number.isInteger(Number(limit))) return 'limit must be an integer';
    return true;
  },

  'entity:filter': (args) => {
    const [entityName, filters, orderBy, limit] = args;
    if (!isString(entityName)) return 'entityName must be a string';
    if (!isOptional(filters) && !isPlainObject(filters)) return 'filters must be an object';
    if (!isOptional(orderBy) && !isString(orderBy)) return 'orderBy must be a string';
    if (!isOptional(limit) && !Number.isInteger(Number(limit))) return 'limit must be an integer';
    return true;
  },

  'access:validateRequest': (args) => {
    const [permission, justification] = args;
    if (!isString(permission)) return 'permission must be a string';
    if (!isOptional(justification) && !isString(justification) && !isPlainObject(justification)) {
      return 'justification must be a string or object';
    }
    return true;
  },

  'file:exportCSV': (args) => {
    const [, filename] = args;
    if (!isOptional(filename) && !isString(filename)) return 'filename must be a string';
    return true;
  },

  'file:backupDatabase': (args) => {
    const [targetPath] = args;
    if (!isOptional(targetPath) && !isString(targetPath)) return 'path must be a string';
    return true;
  },

  'file:restoreDatabase': (args) => {
    const [targetPath] = args;
    if (!isString(targetPath)) return 'path must be a string';
    return true;
  },

  'settings:get': (args) => {
    const [key] = args;
    if (!isString(key)) return 'key must be a string';
    return true;
  },

  'settings:set': (args) => {
    const [key] = args;
    if (!isString(key)) return 'key must be a string';
    return true;
  },

  'esig:sign': (args) => {
    const [params] = args;
    if (!isPlainObject(params)) return 'params must be an object';
    if (!isString(params.meaning)) return 'meaning must be a string';
    if (!isString(params.entityType)) return 'entityType must be a string';
    if (!isString(params.entityId)) return 'entityId must be a string';
    return true;
  },

  'license:activate': (args) => {
    const [licenseWire] = args;
    if (!isString(licenseWire)) return 'license must be a string';
    return true;
  },
};

/**
 * Validate the arguments of one IPC call.
 * Throws IpcValidationError when the payload is rejected.
 */
function validateArgs(channel, args) {
  const list = Array.isArray(args) ? args : [];

  // Layer 1 — universal structural guards.
  assertWithinSizeBudget(list);
  for (let i = 0; i < list.length; i += 1) {
    assertStructurallySafe(list[i], `arg[${i}]`, 0, new WeakSet());
  }

  // Layer 2 — per-channel schema, when one is defined.
  const schema = CHANNEL_SCHEMAS[channel];
  if (schema) {
    const result = schema(list);
    if (result !== true) {
      throw new IpcValidationError(`Invalid request for ${channel}: ${result}`);
    }
  }

  return true;
}

function hasSchema(channel) {
  return Object.prototype.hasOwnProperty.call(CHANNEL_SCHEMAS, channel);
}

module.exports = {
  validateArgs,
  assertStructurallySafe,
  assertWithinSizeBudget,
  hasSchema,
  IpcValidationError,
  CHANNEL_SCHEMAS,
  MAX_SERIALIZED_BYTES,
  MAX_DEPTH,
  FORBIDDEN_KEYS,
};
