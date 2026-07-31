/**
 * TransTrack — audit HMAC key source gating.
 *
 * TRANSTRACK_AUDIT_HMAC_KEY exists so CI can exercise the HMAC path without an
 * OS keyring. That makes it a potential bypass: if it were honoured on a real
 * installation, anyone able to set an environment variable could choose the
 * audit key and forge the whole trail. These tests pin the gate shut.
 *
 * The contract asserted here:
 *   • the override works ONLY in an unpackaged build with NODE_ENV=test
 *   • production, staging, an unset NODE_ENV, and any packaged build ignore it
 *     completely, log a warning, and fall through to OS secure storage
 *   • an unprotected key FILE is likewise refused wherever the keyring is
 *     required, and no unprotected key is ever written there
 *   • when no key can be established the module fails closed (returns none)
 *     rather than minting one an attacker could read
 *
 * Run standalone: node tests/auditKeyGating.test.cjs
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- Mutable environment the mocks read from -------------------------------

let keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transtrack-keygate-'));
let safeStorageAvailable = false;
let packaged = false;
const warnings = [];

const ENCRYPTION_PREFIX = 'SAFESTORAGE:';

const mockApp = {
  getPath: () => keyDir,
  getVersion: () => '1.2.0-test',
  get isPackaged() { return packaged; },
};

const mockSafeStorage = {
  isEncryptionAvailable: () => safeStorageAvailable,
  encryptString: (plain) => Buffer.from(ENCRYPTION_PREFIX + plain, 'utf8'),
  decryptString: (buf) => {
    const text = Buffer.from(buf).toString('utf8');
    if (!text.startsWith(ENCRYPTION_PREFIX)) throw new Error('not encrypted by this keyring');
    return text.slice(ENCRYPTION_PREFIX.length);
  },
};

require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: mockApp, safeStorage: mockSafeStorage },
};

// Capture warnings so the "log a clear warning" requirement is verifiable.
const loggerPath = require.resolve('../electron/services/logger.cjs');
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: {
    logger: {
      warn: (message, meta) => warnings.push({ message, meta }),
      info: () => {}, error: () => {}, debug: () => {},
    },
  },
};

const auditHmacKey = require('../electron/services/auditHmacKey.cjs');

// --- Harness ---------------------------------------------------------------

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const VALID_KEY = 'ab'.repeat(32);
const KEY_FILENAME = '.transtrack-audit-hmac';

/**
 * Run `fn` against a pristine module state and a pristine key directory.
 * Restores every environment variable afterwards.
 */
function withEnv({ nodeEnv, allowTestKeys, override, keyring = false, isPackaged = false }, fn) {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    TRANSTRACK_ALLOW_TEST_KEYS: process.env.TRANSTRACK_ALLOW_TEST_KEYS,
    TRANSTRACK_AUDIT_HMAC_KEY: process.env.TRANSTRACK_AUDIT_HMAC_KEY,
  };

  const setOrDelete = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  setOrDelete('NODE_ENV', nodeEnv);
  setOrDelete('TRANSTRACK_ALLOW_TEST_KEYS', allowTestKeys);
  setOrDelete('TRANSTRACK_AUDIT_HMAC_KEY', override);

  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transtrack-keygate-'));
  safeStorageAvailable = keyring;
  packaged = isPackaged;
  warnings.length = 0;
  auditHmacKey._resetForTests();

  try {
    return fn({ keyPath: path.join(keyDir, KEY_FILENAME) });
  } finally {
    for (const [name, value] of Object.entries(saved)) setOrDelete(name, value);
    packaged = false;
    safeStorageAvailable = false;
    auditHmacKey._resetForTests();
    try { fs.rmSync(keyDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function warnedAbout(pattern) {
  return warnings.some((w) => pattern.test(w.message));
}

console.log('\n=== The override is honoured only under NODE_ENV=test ===');

test('NODE_ENV=test with no keyring uses the override', () => {
  withEnv({ nodeEnv: 'test', override: VALID_KEY }, ({ keyPath }) => {
    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.available, true, JSON.stringify(status));
    assert.strictEqual(status.testOverrideInUse, true);
    assert.strictEqual(status.testOverrideRejected, false);
    // The override must not be persisted anywhere.
    assert.strictEqual(fs.existsSync(keyPath), false, 'no key file may be written');
  });
});

test('the override key is actually the key used', () => {
  withEnv({ nodeEnv: 'test', override: VALID_KEY }, () => {
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha256', Buffer.from(VALID_KEY, 'hex'))
      .update('canonical')
      .digest('hex');
    assert.strictEqual(auditHmacKey.computeAuditHmac('canonical'), expected);
  });
});

test('TRANSTRACK_ALLOW_TEST_KEYS=true with NODE_ENV=test is accepted', () => {
  withEnv({ nodeEnv: 'test', allowTestKeys: 'true', override: VALID_KEY }, () => {
    assert.strictEqual(auditHmacKey.isTestKeyOverrideAllowed(), true);
    assert.strictEqual(auditHmacKey.getStatus().testOverrideInUse, true);
  });
});

test('TRANSTRACK_ALLOW_TEST_KEYS=false vetoes the override even under test', () => {
  withEnv({ nodeEnv: 'test', allowTestKeys: 'false', override: VALID_KEY }, () => {
    assert.strictEqual(auditHmacKey.isTestKeyOverrideAllowed(), false);
    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.testOverrideInUse, false);
    assert.strictEqual(status.testOverrideRejected, true);
  });
});

test('a malformed override is ignored rather than used', () => {
  for (const bad of ['nothex', 'ab', 'zz'.repeat(32), `${VALID_KEY}00`, '  ']) {
    withEnv({ nodeEnv: 'test', override: bad }, () => {
      const status = auditHmacKey.getStatus();
      assert.strictEqual(status.testOverrideInUse, false, `"${bad}" must not be used`);
    });
  }
});

console.log('\n=== Non-test environments ignore the override completely ===');

for (const nodeEnv of ['production', 'staging', 'preprod', 'qa', 'development', undefined, '']) {
  const label = nodeEnv === undefined ? '(unset)' : `"${nodeEnv}"`;

  test(`NODE_ENV=${label} refuses the override`, () => {
    withEnv({ nodeEnv, override: VALID_KEY, keyring: false }, () => {
      assert.strictEqual(
        auditHmacKey.isTestKeyOverrideAllowed(), false,
        `the override must not be allowed under NODE_ENV=${label}`
      );

      const status = auditHmacKey.getStatus();
      assert.strictEqual(status.testOverrideInUse, false, 'the override must not be in use');
      assert.strictEqual(status.testOverrideRejected, true, 'the rejection must be reported');
    });
  });

  test(`NODE_ENV=${label} logs a clear warning naming the variable`, () => {
    withEnv({ nodeEnv, override: VALID_KEY }, () => {
      auditHmacKey.getStatus();
      assert.ok(
        warnedAbout(/TRANSTRACK_AUDIT_HMAC_KEY.*IGNORED/),
        `expected a warning naming the variable, saw: ${JSON.stringify(warnings)}`
      );
    });
  });
}

test('the override never leaks into the key even when the keyring works', () => {
  withEnv({ nodeEnv: 'production', override: VALID_KEY, keyring: true }, () => {
    const crypto = require('crypto');
    const overrideDigest = crypto
      .createHmac('sha256', Buffer.from(VALID_KEY, 'hex'))
      .update('canonical')
      .digest('hex');

    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.available, true, 'the keyring path must still produce a key');
    assert.strictEqual(status.testOverrideInUse, false);
    assert.notStrictEqual(
      auditHmacKey.computeAuditHmac('canonical'), overrideDigest,
      'the environment key must not be the key in use'
    );
  });
});

console.log('\n=== Packaged builds refuse the override unconditionally ===');

test('a packaged build refuses the override even with NODE_ENV=test', () => {
  withEnv({ nodeEnv: 'test', override: VALID_KEY, isPackaged: true }, () => {
    assert.strictEqual(auditHmacKey.isTestKeyOverrideAllowed(), false);
    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.testOverrideInUse, false);
    assert.strictEqual(status.testOverrideRejected, true);
  });
});

test('a packaged build refuses the override even with the explicit opt-in', () => {
  withEnv({ nodeEnv: 'test', allowTestKeys: 'true', override: VALID_KEY, isPackaged: true }, () => {
    assert.strictEqual(auditHmacKey.isTestKeyOverrideAllowed(), false);
    assert.strictEqual(auditHmacKey.getStatus().testOverrideInUse, false);
  });
});

console.log('\n=== No production-reachable bypass of the OS keyring ===');

test('production without a keyring creates NO key and writes NO file', () => {
  withEnv({ nodeEnv: 'production', keyring: false }, ({ keyPath }) => {
    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.available, false, 'must fail closed');
    assert.strictEqual(status.reason, 'safe_storage_unavailable');
    assert.strictEqual(fs.existsSync(keyPath), false, 'must not write an unprotected key');
    assert.ok(warnedAbout(/secure storage is unavailable/i), JSON.stringify(warnings));
  });
});

for (const nodeEnv of ['production', 'staging', 'qa']) {
  test(`NODE_ENV="${nodeEnv}" refuses to persist an unprotected key`, () => {
    withEnv({ nodeEnv, keyring: false }, ({ keyPath }) => {
      assert.strictEqual(auditHmacKey.isUnprotectedKeyFileAllowed(), false);
      auditHmacKey.getStatus();
      assert.strictEqual(fs.existsSync(keyPath), false);
    });
  });

  test(`NODE_ENV="${nodeEnv}" refuses an EXISTING unprotected key file`, () => {
    // The bypass this closes: drop a plaintext key next to the database and the
    // whole HMAC layer becomes forgeable.
    withEnv({ nodeEnv, keyring: false }, ({ keyPath }) => {
      fs.writeFileSync(keyPath, VALID_KEY, { mode: 0o600 });
      auditHmacKey._resetForTests();

      const status = auditHmacKey.getStatus();
      assert.strictEqual(status.available, false, 'a planted plaintext key must be refused');
      assert.strictEqual(status.reason, 'unprotected_key_file_refused');
      assert.ok(warnedAbout(/unprotected audit HMAC key file/i), JSON.stringify(warnings));
    });
  });
}

test('a packaged build refuses an existing unprotected key file', () => {
  withEnv({ nodeEnv: 'test', keyring: false, isPackaged: true }, ({ keyPath }) => {
    fs.writeFileSync(keyPath, VALID_KEY, { mode: 0o600 });
    auditHmacKey._resetForTests();

    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.available, false);
    assert.strictEqual(status.reason, 'unprotected_key_file_refused');
  });
});

test('an unrecognised NODE_ENV fails closed onto the keyring', () => {
  // Allowlist behaviour: a typo like "prod" or "Production" must not be treated
  // as a development environment.
  for (const nodeEnv of ['prod', 'Production', 'TEST', 'dev', 'ci']) {
    withEnv({ nodeEnv, keyring: false }, ({ keyPath }) => {
      assert.strictEqual(
        auditHmacKey.isUnprotectedKeyFileAllowed(), false,
        `NODE_ENV="${nodeEnv}" must not permit an unprotected key`
      );
      auditHmacKey.getStatus();
      assert.strictEqual(fs.existsSync(keyPath), false);
    });
  }
});

console.log('\n=== The keyring path still works ===');

test('a key is minted and stored encrypted when the keyring is available', () => {
  withEnv({ nodeEnv: 'production', keyring: true }, ({ keyPath }) => {
    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.available, true, JSON.stringify(status));
    assert.strictEqual(status.osProtected, true);
    assert.ok(fs.existsSync(keyPath), 'the key must be persisted');

    const onDisk = fs.readFileSync(keyPath, 'utf8');
    assert.ok(onDisk.startsWith(ENCRYPTION_PREFIX), 'the stored key must be encrypted');
    assert.ok(!/^[a-f0-9]{64}$/.test(onDisk.trim()), 'the key must not be on disk in the clear');
  });
});

test('an existing encrypted key is reloaded, not replaced', () => {
  withEnv({ nodeEnv: 'production', keyring: true }, () => {
    const first = auditHmacKey.computeAuditHmac('canonical');
    auditHmacKey._resetForTests();
    const second = auditHmacKey.computeAuditHmac('canonical');
    assert.strictEqual(second, first, 'the same key must be loaded from disk');
  });
});

test('development without a keyring may persist a 0600 key file', () => {
  // Retained so contributors are not blocked on a system keyring.
  withEnv({ nodeEnv: 'development', keyring: false }, ({ keyPath }) => {
    assert.strictEqual(auditHmacKey.isUnprotectedKeyFileAllowed(), true);
    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.available, true, JSON.stringify(status));
    assert.strictEqual(status.osProtected, false);
    assert.ok(fs.existsSync(keyPath));
  });
});

test('a corrupt sealed key is reported distinctly, not as a missing keyring', () => {
  // Neither decryptable nor a legacy hex key: the operator needs to know the
  // stored key is damaged rather than absent.
  withEnv({ nodeEnv: 'production', keyring: true }, ({ keyPath }) => {
    fs.writeFileSync(keyPath, 'this is not a sealed key', { mode: 0o600 });
    auditHmacKey._resetForTests();

    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.available, false);
    assert.strictEqual(status.reason, 'key_decrypt_failed', JSON.stringify(status));
  });
});

test('an unprotected dev key is upgraded once a keyring appears', () => {
  const saved = process.env.NODE_ENV;
  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transtrack-keygate-'));
  const keyPath = path.join(keyDir, KEY_FILENAME);

  try {
    process.env.NODE_ENV = 'development';
    safeStorageAvailable = false;
    auditHmacKey._resetForTests();
    fs.writeFileSync(keyPath, VALID_KEY, { mode: 0o600 });

    // Keyring now present: the plaintext key should be re-sealed in place.
    safeStorageAvailable = true;
    auditHmacKey._resetForTests();
    assert.strictEqual(auditHmacKey.getStatus().available, true);

    const onDisk = fs.readFileSync(keyPath, 'utf8');
    assert.ok(onDisk.startsWith(ENCRYPTION_PREFIX), 'the key must be upgraded to encrypted storage');
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved;
    safeStorageAvailable = false;
    auditHmacKey._resetForTests();
    try { fs.rmSync(keyDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

console.log('\n=== Key file I/O is race-safe (CWE-367) ===');

test('the key is read without an exists()-then-open sequence', () => {
  // Structural: a check-then-use on a path lets an attacker swap the file (or
  // substitute a symlink) between the check and the read. CodeQL reports this
  // as js/file-system-race. The source must open by descriptor and treat
  // ENOENT as "no key yet" instead.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'services', 'auditHmacKey.cjs'),
    'utf8'
  );
  assert.ok(
    !/fs\.existsSync/.test(source),
    'key handling must not branch on fs.existsSync'
  );
  assert.ok(
    /openSync\(keyPath, 'r'\)/.test(source),
    'the key must be read through a descriptor'
  );
  assert.ok(
    /openSync\(keyPath, 'wx', 0o600\)/.test(source),
    "creation must use 'wx' (O_CREAT|O_EXCL) so it cannot clobber a concurrent writer"
  );
});

test('a concurrently created key is adopted, not overwritten', () => {
  // Two processes starting at once must converge on one key. Overwriting the
  // loser's key would leave the rows it already wrote HMAC-unverifiable.
  withEnv({ nodeEnv: 'production', keyring: true }, ({ keyPath }) => {
    // Seed the file as if another process had just created it.
    fs.writeFileSync(keyPath, mockSafeStorage.encryptString(VALID_KEY), { mode: 0o600 });
    auditHmacKey._resetForTests();

    const status = auditHmacKey.getStatus();
    assert.strictEqual(status.available, true, JSON.stringify(status));

    // The adopted key must be the one on disk, not a freshly minted one.
    const expected = crypto
      .createHmac('sha256', Buffer.from(VALID_KEY, 'hex'))
      .update('canonical')
      .digest('hex');
    assert.strictEqual(auditHmacKey.computeAuditHmac('canonical'), expected);
  });
});

test('re-sealing leaves no temp file behind', () => {
  // The upgrade writes a temp file and renames it over the target so a crash
  // cannot leave an empty key file. The temp must not survive.
  const saved = process.env.NODE_ENV;
  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transtrack-keygate-'));
  const keyPath = path.join(keyDir, KEY_FILENAME);

  try {
    process.env.NODE_ENV = 'development';
    safeStorageAvailable = false;
    auditHmacKey._resetForTests();
    fs.writeFileSync(keyPath, VALID_KEY, { mode: 0o600 });

    safeStorageAvailable = true;
    auditHmacKey._resetForTests();
    assert.strictEqual(auditHmacKey.getStatus().available, true);

    const strays = fs.readdirSync(keyDir).filter((f) => f.includes('reseal'));
    assert.deepStrictEqual(strays, [], `temp files left behind: ${strays.join(', ')}`);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved;
    safeStorageAvailable = false;
    auditHmacKey._resetForTests();
    try { fs.rmSync(keyDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
