'use strict';

const crypto = require('crypto');
const {
  generateSecret: otplibGenerateSecret,
  generateSync,
  verifySync,
  generateURI,
} = require('otplib');
const QRCode = require('qrcode');

/**
 * TOTP (RFC 6238) helpers, plus AES-256-GCM encryption of the shared secret
 * at rest. The encryption key is derived from JWT_SECRET so existing
 * deployments do not require a separate key rotation pipeline; deployments
 * that need stronger separation should override deriveKey().
 *
 * Uses otplib v13 functional sync API (generateSync / verifySync).
 */

const TOTP_OPTIONS = {
  algorithm: 'sha1',
  digits: 6,
  period: 30,
  // Allow ±1 step drift for clock skew between client and server.
  window: { past: 1, future: 1 },
};

function deriveKey(masterSecret) {
  return crypto.createHash('sha256').update('mfa:v1:' + masterSecret).digest();
}

function encryptSecret(plaintext, masterSecret) {
  const iv = crypto.randomBytes(12);
  const key = deriveKey(masterSecret);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decryptSecret(buf, masterSecret) {
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);
  const key = deriveKey(masterSecret);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

function generateSecret() {
  // 20 bytes → 160-bit secret (above otplib v13's 16-byte minimum).
  return otplibGenerateSecret(20);
}

function verifyCode(secret, code) {
  if (!secret || !code) return false;
  try {
    const result = verifySync({
      secret,
      token: String(code).replace(/\s+/g, ''),
      ...TOTP_OPTIONS,
    });
    return !!(result && result.valid);
  } catch {
    return false;
  }
}

function buildOtpauthUrl({ secret, label, issuer }) {
  return generateURI({
    issuer: issuer || 'TransTrack',
    label: label || 'user',
    secret,
    ...TOTP_OPTIONS,
  });
}

async function buildQrCodeDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M' });
}

function generateRecoveryCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    codes.push(crypto.randomBytes(5).toString('hex').toUpperCase());
  }
  return codes;
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(code.toUpperCase().trim()).digest('hex');
}

/** Generate a current TOTP code (tests / admin tooling). */
function generateCode(secret) {
  return generateSync({ secret, ...TOTP_OPTIONS });
}

module.exports = {
  generateSecret,
  verifyCode,
  generateCode,
  buildOtpauthUrl,
  buildQrCodeDataUrl,
  generateRecoveryCodes,
  hashRecoveryCode,
  encryptSecret,
  decryptSecret,
};
