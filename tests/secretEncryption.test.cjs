/**
 * TransTrack — Field-level secret encryption tests.
 * Run standalone: node tests/secretEncryption.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate userData to a temp dir before requiring the module under test.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-secenc-'));
process.env.TRANSTRACK_USERDATA_DIR = tmp;

const { encryptField, decryptField, isEncrypted, ENC_PREFIX, _resetForTests } = require('../electron/services/secretEncryption.cjs');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ': ' + e.message); fail++; }
}

console.log('secretEncryption');

test('round-trips ASCII secret', () => {
  const out = encryptField('hunter2-api-key', 'ehr:1');
  assert(out.startsWith(ENC_PREFIX), 'expected wire prefix');
  assert.strictEqual(decryptField(out, 'ehr:1'), 'hunter2-api-key');
});

test('round-trips unicode + non-ASCII bytes', () => {
  const secret = 'café-✓-' + String.fromCharCode(0x1F600);
  const out = encryptField(secret, 'ehr:2');
  assert.strictEqual(decryptField(out, 'ehr:2'), secret);
});

test('produces different ciphertext for the same plaintext (IV randomness)', () => {
  const a = encryptField('same', 'ehr:3');
  const b = encryptField('same', 'ehr:3');
  assert.notStrictEqual(a, b);
});

test('null and empty pass through unchanged', () => {
  assert.strictEqual(encryptField(null), null);
  assert.strictEqual(encryptField(undefined), undefined);
  assert.strictEqual(encryptField(''), '');
  assert.strictEqual(decryptField(null), null);
  assert.strictEqual(decryptField(''), '');
});

test('legacy plaintext is returned as-is from decryptField', () => {
  assert.strictEqual(decryptField('legacy-plaintext-key'), 'legacy-plaintext-key');
});

test('is idempotent — does not double-encrypt', () => {
  const ct = encryptField('once', 'ehr:4');
  const ct2 = encryptField(ct, 'ehr:4');
  assert.strictEqual(ct, ct2);
});

test('isEncrypted detects wire format', () => {
  assert.strictEqual(isEncrypted('plain'), false);
  assert.strictEqual(isEncrypted(encryptField('x', 'ehr:5')), true);
});

test('tampered ciphertext throws on decrypt', () => {
  const ct = encryptField('victim', 'ehr:6');
  // Flip a character in the payload portion.
  const idx = ct.length - 5;
  const tampered = ct.slice(0, idx) + (ct[idx] === 'A' ? 'B' : 'A') + ct.slice(idx + 1);
  assert.throws(() => decryptField(tampered, 'ehr:6'));
});

test('wrong label fails to decrypt', () => {
  const ct = encryptField('scoped', 'ehr:7');
  assert.throws(() => decryptField(ct, 'ehr:8'));
});

test('master key persists across cache resets (re-read from disk)', () => {
  const ct = encryptField('persist-me', 'ehr:9');
  _resetForTests();
  assert.strictEqual(decryptField(ct, 'ehr:9'), 'persist-me');
});

console.log(`\n${pass} passed, ${fail} failed`);

// Cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

if (fail > 0) process.exit(1);
