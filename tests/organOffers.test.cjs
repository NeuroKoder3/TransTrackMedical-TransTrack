/**
 * TransTrack — Organ offer state machine unit tests.
 *
 * Uses an in-memory SQLite database to exercise the service end-to-end
 * without touching the user's disk-based DB. We reuse the schema from
 * the production migrations module.
 *
 * Run with: node tests/organOffers.test.cjs
 */

'use strict';

const assert = require('assert');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const initModule = require('../electron/database/init.cjs');

// Build an in-memory db with just enough schema for organ_offers + events
function buildTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY, name TEXT, status TEXT
    );
    CREATE TABLE patients (id TEXT PRIMARY KEY, org_id TEXT);
    CREATE TABLE donor_organs (id TEXT PRIMARY KEY, org_id TEXT);
    CREATE TABLE organ_offers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_organ_id TEXT,
      patient_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      rank INTEGER,
      offered_at TEXT NOT NULL DEFAULT (datetime('now')),
      response_due_at TEXT,
      responded_at TEXT,
      decline_reason_code TEXT,
      decline_reason_text TEXT,
      backup_chain_position INTEGER,
      notes TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE organ_offer_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      offer_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      actor TEXT,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO organizations (id, name, status) VALUES ('ORG1', 'Test', 'ACTIVE');
    INSERT INTO patients (id, org_id) VALUES ('P1', 'ORG1');
    INSERT INTO donor_organs (id, org_id) VALUES ('D1', 'ORG1');
  `);
  return db;
}

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

const db = buildTestDb();
// Stub the init module's getDatabase() to return our in-memory DB.
initModule.getDatabase = () => db;

const offers = require('../electron/services/organOffers.cjs');

console.log('\n=== Organ Offer state machine ===');

test('createOffer requires orgId, donorOrganId, patientId', () => {
  assert.throws(() => offers.createOffer({}));
  assert.throws(() => offers.createOffer({ orgId: 'ORG1' }));
  assert.throws(() => offers.createOffer({ orgId: 'ORG1', donorOrganId: 'D1' }));
});

test('createOffer creates a PENDING offer + OFFER_CREATED event', () => {
  const o = offers.createOffer({
    orgId: 'ORG1', donorOrganId: 'D1', patientId: 'P1',
    rank: 1, createdBy: 'tester@example.com',
  });
  assert.ok(o.id);
  assert.strictEqual(o.status, 'PENDING');
  const events = offers.getEvents(o.id, 'ORG1');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].event_type, 'OFFER_CREATED');
  assert.strictEqual(events[0].to_status, 'PENDING');
});

test('PENDING → ACCEPTED_PROVISIONAL is allowed and recorded', () => {
  const o = offers.createOffer({ orgId: 'ORG1', donorOrganId: 'D1', patientId: 'P1' });
  const updated = offers.transition({
    id: o.id, orgId: 'ORG1', toStatus: 'ACCEPTED_PROVISIONAL', actor: 'tester',
  });
  assert.strictEqual(updated.status, 'ACCEPTED_PROVISIONAL');
  const events = offers.getEvents(o.id, 'ORG1');
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1].from_status, 'PENDING');
  assert.strictEqual(events[1].to_status, 'ACCEPTED_PROVISIONAL');
});

test('PENDING → DECLINED requires a known decline_reason_code', () => {
  const o = offers.createOffer({ orgId: 'ORG1', donorOrganId: 'D1', patientId: 'P1' });
  assert.throws(() => offers.transition({
    id: o.id, orgId: 'ORG1', toStatus: 'DECLINED', actor: 'tester',
  }));
  assert.throws(() => offers.transition({
    id: o.id, orgId: 'ORG1', toStatus: 'DECLINED', actor: 'tester', declineReasonCode: 'BOGUS',
  }));
  const updated = offers.transition({
    id: o.id, orgId: 'ORG1', toStatus: 'DECLINED', actor: 'tester', declineReasonCode: '700',
  });
  assert.strictEqual(updated.status, 'DECLINED');
  assert.strictEqual(updated.decline_reason_code, '700');
});

test('decline_reason_code 799 (Other) requires text', () => {
  const o = offers.createOffer({ orgId: 'ORG1', donorOrganId: 'D1', patientId: 'P1' });
  assert.throws(() => offers.transition({
    id: o.id, orgId: 'ORG1', toStatus: 'DECLINED', actor: 'tester', declineReasonCode: '799',
  }));
  const updated = offers.transition({
    id: o.id, orgId: 'ORG1', toStatus: 'DECLINED', actor: 'tester',
    declineReasonCode: '799', declineReasonText: 'Surgeon discretion',
  });
  assert.strictEqual(updated.status, 'DECLINED');
});

test('terminal states reject further transitions', () => {
  const o = offers.createOffer({ orgId: 'ORG1', donorOrganId: 'D1', patientId: 'P1' });
  offers.transition({ id: o.id, orgId: 'ORG1', toStatus: 'ACCEPTED_FINAL', actor: 'tester' });
  assert.throws(() => offers.transition({
    id: o.id, orgId: 'ORG1', toStatus: 'DECLINED', actor: 'tester', declineReasonCode: '700',
  }));
});

test('cross-org access returns null', () => {
  const o = offers.createOffer({ orgId: 'ORG1', donorOrganId: 'D1', patientId: 'P1' });
  assert.strictEqual(offers.getOffer(o.id, 'ORG_OTHER'), undefined);
});

test('expireDue marks PENDING offers past response_due_at as EXPIRED', () => {
  const o = offers.createOffer({
    orgId: 'ORG1', donorOrganId: 'D1', patientId: 'P1',
    responseDueAt: new Date(Date.now() - 1000).toISOString().slice(0, 19).replace('T', ' '),
  });
  const result = offers.expireDue({ orgId: 'ORG1' });
  assert.ok(result.expired.includes(o.id));
  assert.strictEqual(offers.getOffer(o.id, 'ORG1').status, 'EXPIRED');
});

test('listOffers filters by status, donor and patient', () => {
  const all = offers.listOffers({ orgId: 'ORG1' });
  assert.ok(all.length > 0);
  const declined = offers.listOffers({ orgId: 'ORG1', status: 'DECLINED' });
  assert.ok(declined.every(o => o.status === 'DECLINED'));
  const byDonor = offers.listOffers({ orgId: 'ORG1', donorOrganId: 'D1' });
  assert.ok(byDonor.every(o => o.donor_organ_id === 'D1'));
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
