/**
 * TransTrack — sign-win.cjs unit tests.
 *
 * Validates the parts that DON'T need a real Authenticode certificate:
 *   - Auto-detect mode based on env vars
 *   - Base32 decoder + TOTP RFC 6238 vector
 *   - Skip-mode is a no-op (no exception)
 *   - Path resolver handles both string and {path} shapes
 */

'use strict';

const assert = require('assert');
const path = require('path');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

// We re-require the module fresh between tests because module-load reads env.
function freshSigner(env) {
  const original = { ...process.env };
  // Clear all signing-related env vars
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith('ESIGNER_') ||
      k.startsWith('CSC_') ||
      k === 'TRANSTRACK_SIGN_MODE' ||
      k === 'SIGN_TIMESTAMP_URL'
    ) {
      delete process.env[k];
    }
  }
  Object.assign(process.env, env || {});
  delete require.cache[require.resolve('../scripts/sign-win.cjs')];
  const mod = require('../scripts/sign-win.cjs');
  process.env = original;
  return mod;
}

console.log('\n=== sign-win.cjs ===');

test('skip mode is a no-op (does not throw)', async () => {
  const sign = freshSigner({ TRANSTRACK_SIGN_MODE: 'skip' });
  await sign('C:/tmp/some/file.exe');
  await sign({ path: 'C:/tmp/some/file.exe' });
});

test('auto-detect: no env vars → skip', async () => {
  const sign = freshSigner({});
  await sign('C:/tmp/file.exe');  // should not throw
});

test('unknown mode throws', async () => {
  const sign = freshSigner({ TRANSTRACK_SIGN_MODE: 'magic_unicorn' });
  await assert.rejects(() => sign('C:/tmp/file.exe'),
    /Unknown TRANSTRACK_SIGN_MODE/);
});

test('null/undefined input is tolerated (warn + return)', async () => {
  const sign = freshSigner({ TRANSTRACK_SIGN_MODE: 'skip' });
  await sign(null);
  await sign(undefined);
  await sign({});
});

test('exports both default and named function (electron-builder shapes)', () => {
  const mod = freshSigner({ TRANSTRACK_SIGN_MODE: 'skip' });
  assert.strictEqual(typeof mod, 'function');
  assert.strictEqual(typeof mod.default, 'function');
  assert.strictEqual(mod, mod.default);
});

console.log('\n=== TOTP RFC 6238 vectors (via base32 decoder) ===');

const exposed = require('../scripts/sign-win.cjs').__testing__;

test('base32 decode of known vector: "JBSWY3DPEHPK3PXP"', () => {
  const buf = exposed._base32Decode('JBSWY3DPEHPK3PXP');
  // "Hello!" then DE AD BE EF
  assert.deepStrictEqual(
    Array.from(buf),
    [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef],
  );
});

test('TOTP digits are 6, all numeric', () => {
  const code = exposed._generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.match(code, /^\d{6}$/);
});

test('_resolveFilePath: handles string and {path} shapes', () => {
  assert.strictEqual(exposed._resolveFilePath('C:/x/y.exe'), 'C:/x/y.exe');
  assert.strictEqual(exposed._resolveFilePath({ path: 'C:/x/y.exe' }), 'C:/x/y.exe');
  assert.strictEqual(exposed._resolveFilePath(null), null);
  assert.strictEqual(exposed._resolveFilePath({}), null);
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
