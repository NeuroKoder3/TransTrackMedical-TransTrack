/**
 * TransTrack — MFA primitive unit tests.
 *
 * Tests pure-function pieces of services/mfa.cjs (Base32, HOTP, TOTP,
 * code generation). The DB-backed enrollment flow is exercised separately
 * by the integration tests.
 *
 * Run with: node tests/mfa.test.cjs
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');

// Avoid loading electron at require time — the module only does an
// optional require('electron') and gracefully falls back when missing.
const mfa = require('../electron/services/mfa.cjs');

let PASS = 0;
let FAIL = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    PASS++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    FAIL++;
    failures.push({ name, error: e });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
  }
}

console.log('\n=== Base32 ===');

test('Base32 round-trips arbitrary bytes', () => {
  for (let i = 0; i < 50; i++) {
    const buf = crypto.randomBytes(1 + (i % 25));
    const enc = mfa.base32Encode(buf);
    const dec = mfa.base32Decode(enc);
    assert.deepStrictEqual([...dec], [...buf]);
  }
});

test('Base32 decodes case- and space-insensitive input', () => {
  const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const enc = mfa.base32Encode(buf);
  const lower = enc.toLowerCase().split('').join(' ');
  assert.deepStrictEqual([...mfa.base32Decode(lower)], [...buf]);
});

test('Base32 silently strips non-alphabet characters (tolerant decode)', () => {
  // Tolerant decode mirrors how authenticator apps tend to format secrets
  // (with spaces, dashes). An entirely invalid input decodes to empty.
  assert.strictEqual(mfa.base32Decode('!!!').length, 0);
  // Spaces and dashes inside an otherwise valid string are tolerated.
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]);
  const enc = mfa.base32Encode(buf);
  const formatted = enc.match(/.{1,2}/g).join(' - ');
  assert.deepStrictEqual([...mfa.base32Decode(formatted)], [...buf]);
});

console.log('\n=== HOTP / TOTP (RFC 6238 vectors) ===');

// RFC 6238 reference vectors with secret "12345678901234567890" (ASCII)
// Note: these vectors are SHA-1 only.
const RFC_SECRET_BASE32 = mfa.base32Encode(Buffer.from('12345678901234567890', 'ascii'));

const RFC_VECTORS = [
  { time: 59,          totp: '94287082' }, // 8-digit RFC vector
  { time: 1111111109,  totp: '07081804' },
  { time: 1111111111,  totp: '14050471' },
  { time: 1234567890,  totp: '89005924' },
  { time: 2000000000,  totp: '69279037' },
];

test('TOTP generates 6-digit numeric codes', () => {
  const code = mfa.totpCode(RFC_SECRET_BASE32, 0);
  assert.strictEqual(code.length, 6);
  assert.ok(/^\d{6}$/.test(code), `expected 6 digits, got ${code}`);
});

// We compare the lower 6 digits to the reference 8-digit value
test('TOTP matches RFC 6238 SHA-1 reference (lower 6 digits)', () => {
  for (const v of RFC_VECTORS) {
    const code = mfa.totpCode(RFC_SECRET_BASE32, v.time);
    const expected = v.totp.slice(-6);
    assert.strictEqual(code, expected, `t=${v.time}: expected ${expected}, got ${code}`);
  }
});

test('verifyCode accepts current code', () => {
  const t = 1700000000;
  const code = mfa.totpCode(RFC_SECRET_BASE32, t);
  assert.strictEqual(mfa.verifyCode(RFC_SECRET_BASE32, code, t), true);
});

test('verifyCode accepts ±1 step skew (±30s)', () => {
  const t = 1700000000;
  const codePrev = mfa.totpCode(RFC_SECRET_BASE32, t - 30);
  const codeNext = mfa.totpCode(RFC_SECRET_BASE32, t + 30);
  assert.strictEqual(mfa.verifyCode(RFC_SECRET_BASE32, codePrev, t), true);
  assert.strictEqual(mfa.verifyCode(RFC_SECRET_BASE32, codeNext, t), true);
});

test('verifyCode rejects code from too far in the past', () => {
  const t = 1700000000;
  const stale = mfa.totpCode(RFC_SECRET_BASE32, t - 120);
  assert.strictEqual(mfa.verifyCode(RFC_SECRET_BASE32, stale, t), false);
});

test('verifyCode rejects malformed input', () => {
  assert.strictEqual(mfa.verifyCode(RFC_SECRET_BASE32, '', 0), false);
  assert.strictEqual(mfa.verifyCode(RFC_SECRET_BASE32, '12345', 0), false);
  assert.strictEqual(mfa.verifyCode(RFC_SECRET_BASE32, 'abcdef', 0), false);
  assert.strictEqual(mfa.verifyCode(RFC_SECRET_BASE32, null, 0), false);
});

console.log('\n=== Backup codes ===');

test('Backup codes are unique 11-char strings (XXXXX-XXXXX)', () => {
  const codes = mfa.generateBackupCodes(20);
  assert.strictEqual(codes.length, 20);
  for (const c of codes) {
    assert.ok(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c), `bad backup code: ${c}`);
  }
  assert.strictEqual(new Set(codes).size, codes.length, 'backup codes not unique');
});

console.log('\n=== Encryption-at-rest fallback ===');

test('encryptSecret/decryptSecret round-trips when safeStorage unavailable', () => {
  const secret = mfa.generateSecretBase32();
  const stored = mfa.encryptSecret(secret);
  // Without electron loaded in this test we expect the b64 fallback prefix.
  assert.ok(stored.startsWith('b64:') || stored.startsWith('safe:'),
    `unexpected ciphertext format: ${stored.slice(0, 8)}`);
  const decoded = mfa.decryptSecret(stored);
  assert.strictEqual(decoded, secret);
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) {
    console.error(`\n${f.name}:`);
    console.error(f.error.stack || f.error.message);
  }
  process.exit(1);
}
