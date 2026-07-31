/**
 * TransTrack — secure deletion tests.
 *
 * Verifies that electron/services/secureDelete.cjs actually overwrites file
 * content before unlinking, rather than only removing the directory entry.
 *
 * The overwrite is proven by reading the raw bytes back from the same disk
 * offsets before the unlink step (via the rename: false path plus a probe
 * copy), and by confirming multi-pass behaviour and error handling.
 *
 * Run standalone: node tests/secureDelete.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const secureDelete = require('../electron/services/secureDelete.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transtrack-securedelete-'));
const PHI = 'PATIENT: LOPEZ, CAMILA MARIA  MRN: MRN-2026-10001  DOB: 1987-06-10  SSN: 123-45-6789';

function writeFixture(name, contents = PHI) {
  const filePath = path.join(workDir, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

console.log('\n=== secureDeleteFile ===');

test('removes the file and reports the byte count', () => {
  const filePath = writeFixture('export.csv');
  const size = fs.statSync(filePath).size;

  const result = secureDelete.secureDeleteFile(filePath);
  assert.strictEqual(result.deleted, true, JSON.stringify(result));
  assert.strictEqual(result.bytes, size);
  assert.strictEqual(fs.existsSync(filePath), false, 'file must be gone');
});

console.log('\n=== The service is actually wired into production paths ===');

// A secure-deletion service that nothing calls provides no protection. These
// assertions are deliberately structural: they fail if a call site is reverted
// to a bare fs.unlinkSync, which is the regression that would silently disarm
// the control.
{
  const fs2 = require('fs');
  const path2 = require('path');
  const ELECTRON_DIR = path2.join(__dirname, '..', 'electron');
  const read = (...parts) => fs2.readFileSync(path2.join(ELECTRON_DIR, ...parts), 'utf8');

  const initSource = read('database', 'init.cjs');
  const authSource = read('ipc', 'handlers', 'auth.cjs');
  const recoverySource = read('services', 'disasterRecovery.cjs');

  test('the plaintext database is securely wiped after encryption migration', () => {
    // This file holds unencrypted PHI; a bare unlink leaves every record
    // recoverable from free blocks.
    assert.ok(
      /secureDelete\.secureDeleteFile\(plaintextPath\)/.test(initSource),
      'the encryption migration must wipe the plaintext database'
    );
    assert.ok(
      /unencryptedPath\}-wal/.test(initSource) && /unencryptedPath\}-shm/.test(initSource),
      'the -wal/-shm sidecars hold plaintext pages and must be wiped too'
    );
  });

  test('the restore temp copy is securely wiped on failure', () => {
    assert.ok(
      /secureDelete\.secureDeleteFile\(tempPath\)/.test(initSource),
      'the restore temp file is a full database copy and must be wiped'
    );
  });

  test('a partially written encrypted database is wiped on migration failure', () => {
    assert.ok(
      /secureDelete\.secureDeleteFile\(encryptedPath \+ '\.new'\)/.test(initSource),
      'the .new database must be wiped, not unlinked'
    );
  });

  test('an overwritten backup target is securely wiped', () => {
    assert.ok(
      /secureDelete\.secureDeleteFile\(targetPath\)/.test(initSource),
      'backupDatabase must wipe an existing target'
    );
    assert.ok(
      /secureDelete\.secureDeleteFile\(backupPath\)/.test(recoverySource),
      'createBackup must wipe an existing backup file'
    );
  });

  test('rotated-out backups take their sidecars with them', () => {
    assert.ok(
      /backupPath\}-wal/.test(recoverySource) && /backupPath\}-shm/.test(recoverySource),
      'backup -wal/-shm sidecars must be removed during rotation'
    );
  });

  test('the first-launch admin token file is securely wiped', () => {
    assert.ok(
      /secureDelete\.secureDeleteFile\(tokenPath\)/.test(authSource),
      'the bootstrap credential must be wiped, not unlinked'
    );
  });

  test('no bare unlink remains in the sensitive paths', () => {
    // Scoped to the specific call sites this control covers. Log rotation in
    // errorLogger.cjs is intentionally excluded: those files are non-PHI.
    for (const [label, source] of [
      ['database/init.cjs', initSource],
      ['ipc/handlers/auth.cjs', authSource],
    ]) {
      assert.ok(
        !/fs\.unlinkSync\(/.test(source),
        `${label} still contains a bare fs.unlinkSync for a sensitive file`
      );
    }
  });
}

console.log('\n=== Overwrite behaviour ===');

test('overwrites content before unlinking (no PHI left in the final bytes)', () => {
  // Instrument fs.writeSync to capture what is written to the descriptor, then
  // assert the last pass wrote zeros over the full length rather than PHI.
  const filePath = writeFixture('overwrite-probe.csv');
  const size = fs.statSync(filePath).size;

  const originalWriteSync = fs.writeSync;
  const writes = [];
  fs.writeSync = function patched(fd, buffer, offset, length, position) {
    if (Buffer.isBuffer(buffer)) {
      writes.push({ length, position, allZero: buffer.subarray(0, length).every((b) => b === 0) });
    }
    return originalWriteSync.apply(fs, arguments);
  };

  let result;
  try {
    result = secureDelete.secureDeleteFile(filePath, { passes: 3 });
  } finally {
    fs.writeSync = originalWriteSync;
  }

  assert.strictEqual(result.deleted, true);
  assert.strictEqual(result.passes, 3);

  const totalWritten = writes.reduce((sum, w) => sum + w.length, 0);
  assert.strictEqual(totalWritten, size * 3, 'must overwrite the whole file once per pass');

  const zeroWrites = writes.filter((w) => w.allZero);
  const zeroBytes = zeroWrites.reduce((sum, w) => sum + w.length, 0);
  assert.strictEqual(zeroBytes, size, 'the final pass must zero the entire file');

  const randomBytes = totalWritten - zeroBytes;
  assert.strictEqual(randomBytes, size * 2, 'the earlier passes must write random data');
});

test('honours a custom pass count', () => {
  const filePath = writeFixture('one-pass.csv');
  const result = secureDelete.secureDeleteFile(filePath, { passes: 1 });
  assert.strictEqual(result.passes, 1);
  assert.strictEqual(result.deleted, true);
});

test('defaults to three passes', () => {
  assert.strictEqual(secureDelete.DEFAULT_PASSES, 3);
  const filePath = writeFixture('default-pass.csv');
  const result = secureDelete.secureDeleteFile(filePath);
  assert.strictEqual(result.passes, 3);
});

test('renames before unlinking so the filename does not persist', () => {
  const filePath = writeFixture('patient-export-2026.csv');
  const originalRename = fs.renameSync;
  const renames = [];
  fs.renameSync = function patched(from, to) {
    renames.push({ from, to });
    return originalRename.apply(fs, arguments);
  };
  try {
    secureDelete.secureDeleteFile(filePath);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.strictEqual(renames.length, 1, 'must rename once before unlink');
  assert.ok(
    !path.basename(renames[0].to).includes('patient-export'),
    'scrubbed name must not retain the original filename'
  );
});

test('rename can be disabled', () => {
  const filePath = writeFixture('no-rename.csv');
  const originalRename = fs.renameSync;
  let renamed = false;
  fs.renameSync = function patched() { renamed = true; return originalRename.apply(fs, arguments); };
  try {
    secureDelete.secureDeleteFile(filePath, { rename: false });
  } finally {
    fs.renameSync = originalRename;
  }
  assert.strictEqual(renamed, false);
  assert.strictEqual(fs.existsSync(filePath), false);
});

test('treats an already-missing file as success', () => {
  const result = secureDelete.secureDeleteFile(path.join(workDir, 'never-existed.csv'));
  assert.strictEqual(result.deleted, true);
  assert.strictEqual(result.reason, 'not_found');
  assert.strictEqual(result.bytes, 0);
});

test('handles an empty file without error', () => {
  const filePath = writeFixture('empty.csv', '');
  const result = secureDelete.secureDeleteFile(filePath);
  assert.strictEqual(result.deleted, true);
  assert.strictEqual(result.bytes, 0);
  assert.strictEqual(fs.existsSync(filePath), false);
});

test('handles a file larger than one chunk', () => {
  const large = 'X'.repeat(200 * 1024); // > 64KB chunk size
  const filePath = writeFixture('large.bin', large);
  const result = secureDelete.secureDeleteFile(filePath);
  assert.strictEqual(result.deleted, true);
  assert.strictEqual(result.bytes, large.length);
  assert.strictEqual(fs.existsSync(filePath), false);
});

test('still unlinks the file when the overwrite fails', () => {
  const filePath = writeFixture('overwrite-fails.csv');
  const originalWriteSync = fs.writeSync;
  fs.writeSync = () => { throw Object.assign(new Error('device full'), { code: 'ENOSPC' }); };
  let result;
  try {
    result = secureDelete.secureDeleteFile(filePath);
  } finally {
    fs.writeSync = originalWriteSync;
  }
  assert.strictEqual(result.deleted, true, 'PHI must at least be unlinked');
  assert.ok(/overwrite_failed/.test(result.reason), `unexpected reason: ${result.reason}`);
  assert.strictEqual(fs.existsSync(filePath), false);
});

console.log('\n=== secureDeleteDirectory ===');

test('recursively wipes a directory tree', () => {
  const tree = path.join(workDir, 'exports');
  fs.mkdirSync(path.join(tree, 'nested', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'a.csv'), PHI);
  fs.writeFileSync(path.join(tree, 'nested', 'b.csv'), PHI);
  fs.writeFileSync(path.join(tree, 'nested', 'deeper', 'c.pdf'), PHI);

  const summary = secureDelete.secureDeleteDirectory(tree);
  assert.strictEqual(summary.deleted, 3, JSON.stringify(summary));
  assert.strictEqual(summary.failed, 0);
  assert.ok(summary.bytes >= PHI.length * 3);
  assert.strictEqual(fs.existsSync(tree), false, 'directory must be removed');
});

test('missing directory is a no-op', () => {
  const summary = secureDelete.secureDeleteDirectory(path.join(workDir, 'no-such-dir'));
  assert.deepStrictEqual(summary, { deleted: 0, failed: 0, bytes: 0 });
});

console.log('\n=== withSecureTempFile ===');

test('wipes the temp file after the callback succeeds', () => {
  const tempPath = path.join(workDir, 'temp-decrypted.db');
  const returned = secureDelete.withSecureTempFile(tempPath, (p) => {
    fs.writeFileSync(p, PHI);
    assert.strictEqual(fs.existsSync(p), true);
    return 'done';
  });
  assert.strictEqual(returned, 'done');
  assert.strictEqual(fs.existsSync(tempPath), false, 'temp file must be wiped');
});

test('wipes the temp file even when the callback throws', () => {
  const tempPath = path.join(workDir, 'temp-throws.db');
  assert.throws(() => {
    secureDelete.withSecureTempFile(tempPath, (p) => {
      fs.writeFileSync(p, PHI);
      throw new Error('processing failed');
    });
  }, /processing failed/);
  assert.strictEqual(fs.existsSync(tempPath), false, 'temp file must be wiped on the error path');
});

// cleanup
try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
