/**
 * Time-based One-Time Password (TOTP) MFA service.
 *
 * Per SRS TT-R004/005/006. Implements RFC 6238 TOTP (SHA-1, 30-second step,
 * 6-digit code) with no external runtime dependency. Backup codes are
 * single-use and stored as bcrypt hashes.
 *
 * The TOTP secret is encrypted at application layer using
 * `safeStorage.encryptString` when available, falling back to base64 if not
 * (development-mode only — production MUST run under Electron with a usable
 * keychain).
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');

let safeStorage = null;
try {
  // electron may not be present in unit tests; treat as optional
  ({ safeStorage } = require('electron'));
} catch { /* not running under electron */ }

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGO = 'sha1';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 10; // chars
const ISSUER = 'TransTrack';

// ---------------- Base32 (RFC 4648, no padding) ----------------

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

function base32Decode(str) {
  const cleaned = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of cleaned) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------- TOTP core ----------------

function generateSecretBase32(numBytes = 20) {
  return base32Encode(crypto.randomBytes(numBytes));
}

function hotp(keyBuffer, counter) {
  const counterBuf = Buffer.alloc(8);
  // bigint counter
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const hmac = crypto.createHmac(TOTP_ALGO, keyBuffer).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = (bin % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
  return code;
}

function totpCode(secretBase32, atSeconds = Math.floor(Date.now() / 1000)) {
  const counter = Math.floor(atSeconds / TOTP_PERIOD);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Verify a 6-digit code with ±1 step skew tolerance.
 */
function verifyCode(secretBase32, code, atSeconds = Math.floor(Date.now() / 1000)) {
  if (!code || !/^\d{6}$/.test(String(code))) return false;
  const counter = Math.floor(atSeconds / TOTP_PERIOD);
  const key = base32Decode(secretBase32);
  for (const offset of [-1, 0, 1]) {
    const expected = hotp(key, counter + offset);
    if (timingSafeEqualStr(expected, String(code))) return true;
  }
  return false;
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ---------------- Encryption at rest ----------------

function encryptSecret(secret) {
  if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
    return 'safe:' + safeStorage.encryptString(secret).toString('base64');
  }
  return 'b64:' + Buffer.from(secret, 'utf8').toString('base64');
}

function decryptSecret(stored) {
  if (!stored) throw new Error('No MFA secret stored');
  if (stored.startsWith('safe:')) {
    if (!safeStorage || !safeStorage.isEncryptionAvailable || !safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage unavailable; cannot decrypt MFA secret');
    }
    return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64'));
  }
  if (stored.startsWith('b64:')) {
    return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  }
  // legacy plaintext fallback
  return stored;
}

// ---------------- Backup codes ----------------

function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const limit = 256 - (256 % charset.length);
  const codes = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    while (s.length < BACKUP_CODE_LENGTH) {
      const buf = crypto.randomBytes(1);
      if (buf[0] < limit) {
        s += charset[buf[0] % charset.length];
      }
    }
    codes.push(s.slice(0, 5) + '-' + s.slice(5));
  }
  return codes;
}

// ---------------- Service API ----------------

function getMfaRecord(userId) {
  return getDatabase().prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId);
}

function isEnrolled(userId) {
  const r = getMfaRecord(userId);
  return !!(r && r.enabled);
}

/**
 * Begin enrollment: generate a fresh secret + provisioning URI, but do NOT
 * persist until verifyAndEnableEnrollment() is called with a valid code.
 */
function beginEnrollment({ userId, orgId, userEmail }) {
  if (!userId) throw new Error('userId required');
  if (!orgId) throw new Error('orgId required');
  if (!userEmail) throw new Error('userEmail required');
  const secret = generateSecretBase32(20);
  const label = encodeURIComponent(`${ISSUER}:${userEmail}`);
  const issuer = encodeURIComponent(ISSUER);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
  return { secret, otpauth, issuer: ISSUER, account: userEmail, algorithm: 'SHA1', digits: TOTP_DIGITS, period: TOTP_PERIOD };
}

/**
 * Confirm a pending enrollment by checking the user's first code, then
 * persist the encrypted secret and freshly issued backup codes.
 */
function verifyAndEnableEnrollment({ userId, orgId, secret, code }) {
  if (!verifyCode(secret, code)) {
    throw new Error('Invalid verification code');
  }
  const db = getDatabase();
  const stored = encryptSecret(secret);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_mfa_backup_codes WHERE user_id = ?').run(userId);
    db.prepare(`
      INSERT INTO user_mfa (user_id, org_id, secret_encrypted, enrolled_at, enabled)
      VALUES (?, ?, ?, datetime('now'), 1)
    `).run(userId, orgId, stored);

    const codes = generateBackupCodes();
    const insert = db.prepare(`
      INSERT INTO user_mfa_backup_codes (id, user_id, org_id, code_hash, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    for (const c of codes) {
      insert.run(uuidv4(), userId, orgId, bcrypt.hashSync(c, 10));
    }
    db.prepare(`UPDATE users SET mfa_required = 1 WHERE id = ?`).run(userId);
    return codes;
  });
  const codes = tx();
  return { enabled: true, backupCodes: codes };
}

/**
 * Verify a TOTP code OR a backup code for an already-enrolled user.
 * Backup codes are consumed (marked used_at = now).
 * Returns { ok: true, method: 'totp'|'backup' } or { ok: false }.
 */
function verifyChallenge({ userId, code }) {
  const rec = getMfaRecord(userId);
  if (!rec || !rec.enabled) {
    return { ok: false, reason: 'NOT_ENROLLED' };
  }

  // Try TOTP first
  if (/^\d{6}$/.test(String(code || ''))) {
    try {
      const secret = decryptSecret(rec.secret_encrypted);
      if (verifyCode(secret, code)) {
        getDatabase().prepare(`UPDATE user_mfa SET last_used_at = datetime('now') WHERE user_id = ?`).run(userId);
        return { ok: true, method: 'totp' };
      }
    } catch { /* fall through to backup */ }
  }

  // Try backup codes
  if (typeof code === 'string' && code.length >= 8) {
    const normalized = code.replace(/\s+/g, '').toUpperCase();
    const candidates = getDatabase().prepare(`
      SELECT id, code_hash FROM user_mfa_backup_codes
      WHERE user_id = ? AND used_at IS NULL
    `).all(userId);
    for (const c of candidates) {
      if (bcrypt.compareSync(normalized, c.code_hash)) {
        getDatabase().prepare(`UPDATE user_mfa_backup_codes SET used_at = datetime('now') WHERE id = ?`).run(c.id);
        return { ok: true, method: 'backup' };
      }
    }
  }

  return { ok: false, reason: 'INVALID_CODE' };
}

function disable({ userId }) {
  const db = getDatabase();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_mfa_backup_codes WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET mfa_required = 0 WHERE id = ?').run(userId);
  });
  tx();
  return { disabled: true };
}

function regenerateBackupCodes({ userId, orgId }) {
  const db = getDatabase();
  const codes = generateBackupCodes();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_mfa_backup_codes WHERE user_id = ?').run(userId);
    const insert = db.prepare(`
      INSERT INTO user_mfa_backup_codes (id, user_id, org_id, code_hash, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    for (const c of codes) {
      insert.run(uuidv4(), userId, orgId, bcrypt.hashSync(c, 10));
    }
  });
  tx();
  return { backupCodes: codes };
}

function getStatus(userId) {
  const rec = getMfaRecord(userId);
  if (!rec) return { enrolled: false, enabled: false };
  const remaining = getDatabase().prepare(`
    SELECT COUNT(*) AS n FROM user_mfa_backup_codes WHERE user_id = ? AND used_at IS NULL
  `).get(userId)?.n || 0;
  return {
    enrolled: true,
    enabled: !!rec.enabled,
    enrolledAt: rec.enrolled_at,
    lastUsedAt: rec.last_used_at,
    backupCodesRemaining: remaining,
  };
}

module.exports = {
  // primitives (exported for tests)
  base32Encode, base32Decode,
  generateSecretBase32, totpCode, verifyCode, hotp,
  generateBackupCodes,
  encryptSecret, decryptSecret,
  // service API
  beginEnrollment, verifyAndEnableEnrollment, verifyChallenge,
  isEnrolled, getMfaRecord, getStatus, disable, regenerateBackupCodes,
  // constants
  TOTP_PERIOD, TOTP_DIGITS, ISSUER,
};
