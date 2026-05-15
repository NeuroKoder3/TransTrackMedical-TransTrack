/**
 * TransTrack — Field-level secret encryption.
 *
 * AES-256-GCM with HKDF-SHA256-derived keys. Used for column-level
 * protection of small secrets that are also stored inside the SQLCipher
 * database (defense-in-depth — an attacker who exfiltrates the .db file
 * plus the .transtrack-key on disk still has to derive the field key,
 * which is bound to a non-exported app-level secret).
 *
 * Wire format:
 *   enc:v1:<base64url-iv>:<base64url-ciphertext-with-tag>
 *
 * Where the ciphertext is exactly: <encrypted_bytes>||<16-byte auth tag>.
 *
 * Backward compatibility:
 *   Values that do not begin with `enc:v1:` are treated as legacy
 *   plaintext and returned as-is from decrypt(); call sites must always
 *   route through decryptField() to keep the legacy path transparent.
 *   The migration in electron/database/migrations.cjs re-encrypts every
 *   existing row on first run after upgrade.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const ENC_PREFIX = 'enc:v1:';

let _appSecretCached = null;

/**
 * The "field encryption master secret" is a 32-byte value derived from
 * the SQLCipher DEK if available, otherwise a dedicated file in
 * userData with mode 0o600 (and safeStorage-wrapped when possible).
 *
 * We deliberately do NOT read .transtrack-key directly here — the DEK
 * is rotated independently and we don't want field-level secrets to
 * silently re-encrypt every time the DB key rotates.
 *
 * Strategy: persist a dedicated 32-byte master in
 *   <userData>/.transtrack-field-key
 * protected by Electron's safeStorage when available.
 */
function _getMasterSecret() {
  if (_appSecretCached) return _appSecretCached;

  let userDataDir;
  try {
    // electron may be unavailable in tests; allow override via env
    if (process.env.TRANSTRACK_USERDATA_DIR) {
      userDataDir = process.env.TRANSTRACK_USERDATA_DIR;
    } else {
      const { app } = require('electron');
      userDataDir = app.getPath('userData');
    }
  } catch {
    // Fall back to a sibling of the cwd for tests
    userDataDir = path.join(process.cwd(), '.transtrack-test-userdata');
  }

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  const keyPath = path.join(userDataDir, '.transtrack-field-key');

  let safeStorage = null;
  try { ({ safeStorage } = require('electron')); } catch { /* not under electron */ }
  const safeAvailable = !!(safeStorage
    && typeof safeStorage.isEncryptionAvailable === 'function'
    && safeStorage.isEncryptionAvailable());

  function _readKey() {
    if (!fs.existsSync(keyPath)) return null;
    const raw = fs.readFileSync(keyPath);
    // Heuristic: 64 hex chars => legacy plaintext format; else safeStorage blob.
    const asText = raw.toString('utf8').trim();
    if (/^[a-fA-F0-9]{64}$/.test(asText)) {
      return Buffer.from(asText, 'hex');
    }
    if (safeAvailable) {
      try {
        const decrypted = safeStorage.decryptString(raw);
        if (/^[a-fA-F0-9]{64}$/.test(decrypted)) {
          return Buffer.from(decrypted, 'hex');
        }
      } catch { /* fall through */ }
    }
    return null;
  }

  function _writeKey(buf) {
    const hex = buf.toString('hex');
    if (safeAvailable) {
      fs.writeFileSync(keyPath, safeStorage.encryptString(hex), { mode: 0o600 });
    } else {
      fs.writeFileSync(keyPath, hex, { mode: 0o600 });
    }
    try { fs.chmodSync(keyPath, 0o600); } catch { /* windows */ }
  }

  let key = _readKey();
  if (!key) {
    key = crypto.randomBytes(KEY_LEN);
    _writeKey(key);
  } else if (safeAvailable) {
    // Upgrade legacy plaintext on-disk format to safeStorage-encrypted.
    const raw = fs.readFileSync(keyPath);
    const asText = raw.toString('utf8').trim();
    if (/^[a-fA-F0-9]{64}$/.test(asText)) {
      _writeKey(key);
    }
  }

  _appSecretCached = key;
  return key;
}

/**
 * Derive a per-column subkey from the master via HKDF-SHA256. The label
 * lets us rotate one column's key independently in the future without
 * touching the master.
 */
function _deriveKey(label) {
  const master = _getMasterSecret();
  const salt = Buffer.from('transtrack-field-v1');
  const info = Buffer.from(label || 'default');
  return crypto.hkdfSync('sha256', master, salt, info, KEY_LEN);
}

/**
 * Encrypt a plaintext string. Returns the wire-format string; null/undefined
 * passes through unchanged so call sites don't need null guards.
 */
function encryptField(plaintext, label = 'default') {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  if (typeof plaintext !== 'string') {
    throw new TypeError('encryptField expects a string plaintext');
  }
  // Don't double-encrypt — idempotency makes migrations safe to re-run.
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext;

  const key = Buffer.from(_deriveKey(label));
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ivB64 = iv.toString('base64url');
  const ctB64 = Buffer.concat([ct, tag]).toString('base64url');
  return `${ENC_PREFIX}${ivB64}:${ctB64}`;
}

/**
 * Decrypt a wire-format string. If the value is null/empty or doesn't
 * carry the encryption prefix, it is returned as-is (legacy plaintext
 * compatibility). Throws on tampered ciphertext.
 */
function decryptField(value, label = 'default') {
  if (value === null || value === undefined || value === '') return value;
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;

  const parts = value.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted field format');
  }
  const iv = Buffer.from(parts[0], 'base64url');
  const blob = Buffer.from(parts[1], 'base64url');
  if (iv.length !== IV_LEN || blob.length < TAG_LEN + 1) {
    throw new Error('Invalid encrypted field payload');
  }
  const ct = blob.subarray(0, blob.length - TAG_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);

  const key = Buffer.from(_deriveKey(label));
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Inspect whether a stored value is already encrypted by this module.
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/**
 * Test seam: clear the cached master so unit tests can flip the
 * TRANSTRACK_USERDATA_DIR between runs.
 */
function _resetForTests() {
  _appSecretCached = null;
}

module.exports = {
  encryptField,
  decryptField,
  isEncrypted,
  ENC_PREFIX,
  _resetForTests,
};
