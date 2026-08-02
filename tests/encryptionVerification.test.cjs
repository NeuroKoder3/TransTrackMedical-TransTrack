/**
 * TransTrack — database encryption verification (finding H-2).
 *
 * The control being pinned: TransTrack tells the Compliance Center that PHI is
 * encrypted at rest with AES-256 under a 256000-iteration PBKDF2-SHA512 profile.
 * That claim was previously backed by a single `db.pragma('cipher_version')`
 * call whose result was discarded — this SQLCipher build returns an empty array
 * whether or not the file is encrypted — so the flag was set unconditionally and
 * a plaintext database reported itself as HIPAA compliant.
 *
 * What is asserted here:
 *   • a plaintext database on disk is detected as unencrypted;
 *   • an encrypted database opened with the wrong key fails the data-page read;
 *   • an encrypted database opened with the right key passes every check;
 *   • the fail-closed decision throws and closes the handle on a packaged build,
 *     and leaves encryptionEnabled false (never "compliant") everywhere else;
 *   • the same cipher profile is applied by every path that opens the database
 *     (finding M-7 — the plaintext→encrypted migration used to set three of the
 *     seven pragmas).
 *
 * Run standalone: node tests/encryptionVerification.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3-multiple-ciphers');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-encverify-'));

// `isPackaged` is mutable so the fail-closed branch can be exercised against the
// same module instance the happy path uses.
const mockApp = { getPath: () => userDataDir, isPackaged: false };
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    app: mockApp,
    ipcMain: { handle: () => {} },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const init = require('../electron/database/init.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const KEY = crypto.randomBytes(32).toString('hex');
const OTHER_KEY = crypto.randomBytes(32).toString('hex');
const openHandles = [];

function tempPath(name) {
  return path.join(userDataDir, name);
}

/** An encrypted database with one materialised page, as an installed site has. */
function makeEncryptedDb(name, key = KEY) {
  const p = tempPath(name);
  const handle = new Database(p);
  init.applyCipherPragmas(handle, key);
  handle.pragma('journal_mode = WAL');
  handle.exec('CREATE TABLE patients (id TEXT PRIMARY KEY, last_name TEXT)');
  handle.prepare('INSERT INTO patients (id, last_name) VALUES (?, ?)').run('p1', 'Okonkwo');
  handle.close();
  return p;
}

function open(p, key) {
  const handle = new Database(p);
  if (key) init.applyCipherPragmas(handle, key);
  openHandles.push(handle);
  return handle;
}

console.log('\n=== H-2(a) verification proves encryption, not configuration ===');

test('a plaintext database on disk is reported as unencrypted', () => {
  const p = tempPath('plaintext.db');
  const seed = new Database(p);
  seed.exec('CREATE TABLE patients (id TEXT PRIMARY KEY)');
  seed.close();

  // Read back exactly as the old code would have: no key, no cipher pragmas.
  const handle = open(p, null);
  const result = init.verifyDatabaseEncryption(handle, p);

  assert.strictEqual(result.verified, false, 'a plaintext file must never verify');
  assert.strictEqual(result.checks.fileHeaderEncrypted, false);
  assert.ok(
    result.problems.some((m) => /plaintext "SQLite format 3" header/.test(m)),
    `expected a header problem, got ${JSON.stringify(result.problems)}`
  );
  assert.ok(
    result.problems.some((m) => /expected sqlcipher/.test(m)),
    'the configured cipher must also be reported as wrong'
  );
});

test('cipher_version alone cannot distinguish the two, which is why it is not relied on', () => {
  const plaintext = open(tempPath('plaintext.db'), null);
  const encrypted = open(makeEncryptedDb('cipherver.db'), KEY);

  // Documents the empirical behaviour this fix exists for: the pragma the old
  // check called returns the same thing for an encrypted and a plaintext file.
  assert.deepStrictEqual(
    plaintext.pragma('cipher_version'),
    encrypted.pragma('cipher_version'),
    'if this ever diverges, cipher_version has become usable on its own'
  );
});

test('an encrypted database opened with the right key passes every check', () => {
  const p = makeEncryptedDb('good.db');
  const handle = open(p, KEY);
  const result = init.verifyDatabaseEncryption(handle, p);

  assert.strictEqual(result.verified, true, JSON.stringify(result.problems));
  assert.strictEqual(result.checks.cipher, 'sqlcipher');
  assert.strictEqual(result.checks.dataPageReadable, true);
  assert.strictEqual(result.checks.fileHeaderEncrypted, true);
});

test('an encrypted database opened with the wrong key fails the data-page read', () => {
  const p = makeEncryptedDb('wrongkey.db');
  const handle = open(p, OTHER_KEY);
  const result = init.verifyDatabaseEncryption(handle, p);

  assert.strictEqual(result.verified, false, 'the wrong key must not verify');
  assert.strictEqual(result.checks.dataPageReadable, false);
  assert.ok(
    result.problems.some((m) => /could not read a data page/.test(m)),
    `expected a data-page problem, got ${JSON.stringify(result.problems)}`
  );
});

test('an in-memory database is never reported as encrypted', () => {
  // The driver refuses PRAGMA key on an in-memory database, so one can hold PHI
  // in cleartext. Verification must say so rather than treat it as exempt.
  const handle = new Database(':memory:');
  openHandles.push(handle);
  handle.pragma(`cipher = 'sqlcipher'`);
  handle.exec('CREATE TABLE patients (id TEXT PRIMARY KEY)');

  const result = init.verifyDatabaseEncryption(handle, ':memory:');
  assert.strictEqual(result.verified, false, 'an unkeyed in-memory database must not verify');
  assert.strictEqual(result.checks.fileHeaderEncrypted, null, 'there are no bytes at rest to check');
  assert.ok(
    result.problems.some((m) => /not file-backed/.test(m)),
    `expected an in-memory problem, got ${JSON.stringify(result.problems)}`
  );
});

test('the cipher salt distinguishes a keyed file from a plaintext one', () => {
  const encrypted = open(makeEncryptedDb('salt.db'), KEY);
  const plaintext = open(tempPath('plaintext.db'), null);

  assert.strictEqual(
    init.verifyDatabaseEncryption(encrypted, tempPath('salt.db')).checks.cipherSaltPresent, true
  );
  assert.strictEqual(
    init.verifyDatabaseEncryption(plaintext, tempPath('plaintext.db')).checks.cipherSaltPresent, false
  );
});

test('a weakened KDF is rejected even though the data still reads back', () => {
  // The compliance claim quotes 256000 PBKDF2-SHA512 iterations. A database
  // keyed with fewer decrypts perfectly well, so only an explicit iteration
  // check can tell the two apart.
  const p = tempPath('weakkdf.db');
  const seed = new Database(p);
  seed.pragma(`cipher = 'sqlcipher'`);
  seed.pragma('legacy = 4');
  seed.pragma(`key = "x'${KEY}'"`);
  seed.pragma('kdf_iter = 4000');
  seed.exec('CREATE TABLE patients (id TEXT PRIMARY KEY)');
  seed.close();

  const handle = new Database(p);
  openHandles.push(handle);
  handle.pragma(`cipher = 'sqlcipher'`);
  handle.pragma('legacy = 4');
  handle.pragma(`key = "x'${KEY}'"`);
  handle.pragma('kdf_iter = 4000');

  const result = init.verifyDatabaseEncryption(handle, p);
  assert.strictEqual(result.checks.dataPageReadable, true, 'a weak KDF still opens the file');
  assert.strictEqual(result.verified, false, 'but it must not pass verification');
  assert.ok(
    result.problems.some((m) => /kdf_iter/.test(m)),
    `expected a KDF problem, got ${JSON.stringify(result.problems)}`
  );
});

console.log('\n=== H-2(b) fail closed on packaged/production builds ===');

test('a packaged build refuses to run on an unverified database', () => {
  const p = tempPath('plaintext.db');
  const handle = open(p, null);

  mockApp.isPackaged = true;
  try {
    assert.throws(
      () => init.applyEncryptionVerification(handle, p),
      /encryption could not be verified/i,
      'a packaged build must throw rather than serve PHI from an unverified database'
    );
  } finally {
    mockApp.isPackaged = false;
  }

  assert.strictEqual(
    handle.open, false,
    'the handle must be closed so a caller that swallows the error cannot still read'
  );
});

test('NODE_ENV=production fails closed even when unpackaged', () => {
  const p = makeEncryptedDb('prodwrongkey.db');
  const handle = open(p, OTHER_KEY);

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () => init.applyEncryptionVerification(handle, p),
      /Refusing to start/,
      'a production build must fail closed exactly as getEncryptionKey() does'
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('a development build continues but is never reported as compliant', () => {
  const p = tempPath('plaintext.db');
  const handle = open(p, null);

  const result = init.applyEncryptionVerification(handle, p);
  assert.strictEqual(result.verified, false);
  assert.strictEqual(init.isEncryptionEnabled(), false, 'the flag must follow verification');

  const status = init.getEncryptionStatus();
  assert.strictEqual(status.enabled, false);
  assert.strictEqual(status.compliant, false, 'an unverified database is not HIPAA compliant');
  assert.strictEqual(status.standard, 'non-compliant');
  assert.strictEqual(status.algorithm, 'none');
  assert.strictEqual(status.verification.verified, false);
  assert.ok(status.verification.problems.length > 0, 'the status must carry the evidence');
});

console.log('\n=== H-2(c) getEncryptionStatus reflects a real verification ===');

test('a verified database reports the documented cipher profile', () => {
  const p = makeEncryptedDb('status.db');
  const handle = open(p, KEY);

  init.applyEncryptionVerification(handle, p);
  const status = init.getEncryptionStatus();

  assert.strictEqual(status.enabled, true);
  assert.strictEqual(status.compliant, true);
  assert.strictEqual(status.standard, 'HIPAA');
  assert.strictEqual(status.keyIterations, 256000);
  assert.strictEqual(status.keyDerivation, 'PBKDF2-HMAC-SHA512');
  assert.strictEqual(status.verification.verified, true);
  assert.ok(status.verification.verifiedAt, 'the status must say when it was proved');
});

console.log('\n=== M-7 one cipher profile for every path ===');

test('applyCipherPragmas puts the documented profile in force', () => {
  const handle = open(makeEncryptedDb('profile.db'), KEY);
  const one = (name) => {
    const rows = handle.pragma(name);
    return rows?.[0] ? Object.values(rows[0])[0] : null;
  };

  // cipher_page_size, cipher_hmac_algorithm and cipher_kdf_algorithm are
  // write-only in this build and read back empty; page_size reflects the value
  // that was applied.
  assert.strictEqual(one('cipher'), 'sqlcipher');
  assert.strictEqual(Number(one('kdf_iter')), 256000);
  assert.strictEqual(Number(one('page_size')), 4096);
});

test('no open path sets cipher pragmas by hand instead of the shared helper', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8'
  );
  const helper = source.slice(
    source.indexOf('function applyCipherPragmas'),
    source.indexOf('\n}', source.indexOf('function applyCipherPragmas'))
  );

  // Every `key = x'...'` assignment outside the helper is a path that can drift
  // away from the documented KDF profile, which is exactly what M-7 was.
  const keyAssignments = source.match(/pragma\(`key = /g) || [];
  assert.strictEqual(
    keyAssignments.length, (helper.match(/pragma\(`key = /g) || []).length,
    'the encryption key must only be applied through applyCipherPragmas'
  );
});

for (const handle of openHandles) {
  try { handle.close(); } catch { /* already closed by a fail-closed path */ }
}
fs.rmSync(userDataDir, { recursive: true, force: true });

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
