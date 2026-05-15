/**
 * TransTrack — License verification orchestrator.
 *
 * Wraps the cryptographic verification from issuance.cjs with the
 * application-level checks every license has to pass:
 *
 *   1. Signature is valid (Ed25519 against the embedded publisher pubkey)
 *   2. Protocol version is supported by this build
 *   3. Not yet expired (or within a configurable grace period for soft expiry)
 *   4. The current machine's fingerprint is in the bound list (if any)
 *
 * The return shape is a discriminated union:
 *   { ok: true,  payload, status: 'active' | 'in_grace' }
 *   { ok: false, code, message, payload? }
 */

'use strict';

const { verifyLicense } = require('./issuance.cjs');
const { getMachineFingerprint, hashForBinding } = require('./machineId.cjs');

// Lazily read these so test harnesses can monkey-patch the publisher
// pubkey module after the verifier has already been required.
function _publisher() { return require('./publisherPublicKey.cjs'); }

// Soft-expiry grace: after expiresAt, the license keeps working for this many
// days but the UI shows a renewal warning. After grace, hard fail.
const SOFT_EXPIRY_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} wireLicense   The LIC1.* signed token
 * @param {object} [opts]
 * @param {number} [opts.nowMs]              clock override for tests
 * @param {string} [opts.machineId]          override machine id (tests)
 * @param {string} [opts.publicKeyOverride]  override publisher pubkey (tests)
 * @param {number} [opts.gracePeriodDays]    override soft-expiry grace
 */
function verify(wireLicense, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const pubKey = opts.publicKeyOverride ?? _publisher().PUBLIC_KEY_BASE64;
  const grace = opts.gracePeriodDays ?? SOFT_EXPIRY_GRACE_DAYS;

  let payload;
  try {
    payload = verifyLicense(wireLicense, pubKey);
  } catch (e) {
    return { ok: false, code: 'BAD_SIGNATURE', message: e.message };
  }

  // Protocol version gate — refuse to honor licenses signed under a
  // protocol revision newer than what this build understands.
  const expectedProto = _publisher().LICENSE_PROTOCOL_VERSION;
  if (payload.protocolVersion !== expectedProto) {
    return {
      ok: false,
      code: 'PROTOCOL_MISMATCH',
      message: `License protocol v${payload.protocolVersion} unsupported (this build accepts v${expectedProto}). Update the application.`,
      payload,
    };
  }

  // Expiry check.
  const expMs = Date.parse(payload.expiresAt);
  if (Number.isFinite(expMs) && nowMs > expMs + grace * DAY_MS) {
    return {
      ok: false,
      code: 'EXPIRED',
      message: `License expired on ${payload.expiresAt}. Contact your account manager to renew.`,
      payload,
    };
  }
  const inGrace = Number.isFinite(expMs) && nowMs > expMs;

  // Machine binding. Empty/missing machineBindings means "any machine"
  // (used by site licenses). A non-empty list must include this machine.
  if (Array.isArray(payload.machineBindings) && payload.machineBindings.length > 0) {
    const mid = opts.machineId ?? getMachineFingerprint();
    const myHash = hashForBinding(mid);
    if (!payload.machineBindings.includes(myHash)) {
      return {
        ok: false,
        code: 'NOT_BOUND_TO_MACHINE',
        message: 'This license is not activated for the current machine. Contact your administrator to re-bind or transfer the license.',
        payload,
      };
    }
  }

  return {
    ok: true,
    payload,
    status: inGrace ? 'in_grace' : 'active',
  };
}

module.exports = {
  verify,
  SOFT_EXPIRY_GRACE_DAYS,
};
