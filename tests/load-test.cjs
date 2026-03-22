/**
 * TransTrack - Performance Load Testing
 *
 * Validates system behavior at production scale:
 *   - 5000 patients
 *   - 50,000 audit logs
 *   - Concurrent-style query batches
 *
 * All queries must complete in < 1 second.
 *
 * Usage: node tests/load-test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const LOAD_TEST_CONFIG = {
  patientCount: 5000,
  auditLogCount: 50000,
  donorOrganCount: 500,
  matchCount: 2000,
  maxQueryTimeMs: 1000,
};

const TEST_ORG_ID = 'ORG-LOADTEST';

let db;
let passed = 0;
let failed = 0;
let totalTests = 0;

function uuid() {
  return crypto.randomUUID();
}

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

function timeQuery(label, queryFn) {
  const start = performance.now();
  const result = queryFn();
  const elapsed = performance.now() - start;
  return { result, elapsed, label };
}

function setupDatabase() {
  const dbPath = path.join(__dirname, 'load-test-temp.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');

  db.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, type TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE patients (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, first_name TEXT, last_name TEXT,
      blood_type TEXT, organ_needed TEXT, medical_urgency TEXT, waitlist_status TEXT,
      priority_score REAL, hla_typing TEXT, meld_score INTEGER, date_added_to_waitlist TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, org_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT,
      patient_name TEXT, details TEXT, user_email TEXT, user_role TEXT, request_id TEXT,
      created_at TEXT
    );
    CREATE TABLE donor_organs (
      id TEXT PRIMARY KEY, org_id TEXT, donor_id TEXT, organ_type TEXT, blood_type TEXT,
      hla_typing TEXT, organ_status TEXT, status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE matches (
      id TEXT PRIMARY KEY, org_id TEXT, donor_organ_id TEXT, patient_id TEXT, patient_name TEXT,
      compatibility_score REAL, match_status TEXT, priority_rank INTEGER, created_at TEXT, updated_at TEXT
    );

    CREATE INDEX idx_patients_org ON patients(org_id);
    CREATE INDEX idx_patients_status ON patients(org_id, waitlist_status);
    CREATE INDEX idx_patients_priority ON patients(org_id, priority_score DESC);
    CREATE INDEX idx_patients_blood ON patients(org_id, blood_type);
    CREATE INDEX idx_audit_org ON audit_logs(org_id);
    CREATE INDEX idx_audit_date ON audit_logs(org_id, created_at DESC);
    CREATE INDEX idx_audit_entity ON audit_logs(org_id, entity_type, entity_id);
    CREATE INDEX idx_audit_request ON audit_logs(request_id);
    CREATE INDEX idx_matches_org ON matches(org_id);
    CREATE INDEX idx_matches_patient ON matches(patient_id);
    CREATE INDEX idx_donor_org ON donor_organs(org_id);
  `);

  db.prepare("INSERT INTO organizations VALUES (?, 'Load Test Org', 'TRANSPLANT_CENTER', 'ACTIVE', datetime('now'), datetime('now'))").run(TEST_ORG_ID);
}

function seedPatients() {
  const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const organs = ['kidney', 'liver', 'heart', 'lung', 'pancreas'];
  const urgencies = ['low', 'medium', 'high', 'critical'];
  const statuses = ['active', 'inactive', 'transplanted', 'removed'];

  const insert = db.prepare(`
    INSERT INTO patients (id, org_id, patient_id, first_name, last_name, blood_type, organ_needed,
      medical_urgency, waitlist_status, priority_score, hla_typing, meld_score,
      date_added_to_waitlist, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < LOAD_TEST_CONFIG.patientCount; i++) {
      insert.run(
        uuid(), TEST_ORG_ID, `PAT-${String(i).padStart(5, '0')}`,
        `First${i}`, `Last${i}`,
        bloodTypes[i % bloodTypes.length], organs[i % organs.length],
        urgencies[i % urgencies.length], i < 4000 ? 'active' : statuses[i % statuses.length],
        Math.random() * 100,
        `A*02:01,A*03:01,B*07:02,B*44:02,DR*04:01,DR*15:01`,
        Math.floor(Math.random() * 40),
        new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
      );
    }
  });
  tx();
}

function seedAuditLogs() {
  const actions = ['create', 'update', 'delete', 'view', 'export', 'login', 'priority_recalculated'];
  const entityTypes = ['Patient', 'DonorOrgan', 'Match', 'System', 'User'];

  const insert = db.prepare(`
    INSERT INTO audit_logs (id, org_id, action, entity_type, entity_id, patient_name, details,
      user_email, user_role, request_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batchSize = 5000;
  for (let batch = 0; batch < LOAD_TEST_CONFIG.auditLogCount / batchSize; batch++) {
    const tx = db.transaction(() => {
      for (let i = 0; i < batchSize; i++) {
        const idx = batch * batchSize + i;
        insert.run(
          uuid(), TEST_ORG_ID,
          actions[idx % actions.length], entityTypes[idx % entityTypes.length],
          uuid(), `Patient ${idx}`, `Load test audit entry ${idx}`,
          'admin@test.local', 'admin', uuid(),
          new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString()
        );
      }
    });
    tx();
  }
}

function seedDonorOrgansAndMatches() {
  const organs = ['kidney', 'liver', 'heart', 'lung', 'pancreas'];
  const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const donorIds = [];

  const insertDonor = db.prepare(`
    INSERT INTO donor_organs (id, org_id, donor_id, organ_type, blood_type, hla_typing, organ_status, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'available', 'available', datetime('now'), datetime('now'))
  `);

  const tx1 = db.transaction(() => {
    for (let i = 0; i < LOAD_TEST_CONFIG.donorOrganCount; i++) {
      const id = uuid();
      donorIds.push(id);
      insertDonor.run(id, TEST_ORG_ID, `DON-${i}`, organs[i % organs.length], bloodTypes[i % bloodTypes.length], 'A*02:01,B*07:02,DR*04:01');
    }
  });
  tx1();

  const patientRows = db.prepare("SELECT id, first_name, last_name FROM patients WHERE org_id = ? LIMIT ?").all(TEST_ORG_ID, LOAD_TEST_CONFIG.matchCount);

  const insertMatch = db.prepare(`
    INSERT INTO matches (id, org_id, donor_organ_id, patient_id, patient_name, compatibility_score, match_status, priority_rank, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'potential', ?, datetime('now'), datetime('now'))
  `);

  const tx2 = db.transaction(() => {
    for (let i = 0; i < Math.min(LOAD_TEST_CONFIG.matchCount, patientRows.length); i++) {
      const p = patientRows[i];
      insertMatch.run(uuid(), TEST_ORG_ID, donorIds[i % donorIds.length], p.id, `${p.first_name} ${p.last_name}`, Math.random() * 100, i + 1);
    }
  });
  tx2();
}

function cleanup() {
  if (db) db.close();
  const dbPath = path.join(__dirname, 'load-test-temp.db');
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ok */ }
}

// ============================================================================
// TESTS
// ============================================================================

console.log('TransTrack Load Testing');
console.log('=======================');
console.log(`Config: ${LOAD_TEST_CONFIG.patientCount} patients, ${LOAD_TEST_CONFIG.auditLogCount} audit logs`);
console.log('');

console.log('Setting up test database...');
setupDatabase();

console.log('Seeding patients...');
seedPatients();

console.log('Seeding audit logs...');
seedAuditLogs();

console.log('Seeding donor organs & matches...');
seedDonorOrgansAndMatches();

const counts = {
  patients: db.prepare('SELECT COUNT(*) as c FROM patients').get().c,
  auditLogs: db.prepare('SELECT COUNT(*) as c FROM audit_logs').get().c,
  donors: db.prepare('SELECT COUNT(*) as c FROM donor_organs').get().c,
  matches: db.prepare('SELECT COUNT(*) as c FROM matches').get().c,
};
console.log(`Seeded: ${counts.patients} patients, ${counts.auditLogs} audit logs, ${counts.donors} donors, ${counts.matches} matches`);
console.log('');

// Suite 1: Patient Queries
console.log('Suite 1: Patient Query Performance');

test('List all active patients (org-scoped)', () => {
  const { elapsed } = timeQuery('active patients', () =>
    db.prepare("SELECT * FROM patients WHERE org_id = ? AND waitlist_status = 'active' ORDER BY priority_score DESC").all(TEST_ORG_ID)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms (max ${LOAD_TEST_CONFIG.maxQueryTimeMs}ms)`);
});

test('Paginated patient list (LIMIT 50 OFFSET 2000)', () => {
  const { elapsed } = timeQuery('paginated', () =>
    db.prepare("SELECT * FROM patients WHERE org_id = ? ORDER BY priority_score DESC LIMIT 50 OFFSET 2000").all(TEST_ORG_ID)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

test('Filter patients by blood type + organ', () => {
  const { elapsed } = timeQuery('filter', () =>
    db.prepare("SELECT * FROM patients WHERE org_id = ? AND blood_type = 'O-' AND organ_needed = 'kidney' AND waitlist_status = 'active'").all(TEST_ORG_ID)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

test('Count patients by waitlist status', () => {
  const { elapsed } = timeQuery('count', () =>
    db.prepare("SELECT waitlist_status, COUNT(*) as count FROM patients WHERE org_id = ? GROUP BY waitlist_status").all(TEST_ORG_ID)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

test('Top 100 priority patients', () => {
  const { elapsed } = timeQuery('top100', () =>
    db.prepare("SELECT * FROM patients WHERE org_id = ? AND waitlist_status = 'active' ORDER BY priority_score DESC LIMIT 100").all(TEST_ORG_ID)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

// Suite 2: Audit Log Queries
console.log('\nSuite 2: Audit Log Query Performance');

test('Recent 100 audit logs', () => {
  const { elapsed } = timeQuery('recent100', () =>
    db.prepare("SELECT * FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 100").all(TEST_ORG_ID)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

test('Audit logs filtered by action type', () => {
  const { elapsed } = timeQuery('byAction', () =>
    db.prepare("SELECT * FROM audit_logs WHERE org_id = ? AND action = 'create' ORDER BY created_at DESC LIMIT 500").all(TEST_ORG_ID)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

test('Audit logs count by action (aggregation)', () => {
  const { elapsed } = timeQuery('countByAction', () =>
    db.prepare("SELECT action, COUNT(*) as count FROM audit_logs WHERE org_id = ? GROUP BY action ORDER BY count DESC").all(TEST_ORG_ID)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

test('Audit logs by date range (last 30 days)', () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { elapsed } = timeQuery('dateRange', () =>
    db.prepare("SELECT * FROM audit_logs WHERE org_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1000").all(TEST_ORG_ID, thirtyDaysAgo)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

test('Audit log trace by request_id', () => {
  const sampleLog = db.prepare("SELECT request_id FROM audit_logs WHERE org_id = ? AND request_id IS NOT NULL LIMIT 1").get(TEST_ORG_ID);
  if (sampleLog) {
    const { elapsed } = timeQuery('byRequestId', () =>
      db.prepare("SELECT * FROM audit_logs WHERE request_id = ?").all(sampleLog.request_id)
    );
    assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
  }
});

// Suite 3: Match Queries
console.log('\nSuite 3: Match Query Performance');

test('All matches for a patient', () => {
  const patient = db.prepare("SELECT id FROM patients WHERE org_id = ? LIMIT 1").get(TEST_ORG_ID);
  const { elapsed } = timeQuery('patientMatches', () =>
    db.prepare("SELECT * FROM matches WHERE org_id = ? AND patient_id = ? ORDER BY compatibility_score DESC").all(TEST_ORG_ID, patient.id)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

test('Top matches for a donor organ', () => {
  const donor = db.prepare("SELECT id FROM donor_organs WHERE org_id = ? LIMIT 1").get(TEST_ORG_ID);
  const { elapsed } = timeQuery('donorMatches', () =>
    db.prepare("SELECT m.*, p.blood_type, p.organ_needed FROM matches m JOIN patients p ON m.patient_id = p.id WHERE m.org_id = ? AND m.donor_organ_id = ? ORDER BY m.compatibility_score DESC").all(TEST_ORG_ID, donor.id)
  );
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Query took ${elapsed.toFixed(1)}ms`);
});

// Suite 4: Write Performance
console.log('\nSuite 4: Write Performance');

test('Insert 100 patients in transaction', () => {
  const insert = db.prepare("INSERT INTO patients (id, org_id, patient_id, first_name, last_name, blood_type, organ_needed, medical_urgency, waitlist_status, priority_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'O+', 'kidney', 'high', 'active', ?, datetime('now'), datetime('now'))");
  const start = performance.now();
  const tx = db.transaction(() => {
    for (let i = 0; i < 100; i++) {
      insert.run(uuid(), TEST_ORG_ID, `BATCH-${i}`, `Batch${i}`, `User${i}`, Math.random() * 100);
    }
  });
  tx();
  const elapsed = performance.now() - start;
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Insert took ${elapsed.toFixed(1)}ms`);
});

test('Insert 1000 audit log entries in transaction', () => {
  const insert = db.prepare("INSERT INTO audit_logs (id, org_id, action, entity_type, details, user_email, user_role, created_at) VALUES (?, ?, 'test', 'System', 'load test', 'test@test.com', 'admin', datetime('now'))");
  const start = performance.now();
  const tx = db.transaction(() => {
    for (let i = 0; i < 1000; i++) {
      insert.run(uuid(), TEST_ORG_ID);
    }
  });
  tx();
  const elapsed = performance.now() - start;
  assert(elapsed < LOAD_TEST_CONFIG.maxQueryTimeMs, `Insert took ${elapsed.toFixed(1)}ms`);
});

// Summary
console.log('\n=======================');
console.log(`Load Test Results: ${passed}/${totalTests} passed, ${failed} failed`);

cleanup();

if (failed > 0) {
  console.log('\nFAILED - Performance does not meet production requirements');
  process.exit(1);
} else {
  console.log('\nPASSED - All queries complete within performance targets');
  process.exit(0);
}
