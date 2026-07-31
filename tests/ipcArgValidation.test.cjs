/**
 * TransTrack — IPC argument validation tests.
 *
 * Covers both layers of electron/ipc/argValidation.cjs:
 *
 *   Layer 1 (all channels): prototype-pollution keys, nesting depth, payload
 *   size, array/key counts, non-serializable values, circular references.
 *
 *   Layer 2 (listed channels): per-channel argument schemas.
 *
 * ALSO GUARDS THE EPIC CONNECTION HUB: a dedicated section asserts that
 * realistic FHIR R4 bundles and HL7 v2 messages pass validation untouched, so
 * this control can never start rejecting live Epic traffic. If someone later
 * adds a schema for the fhir: or hl7: channels, these tests fail loudly.
 *
 * Run standalone: node tests/ipcArgValidation.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const argValidation = require('../electron/ipc/argValidation.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

/** Describe a payload for assertion messages without throwing on BigInt/cycles. */
function describe(args) {
  try { return String(JSON.stringify(args)).slice(0, 80); }
  catch { return '<non-serializable payload>'; }
}

function assertRejected(channel, args, pattern) {
  assert.throws(
    () => argValidation.validateArgs(channel, args),
    (err) => {
      assert.strictEqual(err.isValidationError, true, 'must be an IpcValidationError');
      if (pattern) assert.ok(pattern.test(err.message), `message "${err.message}" must match ${pattern}`);
      return true;
    },
    `expected ${channel} to reject ${describe(args)}`
  );
}

function assertAccepted(channel, args) {
  assert.strictEqual(argValidation.validateArgs(channel, args), true);
}

// =============================================================================
console.log('\n=== Layer 1: universal structural guards ===');
// =============================================================================

test('rejects __proto__ keys anywhere in the payload', () => {
  assertRejected('anything:goes', [JSON.parse('{"__proto__":{"isAdmin":true}}')], /forbidden key/);
  assertRejected('anything:goes', [{ nested: JSON.parse('{"__proto__":{"x":1}}') }], /forbidden key/);
  assertRejected('anything:goes', [[JSON.parse('{"__proto__":{"x":1}}')]], /forbidden key/);
});

test('rejects constructor and prototype keys', () => {
  assertRejected('anything:goes', [{ constructor: { x: 1 } }], /forbidden key/);
  assertRejected('anything:goes', [{ prototype: { x: 1 } }], /forbidden key/);
});

test('prototype pollution does not leak into Object.prototype', () => {
  try { argValidation.validateArgs('x:y', [JSON.parse('{"__proto__":{"polluted":"yes"}}')]); } catch { /* expected */ }
  assert.strictEqual({}.polluted, undefined, 'Object.prototype must remain clean');
});

test('rejects payloads nested past the depth limit', () => {
  let deep = {};
  let cursor = deep;
  for (let i = 0; i < argValidation.MAX_DEPTH + 5; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assertRejected('anything:goes', [deep], /nesting depth/);
});

test('accepts payloads within the depth limit', () => {
  let ok = {};
  let cursor = ok;
  for (let i = 0; i < 20; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assertAccepted('anything:goes', [ok]);
});

test('rejects functions, symbols, and bigints', () => {
  assertRejected('anything:goes', [{ fn: () => {} }], /unsupported type "function"/);
  assertRejected('anything:goes', [{ sym: Symbol('x') }], /unsupported type "symbol"/);
  assertRejected('anything:goes', [{ big: BigInt(10) }], /unsupported type "bigint"/);
});

test('rejects NaN and Infinity', () => {
  assertRejected('anything:goes', [{ n: NaN }], /finite number/);
  assertRejected('anything:goes', [{ n: Infinity }], /finite number/);
});

test('rejects circular references', () => {
  const circular = { name: 'loop' };
  circular.self = circular;
  assertRejected('anything:goes', [circular], /circular reference/);
});

test('rejects payloads above the size budget', () => {
  const huge = 'a'.repeat(argValidation.MAX_SERIALIZED_BYTES + 1024);
  assertRejected('anything:goes', [{ blob: huge }], /IPC limit/);
});

test('rejects objects with too many keys', () => {
  const wide = {};
  for (let i = 0; i < 5000; i += 1) wide[`k${i}`] = 1;
  assertRejected('anything:goes', [wide], /more than .* keys/);
});

test('accepts null, undefined, primitives, dates, and buffers', () => {
  assertAccepted('anything:goes', [null]);
  assertAccepted('anything:goes', [undefined]);
  assertAccepted('anything:goes', ['a string', 42, true]);
  assertAccepted('anything:goes', [new Date()]);
  assertAccepted('anything:goes', [Buffer.from('abc')]);
});

test('accepts an empty argument list', () => {
  assertAccepted('anything:goes', []);
  assert.strictEqual(argValidation.validateArgs('anything:goes', undefined), true);
});

// =============================================================================
console.log('\n=== Layer 2: per-channel schemas ===');
// =============================================================================

test('auth:login requires string email and password', () => {
  assertAccepted('auth:login', [{ email: 'a@b.com', password: 'CorrectHorse1!' }]);
  assertRejected('auth:login', [], /credentials must be an object/);
  assertRejected('auth:login', ['not-an-object'], /credentials must be an object/);
  assertRejected('auth:login', [{ email: 1, password: 'x' }], /email must be a string/);
  assertRejected('auth:login', [{ email: 'a@b.com' }], /password must be a string/);
  assertRejected('auth:login', [{ email: 'a'.repeat(400), password: 'x' }], /email is too long/);
});

test('entity:create requires an entity name and object payload', () => {
  assertAccepted('entity:create', ['Patient', { first_name: 'A' }]);
  assertRejected('entity:create', [null, {}], /entityName must be a string/);
  assertRejected('entity:create', ['Patient', 'oops'], /data must be an object/);
  assertRejected('entity:create', ['Patient', ['array']], /data must be an object/);
});

test('entity:get and entity:delete require string ids', () => {
  assertAccepted('entity:get', ['Patient', 'p-1']);
  assertRejected('entity:get', ['Patient', 123], /id must be a string/);
  assertRejected('entity:delete', ['Patient', null], /id must be a string/);
});

test('entity:update requires name, id, and object data', () => {
  assertAccepted('entity:update', ['Patient', 'p-1', { notes: 'x' }]);
  assertRejected('entity:update', ['Patient', 'p-1', null], /data must be an object/);
});

test('entity:list and entity:filter accept optional ordering and limit', () => {
  assertAccepted('entity:list', ['Patient']);
  assertAccepted('entity:list', ['Patient', '-created_at', 100]);
  assertAccepted('entity:list', ['Patient', null, null]);
  assertRejected('entity:list', ['Patient', 5], /orderBy must be a string/);
  assertRejected('entity:list', ['Patient', '-created_at', 'lots'], /limit must be an integer/);
  assertAccepted('entity:filter', ['Patient', { waitlist_status: 'ACTIVE' }]);
  assertRejected('entity:filter', ['Patient', 'nope'], /filters must be an object/);
});

test('file:restoreDatabase requires a path string', () => {
  assertAccepted('file:restoreDatabase', ['C:/backups/x.db']);
  assertRejected('file:restoreDatabase', [], /path must be a string/);
  assertRejected('file:restoreDatabase', [{}], /path must be a string/);
});

test('esig:sign requires the Part 11 signature fields', () => {
  assertAccepted('esig:sign', [{ meaning: 'approved', entityType: 'Patient', entityId: 'p1' }]);
  assertRejected('esig:sign', [{ entityType: 'Patient', entityId: 'p1' }], /meaning must be a string/);
  assertRejected('esig:sign', [{ meaning: 'approved', entityId: 'p1' }], /entityType must be a string/);
});

test('license:activate requires a string license', () => {
  assertAccepted('license:activate', ['eyJ...']);
  assertRejected('license:activate', [{ wire: 'x' }], /license must be a string/);
});

test('settings channels require a string key', () => {
  assertAccepted('settings:get', ['theme']);
  assertAccepted('settings:set', ['theme', { mode: 'dark' }]);
  assertRejected('settings:set', [42, 'x'], /key must be a string/);
});

test('channels without a schema fall through to layer 1 only', () => {
  assert.strictEqual(argValidation.hasSchema('risk:getDashboard'), false);
  assertAccepted('risk:getDashboard', [{ anything: 'goes', nested: { deeply: [1, 2, 3] } }]);
});

// =============================================================================
console.log('\n=== Epic Connection Hub protection ===');
// =============================================================================

test('Epic / FHIR / HL7 channels have NO per-channel schema', () => {
  // A schema here would risk rejecting valid Epic Connection Hub payloads,
  // whose shapes are defined externally by Epic and HL7, not by TransTrack.
  const protectedChannels = [
    'fhir:validate',
    'hl7:parse',
    'hl7:ingest',
    'hl7:buildAck',
    'hl7:supportedEvents',
  ];
  for (const channel of protectedChannels) {
    assert.strictEqual(
      argValidation.hasSchema(channel), false,
      `${channel} must not have an argument schema — see argValidation.cjs header`
    );
  }
});

test('the real Epic FHIR demo bundle passes validation unchanged', () => {
  const bundlePath = path.join(__dirname, '..', 'sample-data', 'epic-fhir-bundle-demo.json');
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  assertAccepted('fhir:validate', [bundle]);
  // Confirm the payload really is substantial, so this is a meaningful check.
  assert.ok(JSON.stringify(bundle).length > 5000, 'demo bundle should be a realistic size');
});

test('a deeply nested FHIR resource is accepted', () => {
  const resource = {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: Array.from({ length: 250 }, (_, i) => ({
      fullUrl: `urn:uuid:res-${i}`,
      resource: {
        resourceType: 'Observation',
        id: `obs-${i}`,
        code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
        valueQuantity: { value: 13.4, unit: 'g/dL' },
        subject: { reference: 'Patient/erXuFYUfucBZaryVksYEcMg3' },
        extension: [{ url: 'http://example.org/x', valueCodeableConcept: { coding: [{ code: 'a' }] } }],
      },
    })),
  };
  assertAccepted('fhir:validate', [resource]);
});

test('a multi-segment HL7 v2 message is accepted', () => {
  const hl7 = [
    'MSH|^~\\&|EPIC|HOSP|TRANSTRACK|TC|20260730120000||ADT^A08|MSG00001|P|2.5.1',
    'EVN|A08|20260730120000',
    'PID|1||MRN-2026-10001^^^EPIC^MR||LOPEZ^CAMILA^MARIA||19870610|F|||123 Main St^^Madison^WI^53703',
    'PV1|1|I|ICU^101^A||||1234^SMITH^JOHN^^^^MD',
    'OBX|1|NM|718-7^Hemoglobin^LN||13.4|g/dL|12.0-16.0|N|||F',
    'OBX|2|NM|2160-0^Creatinine^LN||1.1|mg/dL|0.6-1.3|N|||F',
  ].join('\r');
  assertAccepted('hl7:parse', [hl7]);
  assertAccepted('hl7:ingest', [{ raw: hl7, source: 'EPIC_MLLP' }]);
});

test('a large HL7 batch stays under the size budget', () => {
  const segment = 'OBX|1|NM|718-7^Hemoglobin^LN||13.4|g/dL|12.0-16.0|N|||F\r';
  const batch = `MSH|^~\\&|EPIC|HOSP|TRANSTRACK|TC|20260730120000||ORU^R01|B1|P|2.5.1\r${segment.repeat(20000)}`;
  assert.ok(batch.length > 1_000_000, 'batch should exceed 1MB to be a real test');
  assertAccepted('hl7:parse', [batch]);
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
