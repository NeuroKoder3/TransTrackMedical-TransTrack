/**
 * TransTrack - Business Logic Tests
 *
 * Tests priority scoring, donor matching, notification rules,
 * FHIR import/validation, and the shared IPC utilities.
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

// ─── Mock Electron ──────────────────────────────────────────────

const mockUserDataPath = path.join(__dirname, '.test-data-biz-' + Date.now());
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    app: {
      getPath: () => mockUserDataPath,
      isPackaged: false,
    },
    ipcMain: { handle: () => {} },
    dialog: {},
  },
};

const { v4: uuidv4 } = require('uuid');

// ─── Test helpers ──────────────────────────────────────────────

const results = { passed: 0, failed: 0, errors: [] };

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    results.passed++;
  } catch (e) {
    console.log(`  \u2717 ${name}`);
    console.log(`    ${e.message}`);
    results.failed++;
    results.errors.push({ test: name, error: e.message });
  }
}

function assert(condition, msg) { if (!condition) throw new Error(msg); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`); }
function assertInRange(val, min, max, msg) {
  if (val < min || val > max) throw new Error(`${msg}: ${val} not in [${min}, ${max}]`);
}

// ─── In-memory DB ──────────────────────────────────────────────

const Database = require('better-sqlite3-multiple-ciphers');
let db;

function setupDB() {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE patients (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT, first_name TEXT, last_name TEXT,
      blood_type TEXT, organ_needed TEXT, medical_urgency TEXT, waitlist_status TEXT DEFAULT 'active',
      priority_score REAL, priority_score_breakdown TEXT,
      date_of_birth TEXT, date_added_to_waitlist TEXT, last_evaluation_date TEXT,
      functional_status TEXT, prognosis_rating TEXT, meld_score REAL, las_score REAL,
      pra_percentage REAL, cpra_percentage REAL, comorbidity_score REAL,
      previous_transplants INTEGER DEFAULT 0, compliance_score REAL,
      hla_typing TEXT, weight_kg REAL, height_cm REAL,
      created_by TEXT, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE priority_weights (
      id TEXT PRIMARY KEY, org_id TEXT, name TEXT, is_active INTEGER DEFAULT 1,
      medical_urgency_weight REAL DEFAULT 30, time_on_waitlist_weight REAL DEFAULT 25,
      organ_specific_score_weight REAL DEFAULT 25, evaluation_recency_weight REAL DEFAULT 10,
      blood_type_rarity_weight REAL DEFAULT 10, evaluation_decay_rate REAL DEFAULT 0.5,
      description TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE donor_organs (
      id TEXT PRIMARY KEY, org_id TEXT, donor_id TEXT, organ_type TEXT, blood_type TEXT,
      organ_status TEXT, hla_typing TEXT, donor_age INTEGER, donor_weight_kg REAL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
    );
    CREATE TABLE matches (
      id TEXT PRIMARY KEY, org_id TEXT, donor_organ_id TEXT, patient_id TEXT, patient_name TEXT,
      compatibility_score REAL, blood_type_compatible INTEGER, abo_compatible INTEGER,
      hla_match_score REAL, hla_a_match INTEGER, hla_b_match INTEGER,
      hla_dr_match INTEGER, hla_dq_match INTEGER,
      size_compatible INTEGER, match_status TEXT, priority_rank INTEGER,
      virtual_crossmatch_result TEXT, physical_crossmatch_result TEXT,
      predicted_graft_survival REAL, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, org_id TEXT, recipient_email TEXT, title TEXT, message TEXT,
      notification_type TEXT, is_read INTEGER DEFAULT 0, priority_level TEXT,
      related_patient_id TEXT, related_patient_name TEXT, action_url TEXT, metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE notification_rules (
      id TEXT PRIMARY KEY, org_id TEXT, rule_name TEXT, trigger_event TEXT,
      conditions TEXT, priority_level TEXT, is_active INTEGER DEFAULT 1,
      notification_template TEXT, description TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, org_id TEXT, email TEXT, password_hash TEXT,
      full_name TEXT, role TEXT DEFAULT 'user', is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ehr_imports (
      id TEXT PRIMARY KEY, org_id TEXT, integration_id TEXT, import_type TEXT,
      status TEXT, records_imported INTEGER, records_failed INTEGER,
      error_details TEXT, created_by TEXT, completed_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ehr_validation_rules (
      id TEXT PRIMARY KEY, org_id TEXT, field_name TEXT, rule_type TEXT,
      is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, org_id TEXT, action TEXT, entity_type TEXT,
      entity_id TEXT, patient_name TEXT, details TEXT,
      user_email TEXT, user_role TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ─── Seed helpers ──────────────────────────────────────────────

function seedPatient(overrides = {}) {
  const id = uuidv4();
  const defaults = {
    id, org_id: 'ORG1', patient_id: `MRN-${id.slice(0,6)}`,
    first_name: 'Test', last_name: 'Patient',
    blood_type: 'O+', organ_needed: 'kidney',
    medical_urgency: 'high', waitlist_status: 'active',
    date_added_to_waitlist: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString(),
    last_evaluation_date: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    functional_status: 'partially_dependent',
    prognosis_rating: 'fair',
    pra_percentage: 20, cpra_percentage: 25,
    comorbidity_score: 3, compliance_score: 7,
    previous_transplants: 0, weight_kg: 70,
    hla_typing: 'A2 A24 B7 B44 DR4 DR11 DQ3',
  };
  const p = { ...defaults, ...overrides };
  const cols = Object.keys(p);
  const vals = Object.values(p);
  db.prepare(`INSERT INTO patients (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  return p;
}

function seedDonor(overrides = {}) {
  const id = uuidv4();
  const defaults = {
    id, org_id: 'ORG1', donor_id: `DON-${id.slice(0,6)}`,
    organ_type: 'kidney', blood_type: 'O+', organ_status: 'available',
    hla_typing: 'A2 A11 B7 B35 DR4 DR15 DQ3',
    donor_age: 40, donor_weight_kg: 75,
  };
  const d = { ...defaults, ...overrides };
  const cols = Object.keys(d);
  db.prepare(`INSERT INTO donor_organs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(d));
  return d;
}

function seedAdmin() {
  db.prepare(`INSERT INTO users (id, org_id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?, ?)`).run(
    uuidv4(), 'ORG1', 'admin@test.com', 'hash', 'Admin', 'admin'
  );
}

// ─── Load functions module ─────────────────────────────────────

const functions = require('../electron/functions/index.cjs');
const mockContext = () => ({
  db,
  currentUser: { id: 'u1', email: 'admin@test.com', role: 'admin', org_id: 'ORG1' },
  logAudit: () => {},
});

// =================================================================
// TEST SUITES
// =================================================================

async function runTests() {
  console.log('\n========================================');
  console.log('Business Logic Tests');
  console.log('========================================\n');

  setupDB();

  // ─── 1. Priority Scoring ──────────────────────────────────
  console.log('Suite 1: Priority Scoring');
  console.log('------------------------');

  const p1 = seedPatient({ medical_urgency: 'critical', functional_status: 'fully_dependent', prognosis_rating: 'poor' });
  const p2 = seedPatient({ medical_urgency: 'low', functional_status: 'independent', prognosis_rating: 'excellent' });

  const r1 = await functions.calculatePriorityAdvanced({ patient_id: p1.id }, mockContext());
  test('1.1: High-acuity patient gets high priority', () => {
    assert(r1.success, 'Should succeed');
    assertInRange(r1.priority_score, 40, 100, 'Critical patient score');
  });

  const r2 = await functions.calculatePriorityAdvanced({ patient_id: p2.id }, mockContext());
  test('1.2: Low-acuity patient gets lower priority', () => {
    assert(r2.success, 'Should succeed');
    assert(r1.priority_score > r2.priority_score, `Critical (${r1.priority_score}) should exceed low (${r2.priority_score})`);
  });

  test('1.3: Score breakdown includes all components', () => {
    const b = r1.breakdown;
    assert(b.components.medical_urgency, 'Should have medical_urgency');
    assert(b.components.time_on_waitlist !== undefined, 'Should have time_on_waitlist');
    assert(b.components.organ_specific, 'Should have organ_specific');
    assert(b.components.evaluation_recency, 'Should have evaluation_recency');
    assert(b.components.blood_type_rarity, 'Should have blood_type_rarity');
  });

  test('1.4: Score is clamped to [0, 100]', () => {
    assertInRange(r1.priority_score, 0, 100, 'Score range');
    assertInRange(r2.priority_score, 0, 100, 'Score range');
  });

  const pLiver = seedPatient({ organ_needed: 'liver', meld_score: 30 });
  const rLiver = await functions.calculatePriorityAdvanced({ patient_id: pLiver.id }, mockContext());
  test('1.5: Liver patient uses MELD scoring', () => {
    assertEqual(rLiver.breakdown.components.organ_specific.type, 'MELD', 'Should use MELD');
    assertEqual(rLiver.breakdown.components.organ_specific.score, 30, 'MELD score should be 30');
  });

  const pLung = seedPatient({ organ_needed: 'lung', las_score: 75 });
  const rLung = await functions.calculatePriorityAdvanced({ patient_id: pLung.id }, mockContext());
  test('1.6: Lung patient uses LAS scoring', () => {
    assertEqual(rLung.breakdown.components.organ_specific.type, 'LAS', 'Should use LAS');
  });

  test('1.7: Non-existent patient throws', async () => {
    let threw = false;
    try { await functions.calculatePriorityAdvanced({ patient_id: 'nonexistent' }, mockContext()); }
    catch { threw = true; }
    assert(threw, 'Should throw for missing patient');
  });

  // ─── 2. Donor Matching ────────────────────────────────────
  console.log('\nSuite 2: Donor Matching');
  console.log('-----------------------');

  seedAdmin();
  const donorA = seedDonor({ blood_type: 'O-', organ_type: 'kidney' });
  const pCompat1 = seedPatient({ blood_type: 'O+', organ_needed: 'kidney', hla_typing: 'A2 A11 B7 B35 DR4 DR15 DQ3', priority_score: 80 });
  const pCompat2 = seedPatient({ blood_type: 'A+', organ_needed: 'kidney', hla_typing: 'A1 A3 B8 B51 DR17 DR7', priority_score: 60 });
  seedPatient({ blood_type: 'B+', organ_needed: 'liver' }); // wrong organ

  const matchResult = await functions.matchDonorAdvanced(
    { donor_organ_id: donorA.id, simulation_mode: true },
    mockContext()
  );

  test('2.1: Matching returns results for correct organ type', () => {
    assert(matchResult.success, 'Should succeed');
    assert(matchResult.matches.length > 0, 'Should find matches');
    matchResult.matches.forEach(m => assertEqual(m.organ_needed, 'kidney', 'All matches should be kidney'));
  });

  test('2.2: Matches are sorted by compatibility descending', () => {
    for (let i = 1; i < matchResult.matches.length; i++) {
      assert(
        matchResult.matches[i - 1].compatibility_score >= matchResult.matches[i].compatibility_score,
        'Should be sorted descending'
      );
    }
  });

  test('2.3: Blood type compatibility is enforced', () => {
    matchResult.matches.forEach(m => assert(m.blood_type_compatible, 'All matches should be blood type compatible'));
  });

  test('2.4: Simulation mode does not create DB records', () => {
    assert(matchResult.simulation_mode, 'Should be simulation');
    const dbMatches = db.prepare('SELECT COUNT(*) as cnt FROM matches').get();
    assertEqual(dbMatches.cnt, 0, 'No matches in DB during simulation');
  });

  test('2.5: Non-existent donor throws', async () => {
    let threw = false;
    try { await functions.matchDonorAdvanced({ donor_organ_id: 'ghost' }, mockContext()); }
    catch { threw = true; }
    assert(threw, 'Should throw for missing donor');
  });

  // Hypothetical donor simulation
  const hypoResult = await functions.matchDonorAdvanced({
    simulation_mode: true,
    hypothetical_donor: { organ_type: 'kidney', blood_type: 'AB+', hla_typing: 'A1 A2 B7 B8 DR4 DR17' },
  }, mockContext());

  test('2.6: Hypothetical donor matching works', () => {
    assert(hypoResult.success, 'Should succeed');
    assert(hypoResult.simulation_mode, 'Should be simulation');
  });

  // ─── 3. FHIR Validation ───────────────────────────────────
  console.log('\nSuite 3: FHIR Validation');
  console.log('------------------------');

  const validBundle = {
    resourceType: 'Bundle',
    entry: [{
      resource: {
        resourceType: 'Patient',
        name: [{ given: ['John'], family: 'Doe' }],
        birthDate: '1985-03-15',
      },
    }],
  };

  const valResult = await functions.validateFHIRData({ fhir_data: validBundle }, mockContext());
  test('3.1: Valid FHIR bundle passes validation', () => {
    assert(valResult.valid, 'Should be valid');
    assertEqual(valResult.errors.length, 0, 'No errors');
  });

  const invalidBundle = { resourceType: 'Observation' };
  const invResult = await functions.validateFHIRData({ fhir_data: invalidBundle }, mockContext());
  test('3.2: Non-Bundle resource type fails validation', () => {
    assert(!invResult.valid, 'Should be invalid');
    assert(invResult.errors.length > 0, 'Should have errors');
  });

  const noNameBundle = {
    resourceType: 'Bundle',
    entry: [{ resource: { resourceType: 'Patient' } }],
  };
  const noNameResult = await functions.validateFHIRData({ fhir_data: noNameBundle }, mockContext());
  test('3.3: Patient without name produces error', () => {
    assert(!noNameResult.valid || noNameResult.errors.length > 0, 'Should flag missing name');
  });

  const emptyBundle = { resourceType: 'Bundle', entry: [] };
  const emptyResult = await functions.validateFHIRData({ fhir_data: emptyBundle }, mockContext());
  test('3.4: Empty bundle produces warning', () => {
    assert(emptyResult.warnings.length > 0, 'Should have warning for empty bundle');
  });

  // ─── 4. FHIR Import ──────────────────────────────────────
  console.log('\nSuite 4: FHIR Import');
  console.log('--------------------');

  const importResult = await functions.importFHIRData({
    fhir_data: validBundle,
    integration_id: 'int-123',
  }, mockContext());

  test('4.1: Valid FHIR import succeeds', () => {
    assert(importResult.success, 'Should succeed');
    assertEqual(importResult.records_imported, 1, 'Should import 1 record');
    assertEqual(importResult.records_failed, 0, 'No failures');
  });

  test('4.2: Import creates audit trail', () => {
    const importRecord = db.prepare('SELECT * FROM ehr_imports WHERE id = ?').get(importResult.import_id);
    assert(importRecord, 'Import record should exist');
    assertEqual(importRecord.status, 'completed', 'Status should be completed');
  });

  test('4.3: Invalid FHIR data throws', async () => {
    let threw = false;
    try {
      await functions.importFHIRData({ fhir_data: 'not json', integration_id: 'x' }, mockContext());
    } catch { threw = true; }
    assert(threw, 'Should throw on invalid JSON');
  });

  // ─── 5. Notification Rules ────────────────────────────────
  console.log('\nSuite 5: Notification Rules');
  console.log('--------------------------');

  const rulePatient = seedPatient({ medical_urgency: 'critical', priority_score: 90 });

  db.prepare(`INSERT INTO notification_rules (id, org_id, rule_name, trigger_event, conditions, priority_level, is_active, notification_template)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    uuidv4(), 'ORG1', 'High Priority Alert', 'patient_update',
    JSON.stringify({ priority_threshold: 80 }),
    'high', 1,
    JSON.stringify({ title: 'Alert: {patient_name}', message: 'Priority {priority_score}' })
  );

  const notifResult = await functions.checkNotificationRules({
    patient_id: rulePatient.id,
    event_type: 'patient_update',
  }, mockContext());

  test('5.1: Matching rule triggers notification', () => {
    assert(notifResult.success, 'Should succeed');
    assert(notifResult.notifications_created > 0, 'Should create notifications');
  });

  const lowPatient = seedPatient({ medical_urgency: 'low', priority_score: 20 });
  const notifResult2 = await functions.checkNotificationRules({
    patient_id: lowPatient.id,
    event_type: 'patient_update',
  }, mockContext());

  test('5.2: Below-threshold patient does not trigger rule', () => {
    assertEqual(notifResult2.notifications_created, 0, 'Should not trigger');
  });

  // ─── 6. Password Validation ──────────────────────────────
  console.log('\nSuite 6: Password Validation (shared.cjs)');
  console.log('-----------------------------------------');

  // Load the shared module
  const shared = require('../electron/ipc/shared.cjs');

  test('6.1: Strong password passes', () => {
    const r = shared.validatePasswordStrength('MyStr0ng!Pass');
    assert(r.valid, 'Should be valid');
    assertEqual(r.errors.length, 0, 'No errors');
  });

  test('6.2: Short password fails', () => {
    const r = shared.validatePasswordStrength('Ab1!');
    assert(!r.valid, 'Should fail');
    assert(r.errors.some(e => e.includes('12 characters')), 'Should mention length');
  });

  test('6.3: No uppercase fails', () => {
    const r = shared.validatePasswordStrength('mystrongpass1!');
    assert(!r.valid, 'Should fail');
    assert(r.errors.some(e => e.includes('uppercase')), 'Should mention uppercase');
  });

  test('6.4: No special character fails', () => {
    const r = shared.validatePasswordStrength('MyStrongPass12');
    assert(!r.valid, 'Should fail');
    assert(r.errors.some(e => e.includes('special')), 'Should mention special char');
  });

  test('6.5: Null password fails', () => {
    const r = shared.validatePasswordStrength(null);
    assert(!r.valid, 'Should fail');
  });

  // ─── 7. Entity Helpers ────────────────────────────────────
  console.log('\nSuite 7: Entity Helpers');
  console.log('-----------------------');

  test('7.1: parseJsonFields handles JSON strings', () => {
    const row = { id: '1', priority_score_breakdown: '{"total":50}', name: 'test' };
    const parsed = shared.parseJsonFields(row);
    assert(typeof parsed.priority_score_breakdown === 'object', 'Should parse JSON');
    assertEqual(parsed.priority_score_breakdown.total, 50, 'Should preserve value');
  });

  test('7.2: parseJsonFields handles invalid JSON gracefully', () => {
    const row = { id: '1', priority_score_breakdown: 'not-json' };
    const parsed = shared.parseJsonFields(row);
    assertEqual(parsed.priority_score_breakdown, 'not-json', 'Should keep string');
  });

  test('7.3: parseJsonFields handles null', () => {
    assertEqual(shared.parseJsonFields(null), null, 'Should return null');
  });

  test('7.4: isValidOrderColumn rejects unknown columns', () => {
    assert(!shared.isValidOrderColumn('patients', 'DROP TABLE'), 'Should reject injection');
    assert(!shared.isValidOrderColumn('unknown_table', 'id'), 'Should reject unknown table');
  });

  test('7.5: isValidOrderColumn accepts valid columns', () => {
    assert(shared.isValidOrderColumn('patients', 'first_name'), 'Should accept first_name');
    assert(shared.isValidOrderColumn('patients', 'priority_score'), 'Should accept priority_score');
  });

  test('7.6: sanitizeForSQLite converts types correctly', () => {
    const data = { active: true, tags: ['a', 'b'], meta: { k: 'v' }, undef: undefined, name: 'test' };
    shared.sanitizeForSQLite(data);
    assertEqual(data.active, 1, 'Boolean -> 1');
    assertEqual(data.tags, '["a","b"]', 'Array -> JSON');
    assertEqual(data.meta, '{"k":"v"}', 'Object -> JSON');
    assertEqual(data.undef, null, 'undefined -> null');
    assertEqual(data.name, 'test', 'String unchanged');
  });

  // ─── Summary ──────────────────────────────────────────────
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total:  ${results.passed + results.failed}`);

  if (results.failed > 0) {
    console.log('\nFailed Tests:');
    results.errors.forEach(({ test, error }) => console.log(`  - ${test}: ${error}`));
    process.exit(1);
  } else {
    console.log('\n\u2713 All business logic tests passed!');
  }

  db.close();
}

runTests().catch(e => { console.error('Test runner error:', e); process.exit(1); });
