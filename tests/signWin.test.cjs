/**
 * TransTrack — sign-win.cjs unit tests.
 *
 * Validates the parts that don't need a real Authenticode certificate: mode
 * auto-detection, the fail-closed behaviour on release builds, base32/TOTP,
 * certificate materialisation from base64, and the path resolver.
 *
 * The harness awaits its tests. It previously did not: `test()` called an
 * `async` function and incremented the pass counter on the next line, so every
 * asynchronous test was recorded as passing before its assertions had run, and
 * a rejection surfaced later as an unhandled rejection rather than a failure.
 * The `assert.rejects` cases below — the signer's entire error surface — were
 * therefore never actually checked.
 *
 * Run standalone: node tests/signWin.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let PASS = 0, FAIL = 0;
const failures = [];
const queue = [];

function test(name, fn) {
  queue.push(async () => {
    try { await fn(); PASS++; console.log(`  PASS  ${name}`); }
    catch (e) {
      FAIL++; failures.push({ name, error: e });
      console.log(`  FAIL  ${name}\n        ${e.message}`);
    }
  });
}

const SIGNING_ENV_KEYS = (k) =>
  k.startsWith('ESIGNER_') ||
  k.startsWith('CSC_') ||
  k === 'TRANSTRACK_SIGN_MODE' ||
  k === 'TRANSTRACK_RELEASE_CHANNEL' ||
  k === 'TRANSTRACK_REQUIRE_SIGNING' ||
  k === 'SIGN_TIMESTAMP_URL';

/**
 * Load the signer with a controlled environment.
 *
 * The module reads TRANSTRACK_SIGN_MODE at load time but evaluates the
 * "is signing required" question at call time, so the environment has to stay
 * in place for the duration of the call rather than only for the require.
 */
async function withSigner(env, body) {
  const original = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (SIGNING_ENV_KEYS(k)) delete process.env[k];
  }
  Object.assign(process.env, env || {});
  delete require.cache[require.resolve('../scripts/sign-win.cjs')];
  const mod = require('../scripts/sign-win.cjs');
  try {
    return await body(mod);
  } finally {
    process.env = original;
  }
}

console.log('\n=== sign-win.cjs ===');

test('skip mode is a no-op on a developer build', async () => {
  await withSigner({ TRANSTRACK_SIGN_MODE: 'skip' }, async (sign) => {
    await sign('C:/tmp/some/file.exe');
    await sign({ path: 'C:/tmp/some/file.exe' });
  });
});

test('auto-detect with no credentials yields skip', async () => {
  await withSigner({}, async (sign) => {
    await sign('C:/tmp/file.exe');
  });
});

test('unknown mode throws', async () => {
  await withSigner({ TRANSTRACK_SIGN_MODE: 'magic_unicorn' }, async (sign) => {
    await assert.rejects(() => sign('C:/tmp/file.exe'), /Unknown TRANSTRACK_SIGN_MODE/);
  });
});

test('missing file path is tolerated on a developer build', async () => {
  await withSigner({ TRANSTRACK_SIGN_MODE: 'skip' }, async (sign) => {
    await sign(null);
    await sign(undefined);
    await sign({});
  });
});

test('exports both default and named function (electron-builder shapes)', async () => {
  await withSigner({ TRANSTRACK_SIGN_MODE: 'skip' }, async (mod) => {
    assert.strictEqual(typeof mod, 'function');
    assert.strictEqual(typeof mod.default, 'function');
    assert.strictEqual(mod, mod.default);
  });
});

console.log('\n=== fail-closed on release builds ===');

test('a release build refuses to produce an unsigned artifact', async () => {
  await withSigner(
    { TRANSTRACK_SIGN_MODE: 'skip', TRANSTRACK_RELEASE_CHANNEL: 'public' },
    async (sign) => {
      await assert.rejects(
        () => sign('C:/tmp/TransTrack-Enterprise-1.2.1-x64.exe'),
        /Signing is required for this build/,
      );
    },
  );
});

test('TRANSTRACK_REQUIRE_SIGNING alone is enough to fail closed', async () => {
  await withSigner(
    { TRANSTRACK_SIGN_MODE: 'skip', TRANSTRACK_REQUIRE_SIGNING: '1' },
    async (sign) => {
      await assert.rejects(() => sign('C:/tmp/file.exe'), /Signing is required/);
    },
  );
});

test('a release build refuses a missing file path rather than skipping', async () => {
  await withSigner(
    { TRANSTRACK_SIGN_MODE: 'skip', TRANSTRACK_RELEASE_CHANNEL: 'public' },
    async (sign) => {
      await assert.rejects(() => sign(null), /No file path provided/);
    },
  );
});

test('a non-release build with no credentials still just warns', async () => {
  await withSigner(
    { TRANSTRACK_SIGN_MODE: 'skip', TRANSTRACK_RELEASE_CHANNEL: 'internal' },
    async (sign) => {
      await sign('C:/tmp/file.exe');
    },
  );
});

test('esigner mode names the missing variable instead of failing deep in the call', async () => {
  await withSigner(
    {
      TRANSTRACK_SIGN_MODE: 'ssl_esigner',
      ESIGNER_USERNAME: 'u',
      ESIGNER_PASSWORD: 'p',
      ESIGNER_CREDENTIAL_ID: 'c',
      ESIGNER_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
      // ESIGNER_TOOL_PATH deliberately absent — the exact gap that broke the
      // release workflow.
    },
    async (sign) => {
      await assert.rejects(
        () => sign('C:/tmp/file.exe'),
        (e) => {
          assert.match(e.message, /ESIGNER_TOOL_PATH/);
          assert.match(e.message, /is not set/);
          assert.ok(
            !/not found: undefined/.test(e.message),
            'must not report the old confusing "not found: undefined" message',
          );
          return true;
        },
      );
    },
  );
});

test('pfx mode names both missing variables at once', async () => {
  await withSigner({ TRANSTRACK_SIGN_MODE: 'pfx' }, async (sign) => {
    await assert.rejects(() => sign('C:/tmp/file.exe'), (e) => {
      assert.match(e.message, /CSC_LINK/);
      assert.match(e.message, /CSC_KEY_PASSWORD/);
      return true;
    });
  });
});

console.log('\n=== signing-required detection ===');

const exposed = require('../scripts/sign-win.cjs').__testing__;

function requiredWith(env) {
  const original = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (SIGNING_ENV_KEYS(k)) delete process.env[k];
  }
  Object.assign(process.env, env);
  try { return exposed._signingRequired(); }
  finally { process.env = original; }
}

test('release channel and explicit flag both require signing', async () => {
  assert.strictEqual(requiredWith({ TRANSTRACK_RELEASE_CHANNEL: 'public' }), true);
  assert.strictEqual(requiredWith({ TRANSTRACK_REQUIRE_SIGNING: '1' }), true);
  assert.strictEqual(requiredWith({ TRANSTRACK_REQUIRE_SIGNING: 'true' }), true);
  assert.strictEqual(requiredWith({ TRANSTRACK_REQUIRE_SIGNING: 'TRUE' }), true);
});

test('an ordinary developer build does not require signing', async () => {
  assert.strictEqual(requiredWith({}), false);
  assert.strictEqual(requiredWith({ TRANSTRACK_RELEASE_CHANNEL: 'internal' }), false);
  assert.strictEqual(requiredWith({ TRANSTRACK_REQUIRE_SIGNING: '0' }), false);
  assert.strictEqual(requiredWith({ TRANSTRACK_REQUIRE_SIGNING: 'no' }), false);
});

console.log('\n=== certificate materialisation ===');

// Minimal DER SEQUENCE header followed by filler; enough to satisfy the shape
// check without shipping a real key.
const FAKE_PKCS12 = Buffer.concat([
  Buffer.from([0x30, 0x82, 0x01, 0x00]),
  Buffer.alloc(200, 0x41),
]);

test('an existing file path is used as-is and never deleted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cert-'));
  const file = path.join(dir, 'real.pfx');
  fs.writeFileSync(file, FAKE_PKCS12);

  const cert = exposed._materializeCertificate(file);
  assert.strictEqual(cert.file, file);
  cert.cleanup();
  assert.ok(fs.existsSync(file), 'a caller-supplied certificate must survive cleanup');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('base64 content is written to a temporary file and removed on cleanup', async () => {
  const cert = exposed._materializeCertificate(FAKE_PKCS12.toString('base64'));
  assert.ok(fs.existsSync(cert.file), 'certificate should have been materialised');
  assert.deepStrictEqual(fs.readFileSync(cert.file), FAKE_PKCS12, 'content must round-trip');

  if (process.platform !== 'win32') {
    const mode = fs.statSync(cert.file).mode & 0o777;
    assert.strictEqual(mode, 0o600, 'a private key must not be group- or world-readable');
  }

  cert.cleanup();
  assert.ok(!fs.existsSync(cert.file), 'the temporary private key must not be left behind');
});

test('a wrong path is reported as a path problem, not a corrupt certificate', async () => {
  assert.throws(
    () => exposed._materializeCertificate('C:/no/such/cert.pfx'),
    /neither an existing file nor base64-encoded PKCS#12/,
  );
});

test('base64 of something that is not a PKCS#12 is rejected', async () => {
  const notACert = Buffer.alloc(200, 0x41).toString('base64');
  assert.throws(() => exposed._materializeCertificate(notACert), /PKCS#12/);
});

console.log('\n=== TOTP RFC 6238 vectors (via base32 decoder) ===');

test('base32 decode of known vector: "JBSWY3DPEHPK3PXP"', async () => {
  const buf = exposed._base32Decode('JBSWY3DPEHPK3PXP');
  // "Hello!" then DE AD BE EF
  assert.deepStrictEqual(
    Array.from(buf),
    [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef],
  );
});

test('TOTP digits are 6, all numeric', async () => {
  const code = exposed._generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.match(code, /^\d{6}$/);
});

test('_resolveFilePath: handles string and {path} shapes', async () => {
  assert.strictEqual(exposed._resolveFilePath('C:/x/y.exe'), 'C:/x/y.exe');
  assert.strictEqual(exposed._resolveFilePath({ path: 'C:/x/y.exe' }), 'C:/x/y.exe');
  assert.strictEqual(exposed._resolveFilePath(null), null);
  assert.strictEqual(exposed._resolveFilePath({}), null);
});

(async () => {
  for (const run of queue) await run();

  console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
  if (FAIL > 0) {
    for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
    process.exit(1);
  }
})();
