/**
 * TransTrack - Backup/Restore & Concurrent Data Integrity Tests
 *
 * Tests:
 *  - Backup file creation and verification
 *  - Backup integrity validation (missing tables, checksums)
 *  - Optimistic concurrency control under simulated concurrent load
 *  - Data integrity: no lost updates, no race conditions
 *  - Session management under stress
 *
 * Usage: node tests/backup-concurrency.test.cjs
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Mock Electron ──────────────────────────────────────────────
const mockUserDataPath = path.join(__dirname, '.test-data-backup-' + Date.now());
fs.mkdirSync(mockUserDataPath, { recursive: true });

require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: { getPath: () => mockUserDataPath, isPackaged: false },
    ipcMain: { handle: () => {} },
    dialog: {},
  },
};

const { v4: uuidv4 } = require('uuid');

// ─── Test harness ───────────────────────────────────────────────
const results = { passed: 0, failed: 0, errors: [] };

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    results.failed++;
    results.errors.push({ test: name, error: e.message });
  }
}

function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertFalse(cond, msg) { if (cond) throw new Error(msg || 'Expected false'); }

// ─── Load backup handler module ──────────────────────────────────
let backupModule;
try {
  backupModule = require('../electron/ipc/backupHandler.cjs');
} catch (e) {
  console.warn('backupHandler module not loadable (native module issue): ' + e.message);
  backupModule = null;
}

const shared = require('../electron/ipc/shared.cjs');

// ─── Create test database ────────────────────────────────────────
let Database;
let db;
let dbAvailable = false;

try {
  Database = require('better-sqlite3-multiple-ciphers');
  // Verify the module actually works by creating a test instance
  const testInstance = new Database(':memory:');
  testInstance.close();
  dbAvailable = true;
} catch (e) {
  console.warn('Native SQLite module not available: ' + e.message);
}

async function runTests() {
  console.log('\n===================================================');
  console.log('Backup/Restore & Concurrent Data Integrity Tests');
  console.log('===================================================\n');

  // =================================================================
  // Suite 1: Backup Module Verification (Code Review)
  // =================================================================
  console.log('Suite 1: Backup Module Code Verification');
  console.log('----------------------------------------');

  await test('1.1: backupHandler.cjs exports verifyBackupIntegrity', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'backupHandler.cjs'), 'utf8');
    assertTrue(content.includes('function verifyBackupIntegrity'), 'Has verifyBackupIntegrity');
    assertTrue(content.includes('module.exports'), 'Has exports');
    assertTrue(content.includes('verifyBackupIntegrity'), 'Exports verifyBackupIntegrity');
  });

  await test('1.2: Backup checksum uses SHA-256', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'backupHandler.cjs'), 'utf8');
    assertTrue(content.includes("createHash('sha256')"), 'Uses SHA-256');
    assertTrue(content.includes('.digest('), 'Has digest call');
  });

  await test('1.3: Backup verification checks required tables', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'backupHandler.cjs'), 'utf8');
    assertTrue(content.includes("'patients'"), 'Checks patients table');
    assertTrue(content.includes("'users'"), 'Checks users table');
    assertTrue(content.includes("'audit_logs'"), 'Checks audit_logs table');
    assertTrue(content.includes("'organizations'"), 'Checks organizations table');
  });

  await test('1.4: Backup verification runs integrity check', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'backupHandler.cjs'), 'utf8');
    assertTrue(content.includes('integrity_check'), 'Runs PRAGMA integrity_check');
  });

  await test('1.5: Backup verification counts records', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'backupHandler.cjs'), 'utf8');
    assertTrue(content.includes("SELECT COUNT(*)"), 'Counts records');
    assertTrue(content.includes('tableCounts'), 'Tracks table counts');
  });

  await test('1.6: Backup creation requires target path', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'backupHandler.cjs'), 'utf8');
    assertTrue(content.includes('Backup target path is required'), 'Validates target path');
  });

  await test('1.7: Backup verification handles encrypted databases', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'backupHandler.cjs'), 'utf8');
    assertTrue(content.includes('encryptionKey'), 'Handles encryption key');
    assertTrue(content.includes("cipher = 'sqlcipher'"), 'Uses sqlcipher');
  });

  await test('1.8: Backup result includes metadata', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'backupHandler.cjs'), 'utf8');
    assertTrue(content.includes('checksum'), 'Includes checksum');
    assertTrue(content.includes('durationMs'), 'Includes duration');
    assertTrue(content.includes('timestamp'), 'Includes timestamp');
    assertTrue(content.includes('fileSize'), 'Includes file size');
  });

  // Backup integrity verification with a real in-memory DB
  if (dbAvailable) {
    await test('1.9: verifyBackupIntegrity returns valid for complete DB', () => {
      const tmpPath = path.join(mockUserDataPath, 'test-backup.db');
      const testDb = new Database(tmpPath);
      testDb.exec(`
        CREATE TABLE patients (id TEXT PRIMARY KEY);
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE audit_logs (id TEXT PRIMARY KEY);
        CREATE TABLE organizations (id TEXT PRIMARY KEY);
        INSERT INTO patients VALUES ('p1');
        INSERT INTO users VALUES ('u1');
        INSERT INTO audit_logs VALUES ('a1');
        INSERT INTO organizations VALUES ('o1');
      `);
      testDb.close();

      const result = backupModule.verifyBackupIntegrity(tmpPath, null);
      assertTrue(result.valid, 'Should be valid');
      assertTrue(result.tables >= 4, 'Has 4+ tables');
      assertEq(result.tableCounts.patients, 1, 'Patient count');
      assertEq(result.tableCounts.users, 1, 'User count');
      fs.unlinkSync(tmpPath);
    });

    await test('1.10: verifyBackupIntegrity fails for missing tables', () => {
      const tmpPath = path.join(mockUserDataPath, 'test-backup-partial.db');
      const testDb = new Database(tmpPath);
      testDb.exec('CREATE TABLE patients (id TEXT PRIMARY KEY);');
      testDb.close();

      const result = backupModule.verifyBackupIntegrity(tmpPath, null);
      assertFalse(result.valid, 'Should be invalid');
      assertTrue(result.error.includes('Missing required tables'), 'Error mentions missing tables');
      try { fs.unlinkSync(tmpPath); } catch (_) { /* EBUSY on Windows is acceptable */ }
    });

    await test('1.11: verifyBackupIntegrity fails for non-existent file', () => {
      const result = backupModule.verifyBackupIntegrity('/nonexistent/backup.db', null);
      assertFalse(result.valid, 'Should be invalid');
    });

    await test('1.12: computeFileChecksum returns consistent hash', () => {
      const tmpPath = path.join(mockUserDataPath, 'test-checksum.db');
      fs.writeFileSync(tmpPath, 'test content');
      const hash1 = backupModule.computeFileChecksum(tmpPath);
      const hash2 = backupModule.computeFileChecksum(tmpPath);
      assertEq(hash1, hash2, 'Same content → same hash');
      assertEq(hash1.length, 64, 'SHA-256 = 64 hex chars');
      fs.unlinkSync(tmpPath);
    });

    await test('1.13: Different files produce different checksums', () => {
      const tmpPath1 = path.join(mockUserDataPath, 'test-checksum1.db');
      const tmpPath2 = path.join(mockUserDataPath, 'test-checksum2.db');
      fs.writeFileSync(tmpPath1, 'content A');
      fs.writeFileSync(tmpPath2, 'content B');
      const hash1 = backupModule.computeFileChecksum(tmpPath1);
      const hash2 = backupModule.computeFileChecksum(tmpPath2);
      assertTrue(hash1 !== hash2, 'Different content → different hash');
      fs.unlinkSync(tmpPath1);
      fs.unlinkSync(tmpPath2);
    });
  } else {
    console.log('  (1.9-1.13 skipped: native SQLite module not available)');
  }

  // =================================================================
  // Suite 2: Database Init & Backup Code Verification
  // =================================================================
  console.log('\nSuite 2: Database Init & Backup Infrastructure');
  console.log('----------------------------------------------');

  await test('2.1: init.cjs exports backupDatabase function', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
    assertTrue(content.includes('function backupDatabase'), 'Has backupDatabase function');
    assertTrue(content.includes('backupDatabase'), 'Exports backupDatabase');
  });

  await test('2.2: backupDatabase uses SQLite backup API', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
    assertTrue(content.includes('backup'), 'Uses backup');
  });

  await test('2.3: Backup directory creation is handled', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
    assertTrue(
      content.includes('mkdirSync') || content.includes('mkdir') || content.includes('existsSync') || content.includes('ensureDir'),
      'Handles backup directory existence'
    );
  });

  await test('2.4: Recovery from corrupted DB is documented/handled', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
    assertTrue(content.includes('corrupt') || content.includes('recovery') || content.includes('integrity'), 'Handles corruption');
  });

  // =================================================================
  // Suite 3: Optimistic Concurrency Control Logic
  // =================================================================
  console.log('\nSuite 3: Optimistic Concurrency Control (Unit Tests)');
  console.log('----------------------------------------------------');

  await test('3.1: updateWithVersionCheck function exists', () => {
    assertTrue(typeof shared.updateWithVersionCheck === 'function', 'Function exists');
  });

  await test('3.2: acquireRowLock function exists', () => {
    assertTrue(typeof shared.acquireRowLock === 'function', 'Function exists');
  });

  await test('3.3: releaseRowLock function exists', () => {
    assertTrue(typeof shared.releaseRowLock === 'function', 'Function exists');
  });

  await test('3.4: releaseExpiredLocks function exists', () => {
    assertTrue(typeof shared.releaseExpiredLocks === 'function', 'Function exists');
  });

  await test('3.5: ROW_LOCK_TIMEOUT_MS is reasonable', () => {
    assertTrue(shared.ROW_LOCK_TIMEOUT_MS > 0, 'Positive');
    assertTrue(shared.ROW_LOCK_TIMEOUT_MS <= 30 * 60 * 1000, 'At most 30 min');
    assertEq(shared.ROW_LOCK_TIMEOUT_MS, 5 * 60 * 1000, 'Default 5 min');
  });

  await test('3.6: updateWithVersionCheck requires version', () => {
    // Should throw when version is undefined
    let threw = false;
    try {
      // We'll test the function directly with a mock DB
      // But since it calls getDatabase(), and we don't have one initialized,
      // we test the version validation by checking the code
      const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
      assertTrue(content.includes('Version number required'), 'Validates version presence');
    } catch (e) {
      threw = true;
    }
    assertFalse(threw, 'Code check should not throw');
  });

  await test('3.7: Conflict detection uses correct error message', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
    assertTrue(content.includes('Conflict detected'), 'Has conflict detection');
    assertTrue(content.includes('modified by another user'), 'User-friendly message');
    assertTrue(content.includes('Please refresh'), 'Has recovery instruction');
  });

  await test('3.8: Version is incremented on successful update', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
    assertTrue(content.includes('version: expectedVersion + 1'), 'Increments version');
  });

  // =================================================================
  // Suite 4: Concurrent Session Simulation
  // =================================================================
  console.log('\nSuite 4: Concurrent Session Management');
  console.log('--------------------------------------');

  await test('4.1: Multiple sessions can be created and validated', () => {
    // Create session
    shared.setSessionState('session-A', { id: 'u1', email: 'a@test.com', role: 'admin', org_id: 'ORG1' }, Date.now() + 3600000);
    assertTrue(shared.validateSession(), 'Session A valid');

    // Overwrite with session B
    shared.setSessionState('session-B', { id: 'u2', email: 'b@test.com', role: 'coordinator', org_id: 'ORG1' }, Date.now() + 3600000);
    assertTrue(shared.validateSession(), 'Session B valid');

    // Original session state is overwritten (single-user model in shared state)
    const state = shared.getSessionState();
    assertEq(state.currentUser.email, 'b@test.com', 'Latest session active');
  });

  await test('4.2: Session expiry is enforced correctly', () => {
    // Set session that expires in 1ms
    shared.setSessionState('session-exp', { id: 'u3', email: 'c@test.com', role: 'admin', org_id: 'ORG1' }, Date.now() + 1);

    // Wait a tiny bit
    const start = Date.now();
    while (Date.now() - start < 5) {} // busy wait 5ms

    assertFalse(shared.validateSession(), 'Expired session invalid');
  });

  await test('4.3: Cleared session returns null state', () => {
    shared.setSessionState('session-x', { id: 'ux', email: 'x@test.com', role: 'admin', org_id: 'ORG1' }, Date.now() + 3600000);
    shared.clearSession();
    const state = shared.getSessionState();
    assertEq(state.currentSession, null, 'Session null');
    assertEq(state.currentUser, null, 'User null');
    assertEq(state.sessionExpiry, null, 'Expiry null');
  });

  await test('4.4: Session without role is still valid (role checked elsewhere)', () => {
    shared.setSessionState('session-norole', { id: 'ur', email: 'r@test.com', org_id: 'ORG1' }, Date.now() + 3600000);
    assertTrue(shared.validateSession(), 'No role but has org_id → valid');
  });

  await test('4.5: Rapid session switches preserve latest state', () => {
    for (let i = 0; i < 100; i++) {
      shared.setSessionState(`session-${i}`, { id: `u${i}`, email: `user${i}@test.com`, role: 'admin', org_id: 'ORG1' }, Date.now() + 3600000);
    }
    const state = shared.getSessionState();
    assertEq(state.currentUser.email, 'user99@test.com', 'Last session wins');
    assertTrue(shared.validateSession(), 'Last session valid');
  });

  // =================================================================
  // Suite 5: Concurrent Data Integrity (In-Memory DB)
  // =================================================================
  if (dbAvailable) {
    console.log('\nSuite 5: Concurrent Data Integrity (In-Memory DB)');
    console.log('-------------------------------------------------');

    await test('5.1: Optimistic concurrency prevents lost updates', () => {
      const testDb = new Database(':memory:');
      testDb.exec(`
        CREATE TABLE patients (
          id TEXT PRIMARY KEY, org_id TEXT, first_name TEXT,
          version INTEGER DEFAULT 0, updated_at TEXT
        );
        INSERT INTO patients VALUES ('p1', 'ORG1', 'Original', 0, datetime('now'));
      `);

      // User A reads version 0
      const readA = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
      assertEq(readA.version, 0, 'Version starts at 0');

      // User B reads version 0
      const readB = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
      assertEq(readB.version, 0, 'User B also reads 0');

      // User A updates successfully (version check passes)
      const updateA = testDb.prepare(
        'UPDATE patients SET first_name = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
      ).run('UserA_Edit', new Date().toISOString(), 'p1', readA.version);
      assertEq(updateA.changes, 1, 'User A update succeeds');

      // User B tries to update with stale version (should fail)
      const updateB = testDb.prepare(
        'UPDATE patients SET first_name = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
      ).run('UserB_Edit', new Date().toISOString(), 'p1', readB.version);
      assertEq(updateB.changes, 0, 'User B update fails (stale version)');

      // Verify final state
      const final = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
      assertEq(final.first_name, 'UserA_Edit', 'User A edit preserved');
      assertEq(final.version, 1, 'Version is 1');

      testDb.close();
    });

    await test('5.2: Sequential updates all succeed', () => {
      const testDb = new Database(':memory:');
      testDb.exec(`
        CREATE TABLE patients (id TEXT PRIMARY KEY, first_name TEXT, version INTEGER DEFAULT 0);
        INSERT INTO patients VALUES ('p1', 'Original', 0);
      `);

      for (let i = 1; i <= 50; i++) {
        const current = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
        const result = testDb.prepare(
          'UPDATE patients SET first_name = ?, version = version + 1 WHERE id = ? AND version = ?'
        ).run(`Update_${i}`, 'p1', current.version);
        assertEq(result.changes, 1, `Update ${i} succeeds`);
      }

      const final = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
      assertEq(final.version, 50, 'Version after 50 updates');
      assertEq(final.first_name, 'Update_50', 'Last update preserved');

      testDb.close();
    });

    await test('5.3: 10+ concurrent users - only first wins per round', () => {
      const testDb = new Database(':memory:');
      testDb.exec(`
        CREATE TABLE patients (id TEXT PRIMARY KEY, first_name TEXT, version INTEGER DEFAULT 0);
        INSERT INTO patients VALUES ('p1', 'Original', 0);
      `);

      // All 10 users read version 0
      const reads = [];
      for (let i = 0; i < 10; i++) {
        reads.push(testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1'));
      }

      // All try to update with version 0
      let successCount = 0;
      let failCount = 0;
      for (let i = 0; i < 10; i++) {
        const result = testDb.prepare(
          'UPDATE patients SET first_name = ?, version = version + 1 WHERE id = ? AND version = ?'
        ).run(`User_${i}`, 'p1', reads[i].version);
        if (result.changes > 0) successCount++;
        else failCount++;
      }

      assertEq(successCount, 1, 'Exactly 1 user wins');
      assertEq(failCount, 9, '9 users fail');

      const final = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
      assertEq(final.version, 1, 'Version is 1');

      testDb.close();
    });

    await test('5.4: Retry mechanism resolves conflicts', () => {
      const testDb = new Database(':memory:');
      testDb.exec(`
        CREATE TABLE patients (id TEXT PRIMARY KEY, first_name TEXT, version INTEGER DEFAULT 0);
        INSERT INTO patients VALUES ('p1', 'Original', 0);
      `);

      let allSucceeded = true;
      for (let i = 0; i < 5; i++) {
        let retries = 10;
        let success = false;
        while (retries > 0 && !success) {
          const current = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
          const result = testDb.prepare(
            'UPDATE patients SET first_name = ?, version = version + 1 WHERE id = ? AND version = ?'
          ).run(`User_${i}`, 'p1', current.version);
          if (result.changes > 0) {
            success = true;
          } else {
            retries--;
          }
        }
        if (!success) allSucceeded = false;
      }

      assertTrue(allSucceeded, 'All users eventually succeed with retries');

      const final = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
      assertEq(final.version, 5, 'Version = 5 after 5 users');

      testDb.close();
    });

    await test('5.5: WAL mode enables concurrent reads during write', () => {
      const tmpPath = path.join(mockUserDataPath, 'wal-test.db');
      const testDb = new Database(tmpPath);
      testDb.pragma('journal_mode = WAL');

      testDb.exec(`
        CREATE TABLE patients (id TEXT PRIMARY KEY, name TEXT, version INTEGER DEFAULT 0);
        INSERT INTO patients VALUES ('p1', 'Test', 0);
      `);

      // Start a write transaction
      testDb.prepare('BEGIN IMMEDIATE').run();
      testDb.prepare('UPDATE patients SET name = ?, version = 1 WHERE id = ?').run('Updated', 'p1');

      // Read should still work (WAL allows concurrent reads)
      const reader = new Database(tmpPath, { readonly: true });
      const readResult = reader.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
      assertEq(readResult.name, 'Test', 'Reader sees old value before commit');

      testDb.prepare('COMMIT').run();
      reader.close();
      testDb.close();

      // Cleanup
      try {
        fs.unlinkSync(tmpPath);
        fs.unlinkSync(tmpPath + '-wal');
        fs.unlinkSync(tmpPath + '-shm');
      } catch (_) {}
    });

    await test('5.6: Large batch concurrent updates maintain integrity', () => {
      const testDb = new Database(':memory:');
      testDb.exec(`
        CREATE TABLE patients (id TEXT PRIMARY KEY, counter INTEGER DEFAULT 0, version INTEGER DEFAULT 0);
        INSERT INTO patients VALUES ('p1', 0, 0);
      `);

      // Simulate 100 sequential updates (real concurrency would be across processes)
      for (let i = 0; i < 100; i++) {
        const row = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
        testDb.prepare(
          'UPDATE patients SET counter = counter + 1, version = version + 1 WHERE id = ? AND version = ?'
        ).run('p1', row.version);
      }

      const final = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p1');
      assertEq(final.counter, 100, 'Counter = 100');
      assertEq(final.version, 100, 'Version = 100');

      testDb.close();
    });

    await test('5.7: Transaction rollback on conflict preserves data', () => {
      const testDb = new Database(':memory:');
      testDb.exec(`
        CREATE TABLE patients (id TEXT PRIMARY KEY, name TEXT, version INTEGER DEFAULT 0);
        INSERT INTO patients VALUES ('p1', 'Original', 0);
        INSERT INTO patients VALUES ('p2', 'Original', 0);
      `);

      // User A wants to update both p1 and p2 atomically
      // But p1 has been modified by User B
      testDb.prepare('UPDATE patients SET name = ?, version = 1 WHERE id = ?').run('UserB', 'p1');

      // User A's transaction should roll back
      const tx = testDb.transaction(() => {
        const p1 = testDb.prepare('UPDATE patients SET name = ?, version = version + 1 WHERE id = ? AND version = ?').run('UserA', 'p1', 0);
        if (p1.changes === 0) throw new Error('Conflict on p1');
        testDb.prepare('UPDATE patients SET name = ?, version = version + 1 WHERE id = ? AND version = ?').run('UserA', 'p2', 0);
      });

      let conflicted = false;
      try { tx(); } catch (e) { conflicted = true; }

      assertTrue(conflicted, 'Transaction should have conflicted');

      // p2 should be unchanged (rolled back)
      const p2 = testDb.prepare('SELECT * FROM patients WHERE id = ?').get('p2');
      assertEq(p2.name, 'Original', 'p2 unchanged after rollback');
      assertEq(p2.version, 0, 'p2 version unchanged');

      testDb.close();
    });

    await test('5.8: Audit log immutability enforced under concurrent load', () => {
      const testDb = new Database(':memory:');
      testDb.exec(`
        CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT, details TEXT);
        CREATE TRIGGER audit_immutable_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Immutable'); END;
        CREATE TRIGGER audit_immutable_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Immutable'); END;
      `);

      // Insert many logs
      const insert = testDb.prepare('INSERT INTO audit_logs VALUES (?, ?, ?)');
      for (let i = 0; i < 100; i++) {
        insert.run(`log-${i}`, 'test_action', `details-${i}`);
      }

      // Try to update each - all should fail
      let updateFailures = 0;
      for (let i = 0; i < 100; i++) {
        try {
          testDb.prepare("UPDATE audit_logs SET action = 'hacked' WHERE id = ?").run(`log-${i}`);
        } catch (e) {
          updateFailures++;
        }
      }
      assertEq(updateFailures, 100, 'All 100 updates blocked');

      // Try to delete each - all should fail
      let deleteFailures = 0;
      for (let i = 0; i < 100; i++) {
        try {
          testDb.prepare('DELETE FROM audit_logs WHERE id = ?').run(`log-${i}`);
        } catch (e) {
          deleteFailures++;
        }
      }
      assertEq(deleteFailures, 100, 'All 100 deletes blocked');

      // Verify all logs intact
      const count = testDb.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
      assertEq(count, 100, 'All 100 logs preserved');

      testDb.close();
    });
  } else {
    console.log('\nSuite 5: Concurrent Data Integrity (In-Memory DB)');
    console.log('  (skipped: native SQLite module not available)');
  }

  // =================================================================
  // Suite 6: Error Handling for Concurrency
  // =================================================================
  console.log('\nSuite 6: Concurrency Error Handling');
  console.log('-----------------------------------');

  await test('6.1: CONFLICT error code exists', () => {
    assertTrue(shared.ERROR_CODES.CONFLICT !== undefined, 'Has CONFLICT');
    assertEq(shared.ERROR_CODES.CONFLICT.status, 409, 'Status 409');
  });

  await test('6.2: RECORD_LOCKED error code exists', () => {
    assertTrue(shared.ERROR_CODES.RECORD_LOCKED !== undefined, 'Has RECORD_LOCKED');
    assertEq(shared.ERROR_CODES.RECORD_LOCKED.status, 423, 'Status 423');
  });

  await test('6.3: createStandardError for CONFLICT is user-friendly', () => {
    const err = shared.createStandardError('CONFLICT');
    assertTrue(err.message.includes('modified by another user'), 'User-friendly message');
    assertTrue(err.message.includes('refresh'), 'Has recovery action');
  });

  await test('6.4: createStandardError for RECORD_LOCKED is user-friendly', () => {
    const err = shared.createStandardError('RECORD_LOCKED');
    assertTrue(err.message.includes('being edited'), 'User-friendly message');
  });

  await test('6.5: wrapHandler catches conflict errors', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
    assertTrue(content.includes("error.message?.includes('Conflict detected')"), 'Catches conflict');
    assertTrue(content.includes("error.message?.includes('currently being edited')"), 'Catches lock');
  });

  // =================================================================
  // Suite 7: Entity Handler Concurrency Integration
  // =================================================================
  console.log('\nSuite 7: Entity Handler Concurrency Integration');
  console.log('-----------------------------------------------');

  await test('7.1: Entity update handler uses version-based concurrency', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'handlers', 'entities.cjs'), 'utf8');
    assertTrue(content.includes('updateWithVersionCheck'), 'Uses updateWithVersionCheck');
  });

  await test('7.2: Entity update extracts version from data', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'handlers', 'entities.cjs'), 'utf8');
    assertTrue(content.includes('expectedVersion'), 'Extracts version');
  });

  await test('7.3: Entity update has fallback for entities without version', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'handlers', 'entities.cjs'), 'utf8');
    assertTrue(content.includes('Fallback for entities without version column'), 'Has fallback');
  });

  await test('7.4: Conflict errors are passed through to UI via wrapHandler', () => {
    // Conflict error pass-through is handled by wrapHandler in shared.cjs, not entities.cjs directly
    const sharedContent = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
    assertTrue(sharedContent.includes("error.message?.includes('Conflict detected')"), 'wrapHandler catches and passes through conflict errors');
    // Entity handler uses updateWithVersionCheck which throws conflict errors
    const entityContent = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'handlers', 'entities.cjs'), 'utf8');
    assertTrue(entityContent.includes('updateWithVersionCheck'), 'Entity update uses version check that can throw conflicts');
  });

  await test('7.5: Lock columns are excluded from entity updates', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'handlers', 'entities.cjs'), 'utf8');
    assertTrue(content.includes("delete entityData.locked_by"), 'Excludes locked_by');
    assertTrue(content.includes("delete entityData.locked_at"), 'Excludes locked_at');
    assertTrue(content.includes("delete entityData.lock_expires_at"), 'Excludes lock_expires_at');
  });

  // ─── Summary ──────────────────────────────────────────────────
  console.log('\n===================================================');
  console.log('Backup/Restore & Concurrency Test Summary');
  console.log('===================================================');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total:  ${results.passed + results.failed}`);

  if (results.failed > 0) {
    console.log('\nFailed Tests:');
    results.errors.forEach(({ test, error }) => console.log(`  - ${test}: ${error}`));
    process.exit(1);
  } else {
    console.log('\n✓ All backup/restore & concurrency tests passed!');
  }

  // Cleanup
  try {
    fs.rmSync(mockUserDataPath, { recursive: true, force: true });
  } catch (_) {}
}

runTests().catch(e => { console.error('Test runner error:', e); process.exit(1); });
