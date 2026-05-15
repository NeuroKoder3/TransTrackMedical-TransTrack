/**
 * TransTrack — License signing & verification primitives.
 *
 * Wire format:
 *   LIC1.<base64url(JSON payload)>.<base64url(Ed25519 signature over payload bytes)>
 *
 * The payload schema is documented in docs/LICENSING.md and is validated
 * by `parseLicensePayload()` below — every field is type-checked and
 * required.
 *
 * This module is used by:
 *   - scripts/issue-license.mjs       (SIGN — uses the private key)
 *   - electron/license/verifier.cjs   (VERIFY — uses the embedded pub key)
 *   - tests/license.test.cjs          (round-trip)
 */

'use strict';

const crypto = require('crypto');

const WIRE_PREFIX = 'LIC1.';
const SUPPORTED_TIERS = new Set(['evaluation', 'starter', 'professional', 'enterprise']);

/**
 * Validate the *shape* of a license payload (not the signature or expiry —
 * that's verifier.cjs's job). Throws on any structural problem.
 */
function validatePayloadShape(p) {
  if (!p || typeof p !== 'object') throw new Error('payload must be an object');
  if (typeof p.licenseId !== 'string' || p.licenseId.length < 8) throw new Error('licenseId required');
  if (!p.customer || typeof p.customer !== 'object') throw new Error('customer required');
  if (typeof p.customer.name !== 'string') throw new Error('customer.name required');
  if (typeof p.customer.email !== 'string') throw new Error('customer.email required');
  if (typeof p.customer.orgId !== 'string') throw new Error('customer.orgId required');
  if (!SUPPORTED_TIERS.has(p.tier)) throw new Error('tier must be one of: ' + [...SUPPORTED_TIERS].join(','));
  if (typeof p.issuedAt !== 'string' || isNaN(Date.parse(p.issuedAt))) throw new Error('issuedAt must be ISO-8601');
  if (typeof p.expiresAt !== 'string' || isNaN(Date.parse(p.expiresAt))) throw new Error('expiresAt must be ISO-8601');
  if (Date.parse(p.expiresAt) <= Date.parse(p.issuedAt)) throw new Error('expiresAt must be after issuedAt');
  if (p.maintenanceExpiresAt && (typeof p.maintenanceExpiresAt !== 'string' || isNaN(Date.parse(p.maintenanceExpiresAt)))) {
    throw new Error('maintenanceExpiresAt must be ISO-8601 if present');
  }
  if (!p.limits || typeof p.limits !== 'object') throw new Error('limits required');
  if (typeof p.limits.maxPatients !== 'number') throw new Error('limits.maxPatients required');
  if (typeof p.limits.maxUsers !== 'number') throw new Error('limits.maxUsers required');
  if (typeof p.limits.maxInstallations !== 'number') throw new Error('limits.maxInstallations required');
  if (!Array.isArray(p.features)) throw new Error('features must be an array');
  if (p.machineBindings && !Array.isArray(p.machineBindings)) throw new Error('machineBindings must be an array');
  if (typeof p.protocolVersion !== 'number') throw new Error('protocolVersion required');
}

function _b64uEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}
function _b64uDecode(s) {
  return Buffer.from(s, 'base64url');
}

/**
 * Sign a license payload with the given Ed25519 private key PEM.
 * Returns the wire-format string.
 */
function signLicense(payload, privateKeyPem) {
  validatePayloadShape(payload);
  const json = JSON.stringify(payload);
  const sig = crypto.sign(null, Buffer.from(json, 'utf8'), {
    key: privateKeyPem,
    format: 'pem',
    type: 'pkcs8',
  });
  return WIRE_PREFIX + _b64uEncode(json) + '.' + _b64uEncode(sig);
}

/**
 * Verify the wire-format string against the given Ed25519 public key.
 *
 * `publicKey` may be:
 *   - a 32-byte raw Ed25519 public key Buffer
 *   - a base64-encoded 32-byte raw public key string
 *   - a PEM-encoded SPKI string ("-----BEGIN PUBLIC KEY-----...")
 *
 * On success, returns the parsed payload object. On any failure (bad
 * format, bad signature, malformed payload) throws.
 */
function verifyLicense(wire, publicKey) {
  if (typeof wire !== 'string' || !wire.startsWith(WIRE_PREFIX)) {
    throw new Error('Not a TransTrack license: bad prefix');
  }
  const rest = wire.slice(WIRE_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 0) throw new Error('Malformed license: missing signature delimiter');
  const payloadB64 = rest.slice(0, dot);
  const sigB64 = rest.slice(dot + 1);
  const payloadBytes = _b64uDecode(payloadB64);
  const sigBytes = _b64uDecode(sigB64);

  if (sigBytes.length !== 64) throw new Error('Bad signature length');

  const keyObj = _toKeyObject(publicKey);

  const ok = crypto.verify(null, payloadBytes, keyObj, sigBytes);
  if (!ok) throw new Error('Signature verification failed');

  let parsed;
  try { parsed = JSON.parse(payloadBytes.toString('utf8')); }
  catch { throw new Error('Payload is not valid JSON'); }

  validatePayloadShape(parsed);
  return parsed;
}

/**
 * Accept a public key in raw, base64, or PEM form and return a Node KeyObject.
 */
function _toKeyObject(input) {
  if (input instanceof Buffer && input.length === 32) {
    return _rawEd25519PubToKey(input);
  }
  if (typeof input === 'string') {
    if (input.includes('BEGIN PUBLIC KEY')) {
      return crypto.createPublicKey({ key: input, format: 'pem' });
    }
    // Treat as base64 raw 32-byte
    const raw = Buffer.from(input, 'base64');
    if (raw.length !== 32) throw new Error('Public key must be 32 raw bytes (base64) or PEM SPKI');
    return _rawEd25519PubToKey(raw);
  }
  throw new Error('Unsupported public key form');
}

/**
 * Wrap a 32-byte raw Ed25519 public key into a Node KeyObject by
 * constructing the SPKI DER envelope: 30 2A 30 05 06 03 2B 65 70 03 21 00 ‖ key
 */
function _rawEd25519PubToKey(raw32) {
  const prefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const spki = Buffer.concat([prefix, raw32]);
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

module.exports = {
  WIRE_PREFIX,
  SUPPORTED_TIERS,
  signLicense,
  verifyLicense,
  validatePayloadShape,
  _toKeyObject,
};
