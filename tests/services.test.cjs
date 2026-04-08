/**
 * TransTrack - Enterprise Services Tests
 *
 * Tests the four new enterprise services against an in-memory SQLite database:
 *   1. predictiveService  - Inactivation risk scoring
 *   2. taskEngine         - Task CRUD and escalation
 *   3. outcomesService    - Outcomes metric snapshots
 *   4. srtrService        - SRTR / CMS readiness tracking
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

// mock electron env
const mockUserDataPath = path.join(__dirname, '.test-data-svc-' + Date.now());
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    app: { getPath: () => mockUserDataPath, isPackaged: false },
    ipcMain: { handle: () => {} },
    dialog: {},
    crashReporter: { start: () => {} },
  },
};

// setup test db
const Database = require('better-sqlite3-multiple-ciphers');
let db;

function setupDB() {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE patients (
      id TEXT PRIMARY KEY, org_id TEXT, first_name TEXT, last_name TEXT,
      patient_id TEXT, blood_type TEXT, organ_needed TEXT,
      waitlist_status TEXT DEFAULT 'active',
      last_evaluation_date TEXT, updated_at TEXT, created_at TEXT,
      medical_urgency TEXT, hla_typing TEXT, date_added_to_waitlist TEXT,
      diagnosis TEXT, priority_score REAL, compliance_score REAL,
      comorbidity_score REAL
    );

    CREATE TABLE readiness_barriers (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT,
      barrier_type TEXT, status TEXT, risk_level TEXT,
      owning_role TEXT, identified_date TEXT, target_resolution_date TEXT,
      resolved_date TEXT, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, org_id TEXT, action TEXT, entity_type TEXT,
      entity_id TEXT, details TEXT, user_email TEXT, user_role TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      patient_name TEXT, request_id TEXT
    );

    CREATE TABLE inactivation_predictions (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT,
      risk_score REAL, risk_level TEXT,
      predicted_inactivation_within_days INTEGER,
      contributing_factors TEXT, eval_expiry_factor REAL,
      documentation_factor REAL, barrier_factor REAL,
      status_churn_factor REAL, contact_recency_factor REAL,
      recommendation TEXT, is_current INTEGER,
      prediction_date TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, org_id TEXT, patient_id TEXT,
      title TEXT, description TEXT, task_type TEXT, source TEXT,
      status TEXT, priority TEXT, assigned_to TEXT, assigned_role TEXT,
      due_date TEXT, trigger_entity_type TEXT, trigger_entity_id TEXT,
      escalation_level INTEGER DEFAULT 0, escalated_at TEXT,
      escalated_to TEXT, completed_date TEXT, completed_by TEXT,
      resolution_notes TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT, updated_by TEXT
    );

    CREATE TABLE task_escalation_rules (
      id TEXT PRIMARY KEY, org_id TEXT, task_type TEXT,
      escalation_level INTEGER, hours_before_escalation INTEGER,
      escalate_to_role TEXT, notification_message TEXT,
      is_active INTEGER DEFAULT 1, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
    );

    CREATE TABLE outcomes_snapshots (
      id TEXT PRIMARY KEY, org_id TEXT, period_start TEXT,
      period_end TEXT, created_by TEXT,
      snapshot_date TEXT DEFAULT (datetime('now')),
      total_active_patients INTEGER, total_inactivations INTEGER,
      risk_alerts_with_resolution INTEGER,
      evaluations_renewed_on_time INTEGER, evaluations_lapsed INTEGER,
      avg_barrier_resolution_days REAL, barriers_resolved INTEGER,
      barriers_opened INTEGER, avg_time_to_intervention_hours REAL,
      risk_alerts_generated INTEGER, risk_alerts_acted_on INTEGER,
      coordinator_load_std_dev REAL, patients_at_risk INTEGER,
      patients_at_risk_percentage REAL, tasks_auto_generated INTEGER,
      tasks_completed_on_time INTEGER, tasks_escalated INTEGER
    );

    CREATE TABLE srtr_metrics (
      id TEXT PRIMARY KEY, org_id TEXT, period_label TEXT,
      metric_date TEXT DEFAULT (datetime('now')),
      total_waitlisted INTEGER, active_waitlisted INTEGER,
      inactive_waitlisted INTEGER, inactive_percentage REAL,
      new_listings INTEGER, removals_transplanted INTEGER,
      removals_deceased INTEGER, removals_other INTEGER,
      median_wait_days INTEGER, transplant_rate REAL,
      offer_acceptance_rate REAL, one_year_graft_survival_est REAL,
      one_year_patient_survival_est REAL,
      evaluation_completion_rate REAL,
      documentation_completeness_rate REAL,
      cms_survey_risk_level TEXT, cms_risk_factors TEXT,
      created_by TEXT
    );

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, org_id TEXT, notification_type TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      title TEXT, message TEXT, recipient_email TEXT,
      related_patient_id TEXT, related_patient_name TEXT,
      priority_level TEXT, action_url TEXT, metadata TEXT
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY, org_id TEXT, email TEXT, full_name TEXT,
      role TEXT, is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
    );
  `);
}

// mock db/init and logger before requiring services

const initModulePath = require.resolve('../electron/database/init.cjs');
require.cache[initModulePath] = {
  id: initModulePath,
  filename: initModulePath,
  loaded: true,
  exports: {
    getDatabase: () => db,
    isEncryptionEnabled: () => false,
  },
};

const loggerModulePath = require.resolve('../electron/services/logger.cjs');
const noop = () => {};
require.cache[loggerModulePath] = {
  id: loggerModulePath,
  filename: loggerModulePath,
  loaded: true,
  exports: {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    initLogger: noop,
  },
};

// require services under test
const predictiveService = require('../electron/services/predictiveService.cjs');
const taskEngine = require('../electron/services/taskEngine.cjs');
const outcomesService = require('../electron/services/outcomesService.cjs');
const srtrService = require('../electron/services/srtrService.cjs');

// test harness
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg || 'Expected function to throw');
}

// helpers
const { v4: uuidv4 } = require('uuid');
const ORG = 'TEST_ORG';
const OTHER_ORG = 'OTHER_ORG';

function seedPatient(overrides = {}) {
  const id = overrides.id || uuidv4();
  const defaults = {
    id,
    org_id: ORG,
    patient_id: `MRN-${id.slice(0, 6)}`,
    first_name: 'Test',
    last_name: 'Patient',
    blood_type: 'O+',
    organ_needed: 'kidney',
    waitlist_status: 'active',
    medical_urgency: 'high',
    last_evaluation_date: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    date_added_to_waitlist: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString(),
    diagnosis: 'ESRD',
    priority_score: 50,
    compliance_score: 7,
    comorbidity_score: 3,
    hla_typing: 'A2 A24 B7 B44 DR4 DR11 DQ3',
  };
  const p = { ...defaults, ...overrides };
  const cols = Object.keys(p);
  db.prepare(
    `INSERT INTO patients (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...Object.values(p));
  return p;
}

function seedBarrier(overrides = {}) {
  const id = overrides.id || uuidv4();
  const defaults = {
    id,
    org_id: ORG,
    patient_id: null,
    barrier_type: 'insurance',
    status: 'open',
    risk_level: 'high',
    owning_role: 'coordinator',
    identified_date: new Date().toISOString(),
    target_resolution_date: null,
    resolved_date: null,
  };
  const b = { ...defaults, ...overrides };
  const cols = Object.keys(b);
  db.prepare(
    `INSERT INTO readiness_barriers (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...Object.values(b));
  return b;
}

function seedAuditLog(overrides = {}) {
  const id = overrides.id || uuidv4();
  const defaults = {
    id,
    org_id: ORG,
    action: 'update',
    entity_type: 'Patient',
    entity_id: null,
    details: '{"status":"changed"}',
    user_email: 'test@test.com',
    user_role: 'admin',
  };
  const a = { ...defaults, ...overrides };
  const cols = Object.keys(a);
  db.prepare(
    `INSERT INTO audit_logs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...Object.values(a));
  return a;
}

// run all suites

function runTests() {
  console.log('\n========================================');
  console.log(' Enterprise Services Tests');
  console.log('========================================\n');

  setupDB();

  // -- predictive service --
  console.log('Suite 1: Predictive Service');
  console.log('──────────────────────────');

  test('1.1 FACTOR_WEIGHTS exports correct keys', () => {
    const w = predictiveService.FACTOR_WEIGHTS;
    assert(w.EVAL_EXPIRY === 0.30, 'EVAL_EXPIRY weight');
    assert(w.DOCUMENTATION === 0.20, 'DOCUMENTATION weight');
    assert(w.BARRIERS === 0.20, 'BARRIERS weight');
    assert(w.STATUS_CHURN === 0.15, 'STATUS_CHURN weight');
    assert(w.CONTACT_RECENCY === 0.15, 'CONTACT_RECENCY weight');
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    assert(Math.abs(sum - 1.0) < 0.001, 'Weights must sum to 1.0');
  });

  test('1.2 RISK_THRESHOLDS exports correct values', () => {
    const t = predictiveService.RISK_THRESHOLDS;
    assert(t.critical === 75, 'critical threshold');
    assert(t.high === 50, 'high threshold');
    assert(t.moderate === 25, 'moderate threshold');
  });

  test('1.3 predictPatient returns a valid prediction object', () => {
    const patient = seedPatient();
    const pred = predictiveService.predictPatient(ORG, patient);
    assert(typeof pred.risk_score === 'number', 'risk_score is number');
    assert(pred.risk_score >= 0 && pred.risk_score <= 100, 'risk_score in [0,100]');
    assert(['critical', 'high', 'moderate', 'low'].includes(pred.risk_level), 'valid risk_level');
    assert(typeof pred.eval_expiry_factor === 'number', 'eval_expiry_factor');
    assert(typeof pred.documentation_factor === 'number', 'documentation_factor');
    assert(typeof pred.barrier_factor === 'number', 'barrier_factor');
    assert(typeof pred.status_churn_factor === 'number', 'status_churn_factor');
    assert(typeof pred.contact_recency_factor === 'number', 'contact_recency_factor');
    assert(typeof pred.recommendation === 'string', 'recommendation');
    assert(typeof pred.contributing_factors === 'string', 'contributing_factors is JSON string');
    JSON.parse(pred.contributing_factors);
  });

  test('1.4 predictPatient returns 100 eval factor when no eval date', () => {
    const patient = seedPatient({ last_evaluation_date: null });
    const pred = predictiveService.predictPatient(ORG, patient);
    assertEqual(pred.eval_expiry_factor, 100, 'eval_expiry_factor for null eval date');
  });

  test('1.5 predictPatient returns lower eval factor for recent eval', () => {
    const recent = seedPatient({
      last_evaluation_date: new Date().toISOString(),
    });
    const pred = predictiveService.predictPatient(ORG, recent);
    assert(pred.eval_expiry_factor < 50, `Recent eval should yield low factor, got ${pred.eval_expiry_factor}`);
  });

  test('1.6 predictPatient classifies critical risk for score >= 75', () => {
    const patient = seedPatient({
      last_evaluation_date: null,
      updated_at: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
      created_at: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
    });
    seedBarrier({ patient_id: patient.id, risk_level: 'high', status: 'open' });
    seedBarrier({ patient_id: patient.id, risk_level: 'high', status: 'open' });
    seedBarrier({ patient_id: patient.id, risk_level: 'high', status: 'open' });
    const pred = predictiveService.predictPatient(ORG, patient);
    assertEqual(pred.risk_level, 'critical', 'Should classify as critical');
  });

  test('1.7 predictPatient classifies low risk for healthy patient', () => {
    const patient = seedPatient({
      last_evaluation_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    const pred = predictiveService.predictPatient(ORG, patient);
    assertEqual(pred.risk_level, 'low', 'Healthy patient should be low risk');
  });

  test('1.8 runPredictions requires orgId', () => {
    assertThrows(() => predictiveService.runPredictions(null), 'Should throw without orgId');
  });

  test('1.9 runPredictions scores all active patients and persists', () => {
    db.exec("DELETE FROM patients WHERE org_id = '" + ORG + "'");
    db.exec("DELETE FROM inactivation_predictions WHERE org_id = '" + ORG + "'");
    seedPatient({ waitlist_status: 'active' });
    seedPatient({ waitlist_status: 'active' });
    seedPatient({ waitlist_status: 'inactive' });

    const result = predictiveService.runPredictions(ORG);
    assertEqual(result.patientsScored, 2, 'Should score 2 active patients');

    const rows = db.prepare(
      "SELECT * FROM inactivation_predictions WHERE org_id = ? AND is_current = 1"
    ).all(ORG);
    assertEqual(rows.length, 2, 'Should persist 2 current predictions');
  });

  test('1.10 getCurrentPredictions returns scored patients', () => {
    const preds = predictiveService.getCurrentPredictions(ORG);
    assertEqual(preds.length, 2, 'Should return 2 predictions');
    assert(preds[0].risk_score >= preds[1].risk_score, 'Sorted descending by risk_score');
    assert(preds[0].first_name, 'Should join patient name');
  });

  test('1.11 getPredictionDashboard returns structured summary', () => {
    const dash = predictiveService.getPredictionDashboard(ORG);
    assert(typeof dash.summary.total === 'number', 'summary.total');
    assert(typeof dash.summary.avgScore === 'number', 'summary.avgScore');
    assert(Array.isArray(dash.topRiskPatients), 'topRiskPatients is array');
    assert(typeof dash.factorAverages.evalExpiry === 'number', 'factorAverages.evalExpiry');
  });

  test('1.12 runPredictions marks old predictions as not current', () => {
    predictiveService.runPredictions(ORG);
    const notCurrent = db.prepare(
      "SELECT COUNT(*) as count FROM inactivation_predictions WHERE org_id = ? AND is_current = 0"
    ).get(ORG);
    assert(notCurrent.count > 0, 'Previous predictions should be marked is_current = 0');
  });

  // -- task engine --
  console.log('\nSuite 2: Task Engine');
  console.log('──────────────────────────');

  test('2.1 createTask creates a task with correct fields and org_id', () => {
    const task = taskEngine.createTask(ORG, {
      title: 'Follow up with patient',
      description: 'Check insurance status',
      task_type: 'GENERAL',
      priority: 'high',
    }, 'admin@test.com');

    assert(task.id, 'Should have id');
    assertEqual(task.org_id, ORG, 'org_id should match');
    assertEqual(task.title, 'Follow up with patient', 'title');
    assertEqual(task.status, 'pending', 'Initial status should be pending');
    assertEqual(task.priority, 'high', 'priority');
    assertEqual(task.created_by, 'admin@test.com', 'created_by');
  });

  test('2.2 createTask requires orgId', () => {
    assertThrows(
      () => taskEngine.createTask(null, { title: 'x' }, 'user'),
      'Should throw without orgId'
    );
  });

  test('2.3 updateTask correctly updates status and records completed_by', () => {
    const task = taskEngine.createTask(ORG, { title: 'Finish paperwork' }, 'admin');
    const updated = taskEngine.updateTask(ORG, task.id, {
      status: 'completed',
      resolution_notes: 'Done',
    }, 'coordinator@test.com');

    assertEqual(updated.status, 'completed', 'status');
    assertEqual(updated.completed_by, 'coordinator@test.com', 'completed_by');
    assert(updated.completed_date, 'Should have completed_date');
    assert(updated.updated_at, 'Should have updated_at');
  });

  test('2.4 updateTask throws for non-existent task', () => {
    assertThrows(
      () => taskEngine.updateTask(ORG, 'non-existent-id', { status: 'completed' }, 'user'),
      'Should throw for missing task'
    );
  });

  test('2.5 deleteTask removes the task', () => {
    const task = taskEngine.createTask(ORG, { title: 'Temporary task' }, 'admin');
    const result = taskEngine.deleteTask(ORG, task.id);
    assert(result.success, 'deleteTask should succeed');
    const found = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
    assert(!found, 'Task should be removed from DB');
  });

  test('2.6 deleteTask throws for non-existent task', () => {
    assertThrows(
      () => taskEngine.deleteTask(ORG, 'ghost-id'),
      'Should throw for missing task'
    );
  });

  test('2.7 getAllTasks returns only tasks for the given org', () => {
    db.exec("DELETE FROM tasks");
    taskEngine.createTask(ORG, { title: 'Org A task 1' }, 'admin');
    taskEngine.createTask(ORG, { title: 'Org A task 2' }, 'admin');
    taskEngine.createTask(OTHER_ORG, { title: 'Org B task' }, 'admin');

    const orgATasks = taskEngine.getAllTasks(ORG);
    assertEqual(orgATasks.length, 2, 'Should return 2 tasks for ORG');
    orgATasks.forEach(t => assertEqual(t.org_id, ORG, 'All tasks should belong to ORG'));

    const orgBTasks = taskEngine.getAllTasks(OTHER_ORG);
    assertEqual(orgBTasks.length, 1, 'Should return 1 task for OTHER_ORG');
  });

  test('2.8 getAllTasks supports filters', () => {
    db.exec("DELETE FROM tasks");
    taskEngine.createTask(ORG, { title: 'Urgent task', priority: 'urgent' }, 'admin');
    taskEngine.createTask(ORG, { title: 'Normal task', priority: 'normal' }, 'admin');

    const urgent = taskEngine.getAllTasks(ORG, { priority: 'urgent' });
    assertEqual(urgent.length, 1, 'Filter by priority');
    assertEqual(urgent[0].title, 'Urgent task', 'Should be the urgent task');
  });

  test('2.9 processEscalations wraps operations in a transaction', () => {
    db.exec("DELETE FROM tasks");
    db.exec("DELETE FROM task_escalation_rules");

    const pastDate = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    taskEngine.createTask(ORG, {
      title: 'Overdue task',
      task_type: 'EVALUATION_RENEWAL',
      due_date: pastDate,
    }, 'admin');

    const ruleId = uuidv4();
    db.prepare(`
      INSERT INTO task_escalation_rules (id, org_id, task_type, escalation_level, hours_before_escalation, escalate_to_role, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(ruleId, ORG, 'EVALUATION_RENEWAL', 1, 1, 'manager', 'admin');

    const result = taskEngine.processEscalations(ORG);
    assert(typeof result.overdue === 'number', 'Should report overdue count');
    assert(Array.isArray(result.escalated), 'Should report escalated array');
    assert(result.overdue >= 1, 'Should have at least 1 overdue task');
  });

  test('2.10 processEscalations escalates to correct role', () => {
    const tasks = db.prepare("SELECT * FROM tasks WHERE org_id = ? AND status = 'escalated'").all(ORG);
    if (tasks.length > 0) {
      assertEqual(tasks[0].escalated_to, 'manager', 'Should escalate to manager role');
      assertEqual(tasks[0].escalation_level, 1, 'Should be escalation level 1');
    }
  });

  // -- outcomes service --
  console.log('\nSuite 3: Outcomes Service');
  console.log('──────────────────────────');

  test('3.1 computeOutcomesSnapshot requires orgId', () => {
    assertThrows(
      () => outcomesService.computeOutcomesSnapshot(null, '2025-01-01', '2025-12-31'),
      'Should throw without orgId'
    );
  });

  test('3.2 computeOutcomesSnapshot returns numeric values for all metrics', () => {
    db.exec("DELETE FROM patients");
    seedPatient({ waitlist_status: 'active' });
    seedPatient({ waitlist_status: 'active' });
    seedPatient({ waitlist_status: 'inactive', updated_at: new Date().toISOString() });

    const now = new Date().toISOString();
    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const snap = outcomesService.computeOutcomesSnapshot(ORG, yearAgo, now);

    const numericFields = [
      'total_active_patients', 'total_inactivations',
      'risk_alerts_with_resolution', 'evaluations_renewed_on_time',
      'evaluations_lapsed', 'avg_barrier_resolution_days',
      'barriers_resolved', 'barriers_opened',
      'avg_time_to_intervention_hours', 'risk_alerts_generated',
      'risk_alerts_acted_on', 'coordinator_load_std_dev',
      'patients_at_risk', 'patients_at_risk_percentage',
      'tasks_auto_generated', 'tasks_completed_on_time', 'tasks_escalated',
    ];
    for (const field of numericFields) {
      assert(typeof snap[field] === 'number', `${field} should be a number, got ${typeof snap[field]}`);
    }
    assertEqual(snap.total_active_patients, 2, 'active patient count');
  });

  test('3.3 computeOutcomesSnapshot counts inactivations in period', () => {
    const now = new Date().toISOString();
    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const snap = outcomesService.computeOutcomesSnapshot(ORG, yearAgo, now);
    assertEqual(snap.total_inactivations, 1, 'Should count 1 inactivation');
  });

  test('3.4 saveSnapshot persists data and returns a record', () => {
    const now = new Date().toISOString();
    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const record = outcomesService.saveSnapshot(ORG, yearAgo, now, 'admin@test.com');

    assert(record.id, 'Should have id');
    assertEqual(record.org_id, ORG, 'org_id');
    assertEqual(record.created_by, 'admin@test.com', 'created_by');
    assert(typeof record.total_active_patients === 'number', 'Should persist metrics');
    assert(record.snapshot_date, 'Should have snapshot_date');
  });

  test('3.5 getSnapshots retrieves saved snapshots ordered by date desc', () => {
    outcomesService.saveSnapshot(ORG, '2025-01-01', '2025-06-30', 'admin');
    outcomesService.saveSnapshot(ORG, '2025-07-01', '2025-12-31', 'admin');

    const snaps = outcomesService.getSnapshots(ORG);
    assert(snaps.length >= 2, 'Should have at least 2 snapshots');
    for (let i = 1; i < snaps.length; i++) {
      assert(snaps[i - 1].snapshot_date >= snaps[i].snapshot_date, 'Should be ordered desc by date');
    }
  });

  test('3.6 getSnapshots respects limit parameter', () => {
    const limited = outcomesService.getSnapshots(ORG, 1);
    assertEqual(limited.length, 1, 'Should return exactly 1 snapshot');
  });

  test('3.7 getSnapshots requires orgId', () => {
    assertThrows(
      () => outcomesService.getSnapshots(null),
      'Should throw without orgId'
    );
  });

  // -- srtr service --
  console.log('\nSuite 4: SRTR Service');
  console.log('──────────────────────────');

  test('4.1 computeCurrentMetrics requires orgId', () => {
    assertThrows(
      () => srtrService.computeCurrentMetrics(null),
      'Should throw without orgId'
    );
  });

  test('4.2 computeCurrentMetrics returns correct patient counts by status', () => {
    db.exec("DELETE FROM patients");
    seedPatient({ waitlist_status: 'active' });
    seedPatient({ waitlist_status: 'active' });
    seedPatient({ waitlist_status: 'active' });
    seedPatient({ waitlist_status: 'inactive' });
    seedPatient({ waitlist_status: 'transplanted' });

    const m = srtrService.computeCurrentMetrics(ORG);
    assertEqual(m.active_waitlisted, 3, 'active_waitlisted');
    assertEqual(m.inactive_waitlisted, 1, 'inactive_waitlisted');
    assertEqual(m.total_waitlisted, 4, 'total_waitlisted (active + inactive)');
    assertEqual(m.removals_transplanted, 1, 'removals_transplanted');
  });

  test('4.3 computeCurrentMetrics calculates inactive percentage', () => {
    const m = srtrService.computeCurrentMetrics(ORG);
    const expected = Math.round((1 / 4) * 1000) / 10;
    assertEqual(m.inactive_percentage, expected, 'inactive_percentage');
  });

  test('4.4 computeCurrentMetrics returns numeric types for all fields', () => {
    const m = srtrService.computeCurrentMetrics(ORG);
    const numFields = [
      'total_waitlisted', 'active_waitlisted', 'inactive_waitlisted',
      'inactive_percentage', 'new_listings', 'removals_transplanted',
      'removals_deceased', 'removals_other', 'median_wait_days',
      'transplant_rate', 'offer_acceptance_rate',
      'evaluation_completion_rate', 'documentation_completeness_rate',
    ];
    for (const f of numFields) {
      assert(typeof m[f] === 'number', `${f} should be number, got ${typeof m[f]}`);
    }
    assert(typeof m.cms_survey_risk_level === 'string', 'cms_survey_risk_level is string');
    assert(typeof m.cms_risk_factors === 'string', 'cms_risk_factors is JSON string');
    JSON.parse(m.cms_risk_factors);
  });

  test('4.5 computeCurrentMetrics assigns risk level based on risk factor count', () => {
    db.exec("DELETE FROM patients");
    // With 0 active patients evalRate=0 (<80) and docRate=0 (<70) → 2 risk factors → "high"
    const m = srtrService.computeCurrentMetrics(ORG);
    assertEqual(m.cms_survey_risk_level, 'high', '0 active patients triggers eval+doc risk factors -> high');

    // Seed compliant patients to bring rates above thresholds
    seedPatient({
      waitlist_status: 'active',
      last_evaluation_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      diagnosis: 'CKD',
      blood_type: 'A+',
      organ_needed: 'kidney',
    });
    const m2 = srtrService.computeCurrentMetrics(ORG);
    assert(
      ['low', 'moderate'].includes(m2.cms_survey_risk_level),
      `Fully compliant patient should reduce risk level, got ${m2.cms_survey_risk_level}`
    );
  });

  test('4.6 getCMSChecklist returns checks array with proper structure', () => {
    db.exec("DELETE FROM patients");
    seedPatient({ waitlist_status: 'active', diagnosis: 'CKD', blood_type: 'A+', organ_needed: 'kidney' });

    const result = srtrService.getCMSChecklist(ORG);
    assert(Array.isArray(result.checks), 'checks is array');
    assert(result.checks.length > 0, 'Should have checks');

    const first = result.checks[0];
    assert(first.id, 'Check has id');
    assert(first.category, 'Check has category');
    assert(first.requirement, 'Check has requirement');
    assert(['pass', 'warning', 'fail'].includes(first.status), 'Valid status');
    assert(first.metric, 'Check has metric');

    assert(typeof result.summary === 'object', 'Has summary');
    assert(typeof result.summary.pass === 'number', 'summary.pass is number');
    assert(typeof result.summary.warning === 'number', 'summary.warning is number');
    assert(typeof result.summary.fail === 'number', 'summary.fail is number');
    assert(typeof result.summary.total === 'number', 'summary.total is number');
    assert(typeof result.overallScore === 'number', 'Has overallScore');
    assert(['at_risk', 'needs_attention', 'survey_ready'].includes(result.overallStatus), 'Valid overallStatus');
  });

  test('4.7 getCMSChecklist includes known check categories', () => {
    const result = srtrService.getCMSChecklist(ORG);
    const ids = result.checks.map(c => c.id);
    assert(ids.includes('eval_currency'), 'Has eval_currency check');
    assert(ids.includes('audit_trail'), 'Has audit_trail check');
    assert(ids.includes('encryption'), 'Has encryption check');
    assert(ids.includes('data_completeness'), 'Has data_completeness check');
    assert(ids.includes('inactivation_rate'), 'Has inactivation_rate check');
  });

  test('4.8 saveMetricSnapshot persists and returns data', () => {
    const snap = srtrService.saveMetricSnapshot(ORG, '2025-Q1', 'admin@test.com');
    assert(snap.id, 'Should have id');
    assertEqual(snap.org_id, ORG, 'org_id');
    assertEqual(snap.period_label, '2025-Q1', 'period_label');
    assertEqual(snap.created_by, 'admin@test.com', 'created_by');
    assert(typeof snap.total_waitlisted === 'number', 'Should persist total_waitlisted');
    assert(typeof snap.active_waitlisted === 'number', 'Should persist active_waitlisted');
    assert(snap.metric_date, 'Should have metric_date');

    const inDb = db.prepare('SELECT * FROM srtr_metrics WHERE id = ?').get(snap.id);
    assert(inDb, 'Record should exist in database');
    assertEqual(inDb.org_id, ORG, 'DB record org_id matches');
  });

  test('4.9 saveMetricSnapshot requires orgId', () => {
    assertThrows(
      () => srtrService.saveMetricSnapshot(null, 'Q1', 'admin'),
      'Should throw without orgId'
    );
  });

  test('4.10 getMetricHistory returns snapshots in order', () => {
    srtrService.saveMetricSnapshot(ORG, '2025-Q2', 'admin');
    const history = srtrService.getMetricHistory(ORG);
    assert(history.length >= 2, 'Should have at least 2 snapshots');
    for (let i = 1; i < history.length; i++) {
      assert(history[i - 1].metric_date >= history[i].metric_date, 'Ordered desc by metric_date');
    }
  });

  // summary
  console.log('\n========================================');
  console.log(' Test Summary');
  console.log('========================================');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failures.length > 0) {
    console.log('\n  Failed Tests:');
    failures.forEach(({ name, error }) => console.log(`    - ${name}: ${error}`));
  }

  db.close();

  if (failed > 0) {
    console.log('\n✗ Some tests failed.');
    process.exit(1);
  } else {
    console.log('\n✓ All enterprise service tests passed!');
    process.exit(0);
  }
}

runTests();
