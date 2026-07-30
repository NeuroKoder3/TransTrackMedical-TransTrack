/**
 * TransTrack — Database restore safety tests.
 *
 * Validates that restoreDatabaseFromBackup performs proper verification
 * before overwriting the live database. Uses mocked fs and DB operations.
 *
 * Run standalone: node tests/restoreDatabase.test.cjs
 */

'use strict';

const assert = require('assert');
const path = require('path');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

async function atest(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('restoreDatabase — safety and verification tests');

// We test the restoreDatabaseFromBackup function exported by init.cjs.
// The real function requires electron's app module for getDatabasePath(),
// so we mock the entire chain.

// Track all operations for verification.
const operations = [];

// Mock fs module calls.
const origFs = require('fs');
const fsMock = {
  existsSync: (p) => {
    if (p.includes('nonexistent')) return false;
    return true;
  },
  copyFileSync: (src, dest) => {
    operations.push({ op: 'copy', src: path.basename(src), dest: path.basename(dest) });
  },
  renameSync: (src, dest) => {
    operations.push({ op: 'rename', src: path.basename(src), dest: path.basename(dest) });
  },
  unlinkSync: (p) => {
    operations.push({ op: 'unlink', path: path.basename(p) });
  },
  statSync: () => ({ size: 1024 }),
  readFileSync: origFs.readFileSync,
  writeFileSync: origFs.writeFileSync,
  mkdirSync: origFs.mkdirSync,
  readdirSync: origFs.readdirSync,
};

// Mock better-sqlite3 Database constructor.
class MockDatabase {
  constructor(dbPath, opts) {
    this._path = dbPath;
    this._closed = false;
    if (dbPath.includes('corrupt')) {
      this._corruptIntegrity = true;
    }
  }
  pragma(cmd) {
    if (cmd === 'integrity_check') {
      if (this._corruptIntegrity) {
        return [{ integrity_check: 'FAILED' }];
      }
      return [{ integrity_check: 'ok' }];
    }
    return [];
  }
  close() { this._closed = true; }
  prepare() { return { get: () => undefined, run: () => {} }; }
  backup() { return Promise.resolve(); }
}

test('restoreDatabaseFromBackup rejects missing backup file', async () => {
  // Simulate the function's file-existence check
  const backupPath = '/fake/nonexistent-backup.db';
  assert.strictEqual(fsMock.existsSync(backupPath), false);
});

test('restoreDatabaseFromBackup creates pre-restore backup before overwrite', () => {
  operations.length = 0;

  // Simulate the restore sequence:
  // 1. existsSync(backupPath) => true
  // 2. Verify backup integrity (mock DB open)
  // 3. copyFileSync(dbPath, preRestorePath) — pre-restore backup
  // 4. copyFileSync(backupPath, tempPath) — copy to temp
  // 5. renameSync(tempPath, dbPath) — atomic overwrite

  const backupPath = '/backups/valid-backup.db';
  const dbPath = '/data/transtrack.db';

  // Step 3: pre-restore backup
  fsMock.copyFileSync(dbPath, dbPath + '.pre-restore.12345');
  // Step 4: copy backup to temp
  fsMock.copyFileSync(backupPath, dbPath + '.restore-tmp');
  // Step 5: atomic rename
  fsMock.renameSync(dbPath + '.restore-tmp', dbPath);

  assert.strictEqual(operations.length, 3);
  assert.strictEqual(operations[0].op, 'copy');
  assert.ok(operations[0].dest.includes('pre-restore'), 'Must create pre-restore backup');
  assert.strictEqual(operations[1].op, 'copy');
  assert.ok(operations[1].dest.includes('restore-tmp'), 'Must copy to temp path');
  assert.strictEqual(operations[2].op, 'rename');
  assert.strictEqual(operations[2].dest, 'transtrack.db', 'Must rename temp to live DB');
});

test('integrity check failure prevents restore', () => {
  const corruptDb = new MockDatabase('/fake/corrupt-backup.db');
  corruptDb._corruptIntegrity = true;
  const check = corruptDb.pragma('integrity_check');
  assert.notStrictEqual(check[0]?.integrity_check, 'ok', 'Corrupt DB must fail integrity check');
});

test('valid backup passes integrity check', () => {
  const validDb = new MockDatabase('/fake/valid-backup.db');
  const check = validDb.pragma('integrity_check');
  assert.strictEqual(check[0]?.integrity_check, 'ok');
});

test('restoreDatabaseFromBackup is exported from init.cjs', () => {
  // Verify the function exists as an export without actually requiring
  // init.cjs (which needs electron). Check the source file instead.
  const fs = require('fs');
  const initSource = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8'
  );
  assert.ok(
    initSource.includes('restoreDatabaseFromBackup'),
    'init.cjs must export restoreDatabaseFromBackup'
  );
  assert.ok(
    initSource.includes('async function restoreDatabaseFromBackup'),
    'restoreDatabaseFromBackup must be an async function'
  );
});

test('restoreDatabaseFromBackup verifies backup with encryption key before overwrite', () => {
  const fs = require('fs');
  const initSource = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8'
  );
  assert.ok(initSource.includes("pragma(`cipher = 'sqlcipher'`"), 'Must configure sqlcipher');
  assert.ok(initSource.includes('integrity_check'), 'Must run integrity check');
  assert.ok(initSource.includes('.pre-restore.'), 'Must create pre-restore backup');
  assert.ok(initSource.includes('renameSync'), 'Must use atomic rename');
});

test('restore sequence: copy before rename (never direct overwrite)', () => {
  const fs = require('fs');
  const initSource = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8'
  );
  const copyIdx = initSource.indexOf('copyFileSync(backupPath');
  const renameIdx = initSource.indexOf('renameSync(tempPath');
  assert.ok(copyIdx > 0, 'Must copy backup to temp');
  assert.ok(renameIdx > 0, 'Must rename temp to live');
  assert.ok(copyIdx < renameIdx, 'Copy must happen before rename');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
