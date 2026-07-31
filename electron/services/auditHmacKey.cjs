/**
 * TransTrack - Audit Trail HMAC Key Management
 *
 * The audit trail already carries a SHA-256 hash chain, which detects a naive
 * edit of a single row. It does not stop an attacker who can write to the
 * database file: because the hash is unkeyed, they can recompute every
 * subsequent record_hash and produce a chain that verifies cleanly.
 *
 * This module supplies a 256-bit secret, held in OS secure storage
 * (DPAPI / Keychain / libsecret via Electron safeStorage), used to HMAC each
 * audit row. Forging the chain now additionally requires extracting the key
 * from the OS keystore under the installing user's account.
 *
 * The control is deliberately ADDITIVE:
 *   - Rows written before this feature have no HMAC and are skipped by the
 *     HMAC verifier; the SHA-256 chain still covers them.
 *   - If the key is unavailable (no keyring on a headless Linux box), audit
 *     writing continues without an HMAC rather than failing closed. Losing
 *     the audit trail entirely would be a worse outcome than losing one of
 *     two tamper-evidence layers, and getStatus() reports the degradation.
 *
 * KEY SOURCES — there is exactly one production source, the OS keyring:
 *
 *   1. TRANSTRACK_AUDIT_HMAC_KEY — TEST ONLY. Honoured only in an unpackaged
 *      build with NODE_ENV=test. In every other environment (production,
 *      staging, an unset NODE_ENV, any packaged build) the variable is ignored
 *      completely, a warning is logged, and getStatus().testOverrideRejected
 *      goes true so the health check can surface the misconfiguration. It is
 *      never a way to supply or to substitute a real installation's key.
 *   2. safeStorage-encrypted file at userData/.transtrack-audit-hmac — the
 *      production path.
 *   3. Unprotected 0600 hex file — only when the keyring is absent AND the
 *      environment is on the NON_KEYRING_ENVS allowlist. Never in a packaged
 *      build; unrecognised NODE_ENV values fail closed onto safeStorage. When
 *      neither (2) nor (3) is possible, no key is created at all rather than
 *      writing one an attacker could simply read.
 *
 * HIPAA 164.312(b)   - Audit Controls
 * HIPAA 164.312(c)(1) - Integrity
 * 21 CFR 11.10(a)/(e) - Record protection, audit trails
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let app, safeStorage;
try { ({ app, safeStorage } = require('electron')); } catch { /* plain Node / CI */ }

const KEY_FILENAME = '.transtrack-audit-hmac';
const KEY_BYTES = 32;
const TEST_KEY_ENV = 'TRANSTRACK_AUDIT_HMAC_KEY';
const HEX_KEY = /^[a-fA-F0-9]{64}$/;

/** Distinguishes "no key file on disk" from "a key file that yielded no key". */
const NO_KEY_FILE = Symbol('no_key_file');

/**
 * NODE_ENV values in which an audit key may live somewhere other than the OS
 * keyring. This is an allowlist rather than a deny list so that an unrecognised
 * value ('staging', 'preprod', 'qa', a typo) fails closed onto safeStorage.
 */
const NON_KEYRING_ENVS = new Set(['test', 'development', '', undefined]);

let cachedKey = null;
let cachedFailureReason = null;
// Sticky so getStatus() can surface a misconfiguration even after the keyring
// path succeeded and the rejection no longer affects the key in use.
let rejectedTestOverride = false;
let usingTestOverride = false;

/** Warn without taking a hard dependency on the Electron-only logger. */
function warn(message, meta) {
  try {
    // eslint-disable-next-line global-require
    const { logger } = require('./logger.cjs');
    logger.warn(message, meta);
    return;
  } catch { /* plain Node / CI — fall through */ }
  console.warn(`[auditHmacKey] ${message}`, meta ? JSON.stringify(meta) : '');
}

function isPackagedBuild() {
  try {
    return Boolean(app && app.isPackaged);
  } catch {
    return false;
  }
}

/**
 * Whether the TEST_KEY_ENV override may be honoured.
 *
 * Hard requirements, all of which must hold:
 *   - the build is not packaged (a shipped app can never be overridden)
 *   - NODE_ENV is exactly 'test'
 *   - TRANSTRACK_ALLOW_TEST_KEYS, if present at all, is exactly 'true'
 *
 * Anything else — production, staging, an unset NODE_ENV, a packaged build —
 * ignores the variable entirely and falls through to the OS keyring path.
 */
function isTestKeyOverrideAllowed() {
  if (isPackagedBuild()) return false;
  if (process.env.NODE_ENV !== 'test') return false;

  const explicitOptIn = process.env.TRANSTRACK_ALLOW_TEST_KEYS;
  if (explicitOptIn !== undefined && explicitOptIn !== 'true') return false;

  return true;
}

/**
 * Whether an audit key may be persisted outside OS secure storage.
 * Never in a packaged build, and never under an unrecognised NODE_ENV.
 */
function isUnprotectedKeyFileAllowed() {
  if (isPackagedBuild()) return false;
  return NON_KEYRING_ENVS.has(process.env.NODE_ENV);
}

function isSafeStorageAvailable() {
  try {
    return Boolean(
      safeStorage
      && typeof safeStorage.isEncryptionAvailable === 'function'
      && safeStorage.isEncryptionAvailable()
    );
  } catch {
    return false;
  }
}

function getKeyPath() {
  if (!app || typeof app.getPath !== 'function') return null;
  return path.join(app.getPath('userData'), KEY_FILENAME);
}

/**
 * Load the HMAC key, creating it on first use.
 * Returns a Buffer, or null when no key can be established.
 */
function getKey() {
  if (cachedKey) return cachedKey;

  // Test/CI override so the HMAC path is exercisable without an OS keyring.
  // Refused outside NODE_ENV=test so it can never become a way to supply — or
  // to learn — the audit key of a real installation.
  const override = process.env[TEST_KEY_ENV];
  if (override) {
    if (!isTestKeyOverrideAllowed()) {
      rejectedTestOverride = true;
      warn(
        `${TEST_KEY_ENV} is set but was IGNORED: it is a test-only override and ` +
        'requires NODE_ENV=test in an unpackaged build. The audit HMAC key will be ' +
        'taken from OS secure storage instead. Unset this variable.',
        { nodeEnv: process.env.NODE_ENV || '(unset)', packaged: isPackagedBuild() }
      );
    } else if (!/^[a-fA-F0-9]{64}$/.test(override)) {
      warn(`${TEST_KEY_ENV} is set but is not 64 hex characters; ignoring it.`);
    } else {
      usingTestOverride = true;
      cachedKey = Buffer.from(override, 'hex');
      return cachedKey;
    }
  }

  const keyPath = getKeyPath();
  if (!keyPath) {
    cachedFailureReason = 'no_user_data_path';
    return null;
  }

  try {
    const existing = loadExistingKey(keyPath);
    if (existing !== NO_KEY_FILE) return existing;

    // No key file yet — mint one.
    const newKey = crypto.randomBytes(KEY_BYTES);
    const hex = newKey.toString('hex');

    let payload;
    if (isSafeStorageAvailable()) {
      payload = safeStorage.encryptString(hex);
    } else if (isUnprotectedKeyFileAllowed()) {
      payload = Buffer.from(hex, 'utf8');
    } else {
      // No keyring and no permission to persist unprotected: fail closed rather
      // than write an audit key that anyone who can read the file can forge with.
      cachedFailureReason = 'safe_storage_unavailable';
      warn(
        'OS secure storage is unavailable, so no audit HMAC key was created. The ' +
        'SHA-256 audit chain still applies but the keyed tamper-evidence layer is ' +
        'inactive. Install/unlock a system keyring (libsecret on Linux).',
        { nodeEnv: process.env.NODE_ENV || '(unset)', packaged: isPackagedBuild() }
      );
      return null;
    }

    try {
      writeNewKeyFile(keyPath, payload);
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Another starter created the key between our open and this write. Its
        // key is authoritative — adopting it keeps both processes computing the
        // same HMACs, where overwriting would orphan the rows it already wrote.
        const raced = loadExistingKey(keyPath);
        return raced === NO_KEY_FILE ? null : raced;
      }
      throw err;
    }

    cachedKey = newKey;
    return cachedKey;
  } catch (err) {
    cachedFailureReason = `key_io_error:${err.code || 'unknown'}`;
    return null;
  }
}

/**
 * Read and validate the on-disk key, upgrading a legacy plaintext one.
 *
 * The file is opened once and read through that descriptor; there is
 * deliberately no exists()-then-open sequence, because ENOENT from the open
 * *is* the "no key yet" signal. That removes the window in which the checked
 * path could be swapped for a symlink or an attacker-chosen key before being
 * read (CWE-367, the pattern CodeQL reports as js/file-system-race).
 *
 * @returns {Buffer|null|Symbol} the key, null on a refusal/failure (with
 *   cachedFailureReason set), or NO_KEY_FILE when nothing is on disk yet.
 */
function loadExistingKey(keyPath) {
  const raw = readKeyBytes(keyPath);
  if (raw === null) return NO_KEY_FILE;

  let decryptFailed = false;

  if (isSafeStorageAvailable()) {
    try {
      const decrypted = safeStorage.decryptString(raw);
      if (HEX_KEY.test(decrypted)) {
        cachedKey = Buffer.from(decrypted, 'hex');
        return cachedKey;
      }
    } catch {
      // Not sealed by this keyring. It may be a legacy plaintext key from a
      // machine that had none, so fall through and try to adopt and re-seal
      // it rather than abandoning the key (which would leave every existing
      // audit row permanently HMAC-unverifiable).
      decryptFailed = true;
    }
  }

  // Legacy / no-keyring fallback: 0600 hex file.
  const asText = raw.toString('utf8').trim();
  if (HEX_KEY.test(asText)) {
    // An unprotected key file must never be honoured where the keyring is
    // the required store, otherwise copying that one file defeats the HMAC.
    if (!isUnprotectedKeyFileAllowed()) {
      cachedFailureReason = 'unprotected_key_file_refused';
      warn(
        'An unprotected audit HMAC key file was found but refused because this ' +
        'environment requires OS secure storage. Delete it and let the app mint ' +
        'a keyring-backed key.',
        { nodeEnv: process.env.NODE_ENV || '(unset)', packaged: isPackagedBuild() }
      );
      return null;
    }
    cachedKey = Buffer.from(asText, 'hex');
    // Upgrade to OS-protected storage now that a keyring is present. The key
    // in hand is already valid, so a failed upgrade is not an error.
    if (isSafeStorageAvailable()) {
      try {
        resealKeyFile(keyPath, safeStorage.encryptString(asText));
      } catch { /* keep the working plaintext key */ }
    }
    return cachedKey;
  }

  cachedFailureReason = decryptFailed ? 'key_decrypt_failed' : 'key_file_unrecognized';
  return null;
}

/**
 * Read the key file's bytes, or null when it does not exist.
 *
 * The descriptor is closed before returning: Windows refuses to rename over a
 * file that still has an open handle, which would silently defeat the re-seal
 * upgrade in loadExistingKey().
 *
 * Read-only access, because the production path never rewrites this file and
 * requesting write would fail needlessly on a key an operator has hardened.
 */
function readKeyBytes(keyPath) {
  let fd;
  try {
    fd = fs.openSync(keyPath, 'r');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return fs.readFileSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * Create the key file atomically.
 *
 * 'wx' is O_CREAT|O_EXCL|O_WRONLY, so the create fails with EEXIST rather than
 * truncating a key another process just wrote, and the 0600 mode is applied by
 * the open itself rather than in a separate chmod window.
 */
function writeNewKeyFile(keyPath, payload) {
  const fd = fs.openSync(keyPath, 'wx', 0o600);
  try {
    fs.writeSync(fd, payload, 0, payload.length, 0);
    fs.fsyncSync(fd);
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * Replace the key file's contents with `payload`.
 *
 * Writes a fresh 0600 temp file and renames it over the target. Truncating the
 * real file in place would be faster but a crash between the truncate and the
 * write would leave an empty file and lose the key permanently, making every
 * existing audit row HMAC-unverifiable. rename() is atomic, so the file is
 * either the old key or the new one and never a partial write.
 */
function resealKeyFile(keyPath, payload) {
  const tempPath = `${keyPath}.reseal-${crypto.randomBytes(8).toString('hex')}`;
  try {
    writeNewKeyFile(tempPath, payload);
    fs.renameSync(tempPath, keyPath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* nothing to clean up */ }
    throw err;
  }
}

/**
 * Compute the HMAC for one audit row.
 * `canonical` must be the exact string the SHA-256 chain hashed, so both
 * layers cover identical content.
 * Returns a hex digest, or null when no key is available.
 */
function computeAuditHmac(canonical) {
  const key = getKey();
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(canonical).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 */
function hmacMatches(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  if (expected.length !== actual.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  } catch {
    return false;
  }
}

function getStatus() {
  const available = Boolean(getKey());
  return {
    available,
    osProtected: isSafeStorageAvailable(),
    reason: available ? null : cachedFailureReason,
    // True when the key in use came from the test-only override. Should never
    // be true anywhere but a test run.
    testOverrideInUse: usingTestOverride,
    // True when the override was set and refused. Surfaced so the health check
    // can flag the misconfiguration instead of leaving it in the logs only.
    testOverrideRejected: rejectedTestOverride,
  };
}

/** Test seam: drop the cached key so a new environment can be exercised. */
function _resetForTests() {
  cachedKey = null;
  cachedFailureReason = null;
  rejectedTestOverride = false;
  usingTestOverride = false;
}

module.exports = {
  computeAuditHmac,
  hmacMatches,
  getStatus,
  isSafeStorageAvailable,
  isTestKeyOverrideAllowed,
  isUnprotectedKeyFileAllowed,
  TEST_KEY_ENV,
  _resetForTests,
};
