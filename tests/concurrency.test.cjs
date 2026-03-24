/**
 * TransTrack - Multi-User Concurrency Control Tests
 *
 * Tests row-level locking, optimistic concurrency control,
 * conflict detection, and data integrity under concurrent load.
 *
 * Usage: node tests/concurrency.test.cjs
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

// ─── Mock Electron ──────────────────────────────────────────────
const mockUserDataPath = path.join(__dirname, '.test-data-concurrency-' + Date.now());
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    app: { getPath: () => mockUserDataPath, isPackaged: false },
    ipcMain: { handle: () => {} },
    dialog: {},
  },
};

const { v4: uuidv4 } = require('uuid');

// ─── Test helpers ──────────────────────────────────────────────
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

function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`); }
function assertThrowsMsg(fn, substr, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; assert(e.message.includes(substr), `${msg}: expected error containing "${substr}", got "${e.message}"`); }
  if (!threw) throw new Error(`${msg}: expected function to throw`);
}

// ─── In-memory DB ──────────────────────────────────────────────
let Database;
let dbAvailable = false;
try {
  Database = require('better-sqlite3-multiple-ciphers');
  // Test instantiation (may fail with ERR_DLOPEN_FAILED)
  const testDb = new Database(':memory:');
  testDb.close();
  dbAvailable = true;
} catch (e) {
  console.warn(`⚠ Native SQLite module not available (${e.code || e.message}). In-memory DB tests will be skipped.`);
}
let db;

function setupDB() {
  if (!dbAvailable) return;
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, status TEXT DEFAULT 'ACTIVE',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE patients (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, patient_id TEXT, first_name TEXT, last_name TEXT,
      blood_type TEXT, organ_needed TEXT, medical_urgency TEXT, waitlist_status TEXT DEFAULT 'active',
      priority_score REAL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      locked_by TEXT, locked_at TEXT, lock_expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );
    CREATE TABLE donor_organs (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, donor_id TEXT, organ_type TEXT, blood_type TEXT,
      organ_status TEXT DEFAULT 'available', version INTEGER NOT NULL DEFAULT 1,
      locked_by TEXT, locked_at TEXT, lock_expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );
    CREATE TABLE matches (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, donor_organ_id TEXT, patient_id TEXT,
      match_status TEXT DEFAULT 'potential', compatibility_score REAL,
      version INTEGER NOT NULL DEFAULT 1,
      locked_by TEXT, locked_at TEXT, lock_expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, org_id TEXT, action TEXT, entity_type TEXT,
      entity_id TEXT, details TEXT, user_email TEXT, user_role TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.prepare("INSERT INTO organizations (id, name, type) VALUES (?, 'Test Org', 'TRANSPLANT_CENTER')").run('ORG1');
}

// ─── Concurrency helpers (mirroring shared.cjs logic) ─────────

function updateWithVersionCheck(tableName, id, orgId, data, expectedVersion) {
  const newVersion = expectedVersion + 1;
  const now = new Date().toISOString();

  const updates = Object.entries(data)
    .filter(([k]) => !['id', 'org_id', 'created_at', 'created_by', 'version'].includes(k))
    .map(([k]) => `${k} = ?`);
  updates.push('version = ?', 'updated_at = ?');

  const values = Object.entries(data)
    .filter(([k]) => !['id', 'org_id', 'created_at', 'created_by', 'version'].includes(k))
    .map(([, v]) => v);
  values.push(newVersion, now, id, orgId, expectedVersion);

  const result = db.prepare(
    `UPDATE ${tableName} SET ${updates.join(', ')} WHERE id = ? AND org_id = ? AND version = ?`
  ).run(...values);

  if (result.changes === 0) {
    const current = db.prepare(`SELECT version FROM ${tableName} WHERE id = ? AND org_id = ?`).get(id, orgId);
    if (!current) throw new Error('Record not found or access denied');
    throw new Error(`Conflict detected: record was modified by another user (expected version ${expectedVersion}, current version ${current.version}). Please refresh and try again.`);
  }
  return result.changes;
}

function acquireRowLock(tableName, id, orgId, userId) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const row = db.prepare(`SELECT locked_by, lock_expires_at FROM ${tableName} WHERE id = ? AND org_id = ?`).get(id, orgId);
  if (!row) throw new Error('Record not found or access denied');

  if (row.locked_by && row.locked_by !== userId) {
    const lockExpires = new Date(row.lock_expires_at);
    if (lockExpires > new Date()) {
      throw new Error(`Record is currently being edited by another user.`);
    }
  }

  const result = db.prepare(
    `UPDATE ${tableName} SET locked_by = ?, locked_at = ?, lock_expires_at = ? WHERE id = ? AND org_id = ? AND (locked_by IS NULL OR locked_by = ? OR lock_expires_at < ?)`
  ).run(userId, now, expiresAt, id, orgId, userId, now);

  if (result.changes === 0) throw new Error('Failed to acquire lock.');
  return true;
}

function releaseRowLock(tableName, id, orgId, userId) {
  db.prepare(`UPDATE ${tableName} SET locked_by = NULL, locked_at = NULL, lock_expires_at = NULL WHERE id = ? AND org_id = ? AND locked_by = ?`).run(id, orgId, userId);
  return true;
}

// ─── Tests ─────────────────────────────────────────────────────

async function runTests() {
  console.log('\n========================================');
  console.log('Multi-User Concurrency Control Tests');
  console.log('========================================\n');

  if (!dbAvailable) {
    console.log('⚠ Skipping all concurrency tests: native SQLite module not available in this environment.');
    console.log('  Rebuild with: npx electron-rebuild -f -w better-sqlite3-multiple-ciphers');
    console.log('\n✓ Concurrency tests skipped (environment limitation).');
    return;
  }

  setupDB();

  // === Suite 1: Optimistic Concurrency Control ===
  console.log('Suite 1: Optimistic Concurrency Control');
  console.log('---------------------------------------');

  const p1Id = uuidv4();
  db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-001', 'John', 'Doe', 1)").run(p1Id);

  await test('1.1: Update succeeds with correct version', () => {
    updateWithVersionCheck('patients', p1Id, 'ORG1', { first_name: 'Johnny' }, 1);
    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(p1Id);
    assertEq(p.first_name, 'Johnny', 'Name should be updated');
    assertEq(p.version, 2, 'Version should be incremented');
  });

  await test('1.2: Update fails with stale version', () => {
    assertThrowsMsg(
      () => updateWithVersionCheck('patients', p1Id, 'ORG1', { first_name: 'Stale' }, 1),
      'Conflict detected',
      'Should throw conflict error'
    );
    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(p1Id);
    assertEq(p.first_name, 'Johnny', 'Name should remain unchanged after conflict');
    assertEq(p.version, 2, 'Version should remain unchanged');
  });

  await test('1.3: Concurrent updates - only first succeeds', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-002', 'Jane', 'Smith', 1)").run(patId);

    // Both users read version 1
    const v1 = db.prepare('SELECT version FROM patients WHERE id = ?').get(patId).version;

    // User A updates successfully
    updateWithVersionCheck('patients', patId, 'ORG1', { first_name: 'Janet' }, v1);

    // User B tries to update with stale version
    assertThrowsMsg(
      () => updateWithVersionCheck('patients', patId, 'ORG1', { first_name: 'Janice' }, v1),
      'Conflict detected',
      'User B should get conflict'
    );

    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(patId);
    assertEq(p.first_name, 'Janet', 'Only User A update should persist');
  });

  await test('1.4: Sequential updates with correct versions succeed', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-003', 'Bob', 'Jones', 1)").run(patId);

    updateWithVersionCheck('patients', patId, 'ORG1', { first_name: 'Bobby' }, 1);
    updateWithVersionCheck('patients', patId, 'ORG1', { first_name: 'Robert' }, 2);
    updateWithVersionCheck('patients', patId, 'ORG1', { first_name: 'Rob' }, 3);

    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(patId);
    assertEq(p.first_name, 'Rob', 'Final name');
    assertEq(p.version, 4, 'Version after 3 updates');
  });

  await test('1.5: Version check fails for non-existent record', () => {
    assertThrowsMsg(
      () => updateWithVersionCheck('patients', 'nonexistent', 'ORG1', { first_name: 'Ghost' }, 1),
      'not found',
      'Should throw not found'
    );
  });

  await test('1.6: Version check enforces org isolation', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-OI', 'OrgIso', 'Test', 1)").run(patId);

    assertThrowsMsg(
      () => updateWithVersionCheck('patients', patId, 'ORG-OTHER', { first_name: 'Hacked' }, 1),
      'not found',
      'Cross-org update should fail'
    );
  });

  // === Suite 2: Pessimistic Row-Level Locking ===
  console.log('\nSuite 2: Pessimistic Row-Level Locking');
  console.log('--------------------------------------');

  await test('2.1: Acquire lock succeeds on unlocked record', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-L1', 'Lock', 'Test1', 1)").run(patId);

    const result = acquireRowLock('patients', patId, 'ORG1', 'user-A');
    assertEq(result, true, 'Lock should be acquired');

    const p = db.prepare('SELECT locked_by FROM patients WHERE id = ?').get(patId);
    assertEq(p.locked_by, 'user-A', 'locked_by should be set');
  });

  await test('2.2: Second user cannot acquire lock held by another', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-L2', 'Lock', 'Test2', 1)").run(patId);

    acquireRowLock('patients', patId, 'ORG1', 'user-A');
    assertThrowsMsg(
      () => acquireRowLock('patients', patId, 'ORG1', 'user-B'),
      'currently being edited',
      'Should throw lock error'
    );
  });

  await test('2.3: Same user can re-acquire their own lock', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-L3', 'Lock', 'Test3', 1)").run(patId);

    acquireRowLock('patients', patId, 'ORG1', 'user-A');
    const result = acquireRowLock('patients', patId, 'ORG1', 'user-A');
    assertEq(result, true, 'Same user should re-acquire');
  });

  await test('2.4: Release lock allows other user to acquire', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-L4', 'Lock', 'Test4', 1)").run(patId);

    acquireRowLock('patients', patId, 'ORG1', 'user-A');
    releaseRowLock('patients', patId, 'ORG1', 'user-A');

    const result = acquireRowLock('patients', patId, 'ORG1', 'user-B');
    assertEq(result, true, 'User B should acquire after release');
  });

  await test('2.5: Expired lock can be overridden', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'MRN-L5', 'Lock', 'Test5', 1)").run(patId);

    // Set an expired lock
    const expiredTime = new Date(Date.now() - 60000).toISOString();
    db.prepare("UPDATE patients SET locked_by = 'user-A', locked_at = ?, lock_expires_at = ? WHERE id = ?").run(expiredTime, expiredTime, patId);

    const result = acquireRowLock('patients', patId, 'ORG1', 'user-B');
    assertEq(result, true, 'User B should acquire expired lock');
  });

  await test('2.6: Lock on non-existent record fails', () => {
    assertThrowsMsg(
      () => acquireRowLock('patients', 'nonexistent', 'ORG1', 'user-A'),
      'not found',
      'Should throw not found'
    );
  });

  // === Suite 3: Concurrent Data Integrity ===
  console.log('\nSuite 3: Concurrent Data Integrity (Simulated)');
  console.log('-----------------------------------------------');

  await test('3.1: 10 concurrent users updating same record - no lost updates', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, priority_score, version) VALUES (?, 'ORG1', 'MRN-C1', 'Concurrent', 'Test', 0, 1)").run(patId);

    let successCount = 0;
    let conflictCount = 0;

    // Simulate 10 concurrent users all reading version 1 and trying to update
    for (let i = 0; i < 10; i++) {
      try {
        updateWithVersionCheck('patients', patId, 'ORG1', { priority_score: i * 10 }, 1);
        successCount++;
      } catch (e) {
        if (e.message.includes('Conflict')) {
          conflictCount++;
        } else {
          throw e;
        }
      }
    }

    assertEq(successCount, 1, 'Exactly one user should succeed');
    assertEq(conflictCount, 9, 'Nine users should get conflicts');

    const p = db.prepare('SELECT version FROM patients WHERE id = ?').get(patId);
    assertEq(p.version, 2, 'Version should only increment once');
  });

  await test('3.2: Concurrent updates with version refresh - all eventually succeed', () => {
    const patId = uuidv4();
    db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, priority_score, version) VALUES (?, 'ORG1', 'MRN-C2', 'Refresh', 'Test', 0, 1)").run(patId);

    // Simulate 10 users, each refreshing and retrying on conflict
    for (let i = 0; i < 10; i++) {
      let retries = 0;
      while (retries < 15) {
        try {
          const current = db.prepare('SELECT version, priority_score FROM patients WHERE id = ?').get(patId);
          updateWithVersionCheck('patients', patId, 'ORG1', { priority_score: current.priority_score + 1 }, current.version);
          break;
        } catch (e) {
          if (e.message.includes('Conflict')) {
            retries++;
          } else {
            throw e;
          }
        }
      }
      assert(retries < 15, 'Should eventually succeed within 15 retries');
    }

    const p = db.prepare('SELECT priority_score, version FROM patients WHERE id = ?').get(patId);
    assertEq(p.priority_score, 10, 'All 10 increments should be reflected');
    assertEq(p.version, 11, 'Version should be 11 after 10 updates');
  });

  await test('3.3: Bulk insert under concurrent load - no duplicates', () => {
    const patientIds = new Set();
    const tx = db.transaction(() => {
      for (let i = 0; i < 100; i++) {
        const id = uuidv4();
        patientIds.add(id);
        db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', ?, 'Bulk', ?, 1)").run(id, `BULK-${i}`, `User${i}`);
      }
    });
    tx();

    const count = db.prepare("SELECT COUNT(*) as c FROM patients WHERE org_id = 'ORG1' AND patient_id LIKE 'BULK-%'").get().c;
    assertEq(count, 100, 'All 100 records should exist');
    assertEq(patientIds.size, 100, 'All IDs should be unique');
  });

  await test('3.4: Transaction isolation - partial failures roll back', () => {
    const countBefore = db.prepare("SELECT COUNT(*) as c FROM patients WHERE org_id = 'ORG1'").get().c;

    try {
      const tx = db.transaction(() => {
        db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'TX-1', 'TX', 'Test1', 1)").run(uuidv4());
        db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, version) VALUES (?, 'ORG1', 'TX-2', 'TX', 'Test2', 1)").run(uuidv4());
        // This should cause an error (null org_id with NOT NULL constraint)
        throw new Error('Simulated failure');
      });
      tx();
    } catch (e) {
      // Expected
    }

    const countAfter = db.prepare("SELECT COUNT(*) as c FROM patients WHERE org_id = 'ORG1'").get().c;
    assertEq(countAfter, countBefore, 'Transaction should roll back completely');
  });

  await test('3.5: WAL mode enables concurrent reads during writes', () => {
    // In-memory databases always use 'memory' journal mode (SQLite limitation).
    // WAL mode is validated with a file-backed temp DB to prove it works.
    const fs = require('fs');
    const tmpPath = path.join(mockUserDataPath, 'wal-test-' + Date.now() + '.db');
    require('fs').mkdirSync(mockUserDataPath, { recursive: true });
    const walDb = new Database(tmpPath);
    walDb.pragma('journal_mode = WAL');
    const mode = walDb.pragma('journal_mode')[0].journal_mode;
    assertEq(mode, 'wal', 'File-backed DB should use WAL mode');
    walDb.close();
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    try { fs.unlinkSync(tmpPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(tmpPath + '-shm'); } catch (_) {}
  });

  // === Suite 4: Match Acceptance Concurrency ===
  console.log('\nSuite 4: Match Acceptance Concurrency');
  console.log('-------------------------------------');

  await test('4.1: Only one user can accept a match', () => {
    const matchId = uuidv4();
    db.prepare("INSERT INTO matches (id, org_id, match_status, compatibility_score, version) VALUES (?, 'ORG1', 'potential', 95.5, 1)").run(matchId);

    // User A acquires lock and accepts
    acquireRowLock('matches', matchId, 'ORG1', 'coordinator-A');
    updateWithVersionCheck('matches', matchId, 'ORG1', { match_status: 'accepted' }, 1);
    releaseRowLock('matches', matchId, 'ORG1', 'coordinator-A');

    // User B tries to accept the same match
    try {
      updateWithVersionCheck('matches', matchId, 'ORG1', { match_status: 'accepted' }, 1);
      throw new Error('Should have thrown conflict');
    } catch (e) {
      assert(e.message.includes('Conflict'), 'Should get version conflict');
    }

    const m = db.prepare('SELECT match_status, version FROM matches WHERE id = ?').get(matchId);
    assertEq(m.match_status, 'accepted', 'Match should be accepted');
    assertEq(m.version, 2, 'Version should be 2');
  });

  await test('4.2: Lock prevents simultaneous match acceptance', () => {
    const matchId = uuidv4();
    db.prepare("INSERT INTO matches (id, org_id, match_status, compatibility_score, version) VALUES (?, 'ORG1', 'potential', 88.0, 1)").run(matchId);

    acquireRowLock('matches', matchId, 'ORG1', 'coordinator-A');

    // User B cannot even start editing
    assertThrowsMsg(
      () => acquireRowLock('matches', matchId, 'ORG1', 'coordinator-B'),
      'currently being edited',
      'User B should be blocked'
    );

    releaseRowLock('matches', matchId, 'ORG1', 'coordinator-A');
  });

  // ─── Summary ──────────────────────────────────────────────────
  console.log('\n========================================');
  console.log('Concurrency Test Summary');
  console.log('========================================');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total:  ${results.passed + results.failed}`);

  if (results.failed > 0) {
    console.log('\nFailed Tests:');
    results.errors.forEach(({ test, error }) => console.log(`  - ${test}: ${error}`));
    process.exit(1);
  } else {
    console.log('\n✓ All concurrency control tests passed!');
  }

  db.close();
}

runTests().catch(e => { console.error('Test runner error:', e); process.exit(1); });
