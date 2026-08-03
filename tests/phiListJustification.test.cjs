/**
 * TransTrack — bulk PHI read justification tests (finding H-1).
 *
 * `entity:get` for a Patient has always required a justification grant, but
 * `entity:list` and `entity:filter` return `SELECT *` for every patient in the
 * organisation. With only a role check on those channels, any holder of
 * patient:view — including the read-only `viewer` role — could extract the
 * entire patient population without a recorded reason, which defeats the whole
 * justification control.
 *
 * These tests exercise the real ipcMain handlers registered by
 * electron/ipc/handlers/entities.cjs against an in-memory database, so they pin
 * handler behaviour rather than a reimplementation of it.
 *
 * Run standalone: node tests/phiListJustification.test.cjs
 */

'use strict';

const assert = require('assert');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');

const registeredHandlers = {};
const mockApp = { getPath: () => __dirname, isPackaged: false };
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: mockApp,
    ipcMain: { handle: (channel, fn) => { registeredHandlers[channel] = fn; } },
    dialog: {},
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, status TEXT);
  CREATE TABLE users (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT, role TEXT,
    is_active INTEGER DEFAULT 1
  );
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
  CREATE TABLE patients (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, patient_id TEXT,
    first_name TEXT, last_name TEXT, date_of_birth TEXT, blood_type TEXT,
    organ_needed TEXT, medical_urgency TEXT, waitlist_status TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
  );
  CREATE TABLE donor_organs (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, donor_id TEXT, organ_type TEXT,
    blood_type TEXT, organ_status TEXT, status TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
  );
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, action TEXT NOT NULL,
    entity_type TEXT, entity_id TEXT, patient_name TEXT, details TEXT,
    user_id TEXT, user_email TEXT, user_role TEXT, request_id TEXT,
    prev_hash TEXT, record_hash TEXT, record_hmac TEXT, seq INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE access_justification_logs (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT, user_email TEXT,
    user_role TEXT, permission TEXT, entity_type TEXT, entity_id TEXT,
    justification_reason TEXT, justification_details TEXT, access_time TEXT
  );
`);

const initPath = require.resolve('../electron/database/init.cjs');
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: { getDatabase: () => db, getDatabasePath: () => ':memory:' },
};

const siemPath = require.resolve('../electron/services/siemForwarder.cjs');
require.cache[siemPath] = {
  id: siemPath, filename: siemPath, loaded: true,
  exports: { forwardAuditRow: () => {} },
};

const shared = require('../electron/ipc/shared.cjs');
const accessControl = require('../electron/services/accessControl.cjs');
const entities = require(path.join('..', 'electron', 'ipc', 'handlers', 'entities.cjs'));

entities.register();

let PASS = 0, FAIL = 0;
const failures = [];
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

const ORG = 'ORG_PHI_LIST';
db.prepare('INSERT INTO organizations (id, name, status) VALUES (?, ?, ?)').run(ORG, 'Test Org', 'ACTIVE');

const USERS = {
  coordinator: { id: 'u-coord', org_id: ORG, email: 'coord@test.local', role: 'coordinator' },
  viewer:      { id: 'u-view',  org_id: ORG, email: 'viewer@test.local', role: 'viewer' },
};
for (const u of Object.values(USERS)) {
  db.prepare('INSERT INTO users (id, org_id, email, role) VALUES (?, ?, ?, ?)').run(u.id, u.org_id, u.email, u.role);
  db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run(`s-${u.id}`, u.id);
}

for (let i = 0; i < 3; i++) {
  db.prepare(
    'INSERT INTO patients (id, org_id, patient_id, first_name, last_name, waitlist_status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(`p${i}`, ORG, `PT-100${i}`, `First${i}`, `Last${i}`, 'active');
}
db.prepare('INSERT INTO donor_organs (id, org_id, donor_id, organ_type, status) VALUES (?, ?, ?, ?, ?)')
  .run('d0', ORG, 'DN-1', 'Kidney', 'available');

function loginAs(user) {
  shared.setSessionState(`s-${user.id}`, { ...user }, Date.now() + 3600000, null);
}

/** Take the list-scope grant exactly the way the access:authorizePhiAccess IPC does. */
function grantListScope(user) {
  return accessControl.authorizeAndLogPhiAccess({
    permission: accessControl.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: '*',
    justification: 'Coordinating waitlist review for the active candidate list',
    user,
  });
}

const list = (entityName, ...args) => registeredHandlers['entity:list']({}, entityName, ...args);
const filter = (entityName, ...args) => registeredHandlers['entity:filter']({}, entityName, ...args);

async function rejects(promise, pattern, message) {
  try {
    await promise;
  } catch (e) {
    assert.match(e.message, pattern, message);
    return;
  }
  throw new Error(`${message}: expected a rejection`);
}

test('entity:list Patient is refused without a grant', async () => {
  loginAs(USERS.coordinator);
  await rejects(list('Patient'), /justification required/i, 'coordinator without a grant');
});

test('entity:filter Patient is refused without a grant', async () => {
  await rejects(
    filter('Patient', { waitlist_status: 'active' }),
    /justification required/i,
    'coordinator without a grant'
  );
});

test('a single-record grant does not authorise a bulk read', async () => {
  accessControl.authorizeAndLogPhiAccess({
    permission: accessControl.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: 'p0',
    justification: 'Reviewing a single candidate for transplant readiness',
    user: USERS.coordinator,
  });
  await rejects(list('Patient'), /justification required/i, 'record-scoped grant');
});

test('a justified coordinator can bulk-list patients', async () => {
  const grant = grantListScope(USERS.coordinator);
  assert.strictEqual(grant.granted, true, 'coordinator must be able to take a list-scope grant');
  const rows = await list('Patient');
  assert.strictEqual(rows.length, 3, 'all org patients must be returned once justified');
});

test('a justified coordinator can bulk-filter patients', async () => {
  const rows = await filter('Patient', { waitlist_status: 'active' });
  assert.strictEqual(rows.length, 3, 'filter must return the matching rows once justified');
});

test('bulk reads are justified in the access log and audited', () => {
  const justification = db.prepare(
    "SELECT * FROM access_justification_logs WHERE user_id = ? AND entity_id = '*'"
  ).get(USERS.coordinator.id);
  assert.ok(justification, 'the list-scope grant must be recorded in access_justification_logs');
  assert.ok(justification.justification_details.length >= 10);

  const audits = db.prepare(
    "SELECT action FROM audit_logs WHERE org_id = ? AND entity_type = 'Patient'"
  ).all(ORG).map((r) => r.action);
  assert.ok(audits.includes('list'), 'the bulk list must still be audited');
  assert.ok(audits.includes('filter'), 'the bulk filter must be audited');
});

test('a viewer cannot obtain a grant and cannot bulk-list patients', async () => {
  const denied = grantListScope(USERS.viewer);
  assert.strictEqual(denied.granted, false, 'viewer holds no PATIENT_VIEW_PHI so cannot take a grant');
  loginAs(USERS.viewer);
  await rejects(list('Patient'), /justification required/i, 'viewer bulk read');
});

test('non-patient entities are unaffected by the PHI gate', async () => {
  loginAs(USERS.coordinator);
  const rows = await list('DonorOrgan');
  assert.strictEqual(rows.length, 1, 'non-PHI entity listing must not require a PHI grant');
});

(async () => {
  console.log('phiListJustification — bulk Patient reads require a justification grant\n');
  for (const { name, fn } of cases) {
    try { await fn(); PASS++; console.log(`  ok  ${name}`); }
    catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
  }
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  if (FAIL > 0) {
    for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
    process.exit(1);
  }
})();
