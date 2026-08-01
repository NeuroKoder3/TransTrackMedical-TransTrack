/**
 * TransTrack — filing an IOTA notice into the patient's chart.
 *
 * CMS IOTA Model § 512.442(d) requires a copy of the notice be recorded in the
 * medical record. These tests cover the FHIR DocumentReference path end to
 * end, with particular attention to the ways it can go wrong:
 *
 *   • a body that no longer matches its recorded hash must never be filed;
 *   • a live send must be impossible without an explicitly injected transport,
 *     so an offline-first desktop application cannot acquire network access by
 *     accident or by configuration drift;
 *   • a failed create must be recorded, not swallowed, because the obligation
 *     is still outstanding; and
 *   • a notice already filed must not be filed twice.
 *
 * Run standalone: node tests/chartFiling.test.cjs
 */

'use strict';

const assert = require('assert');
const { createHash } = require('crypto');
const Database = require('better-sqlite3-multiple-ciphers');

const {
  createSchema, createIndexes, createAuditLogTriggers,
} = require('../electron/database/schema.cjs');
const cf = require('../electron/services/chartFiling.cjs');
const svc = require('../electron/services/iotaNoticeService.cjs');
const generator = require('../electron/services/iotaNoticeGenerator.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  const done = (e) => {
    if (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
    else { PASS++; console.log(`  ok  ${name}`); }
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => done(), done);
    done();
  } catch (e) { done(e); }
  return Promise.resolve();
}

const ORG = 'org-cf';
const PATIENT = 'pat-cf';
const EPIC_ID = 'erXuFYUfucBZaryVksYEcMg3';
const ACTOR = { id: 'u1', email: 'coord@example.org', role: 'coordinator' };

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  createIndexes(db);
  createAuditLogTriggers(db);
  svc._resetColumnCache();

  db.prepare('INSERT INTO organizations (id, name, phone) VALUES (?, ?, ?)')
    .run(ORG, 'Northern Regional Transplant Center', '555-0100');
  db.prepare(
    `INSERT INTO patients (id, org_id, patient_id, first_name, last_name, organ_needed)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(PATIENT, ORG, 'MRN-4471', 'Dana', 'Whitfield', 'kidney');

  svc.saveConfig(db, ORG, {
    template: generator.EXAMPLE_TEMPLATE,
    reactivationSteps: 'Complete cardiac clearance and call the office.',
    coordinatorName: 'J. Alvarez, RN',
    coordinatorPhone: '555-0142',
  });
  return db;
}

function seedNotice(db) {
  const { notice } = svc.recordTransition(db, {
    orgId: ORG, patientId: PATIENT, fromStatus: 'active', toStatus: 'inactive',
    reasonCode: 'EVAL_EXPIRED', effectiveAt: '2026-07-01T14:00:00Z',
    offerEligibilityImpact: 'blocks_offers',
  }, ACTOR);
  return notice;
}

const run = async () => {
  // -------------------------------------------------------------------------
  console.log('\n=== Building the DocumentReference ===');

  await test('the resource carries the notice body and a matching hash', () => {
    const db = makeDb();
    const notice = seedNotice(db);
    const r = cf.buildDocumentReference(notice, { epicPatientId: EPIC_ID });

    assert.strictEqual(r.resourceType, 'DocumentReference');
    assert.strictEqual(r.subject.reference, `Patient/${EPIC_ID}`);
    const decoded = Buffer.from(r.content[0].attachment.data, 'base64').toString('utf8');
    assert.strictEqual(decoded, notice.content);
    const hashB64 = Buffer.from(
      createHash('sha256').update(notice.content, 'utf8').digest('hex'), 'hex',
    ).toString('base64');
    assert.strictEqual(r.content[0].attachment.hash, hashB64);
    db.close();
  });

  await test('the idempotency key travels with the document for reconciliation', () => {
    const db = makeDb();
    const notice = seedNotice(db);
    const r = cf.buildDocumentReference(notice, { epicPatientId: EPIC_ID });
    assert.strictEqual(r.identifier[0].value, notice.idempotency_key);
    db.close();
  });

  await test('a body that no longer matches its recorded hash is refused', () => {
    const db = makeDb();
    const notice = seedNotice(db);
    assert.throws(
      () => cf.buildDocumentReference(
        { ...notice, content: `${notice.content}\n\nAppended after filing.` },
        { epicPatientId: EPIC_ID },
      ),
      /does not match its recorded hash/,
    );
    db.close();
  });

  await test('a missing Epic patient id is refused rather than guessed', () => {
    const db = makeDb();
    const notice = seedNotice(db);
    assert.throws(() => cf.buildDocumentReference(notice, {}), /epicPatientId is required/);
    db.close();
  });

  await test('validation names the specific structural problem', () => {
    const bad = { resourceType: 'DocumentReference', status: 'current', content: [] };
    const v = cf.validateDocumentReference(bad);
    assert.strictEqual(v.ok, false);
    assert.ok(v.problems.some((p) => /subject/.test(p)));
    assert.ok(v.problems.some((p) => /document type coding/.test(p)));
    db_noop();
  });

  // -------------------------------------------------------------------------
  console.log('\n=== Dry run ===');

  await test('a dry run produces a valid resource and sends nothing', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    let sendCalls = 0;

    const result = await svc.fileToChart(db, ORG, notice.id, {
      mode: 'dry_run',
      epicPatientId: EPIC_ID,
      submit: async () => { sendCalls++; return { id: 'should-not-happen' }; },
    });

    assert.strictEqual(sendCalls, 0, 'a dry run must not call the transport');
    assert.strictEqual(result.outcome.status, 'dry_run');
    assert.strictEqual(result.preview.validation.ok, true);
    assert.strictEqual(result.notice.chart_write_status, 'dry_run');
    db.close();
  });

  await test('a dry run leaves the obligation open rather than marking it filed', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    await svc.fileToChart(db, ORG, notice.id, { mode: 'dry_run', epicPatientId: EPIC_ID });
    const s = svc.getComplianceSummary(db, ORG);
    assert.strictEqual(s.notFiledToChart, 1);
    db.close();
  });

  // -------------------------------------------------------------------------
  console.log('\n=== Live filing requires an explicit transport ===');

  await test('live filing without a transport is refused', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    await assert.rejects(
      () => svc.fileToChart(db, ORG, notice.id, {
        mode: 'fhir_documentreference', epicPatientId: EPIC_ID,
      }),
      /requires a submit transport/,
    );
    db.close();
  });

  await test('a successful create records the Epic document id', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    let sent = null;

    const result = await svc.fileToChart(db, ORG, notice.id, {
      mode: 'fhir_documentreference',
      epicPatientId: EPIC_ID,
      submit: async (resource) => { sent = resource; return { id: 'DocRef-9912' }; },
    });

    assert.strictEqual(result.outcome.status, 'filed');
    assert.strictEqual(result.outcome.documentReferenceId, 'DocRef-9912');
    assert.strictEqual(result.notice.chart_write_channel, 'fhir_documentreference');
    assert.strictEqual(sent.resourceType, 'DocumentReference');
    db.close();
  });

  await test('a rejected create is recorded with its reason, not swallowed', async () => {
    const db = makeDb();
    const notice = seedNotice(db);

    const result = await svc.fileToChart(db, ORG, notice.id, {
      mode: 'fhir_documentreference',
      epicPatientId: EPIC_ID,
      submit: async () => { throw new Error('Epic FHIR create failed (403)'); },
    });

    assert.strictEqual(result.outcome.status, 'failed');
    assert.match(result.outcome.error, /403/);
    assert.strictEqual(svc.getComplianceSummary(db, ORG).chartFilingFailed, 1);
    db.close();
  });

  await test('a failed filing can be retried', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    await svc.fileToChart(db, ORG, notice.id, {
      mode: 'fhir_documentreference', epicPatientId: EPIC_ID,
      submit: async () => { throw new Error('transient'); },
    });
    const retry = await svc.fileToChart(db, ORG, notice.id, {
      mode: 'fhir_documentreference', epicPatientId: EPIC_ID,
      submit: async () => ({ id: 'DocRef-2' }),
    });
    assert.strictEqual(retry.outcome.status, 'filed');
    db.close();
  });

  await test('a notice already filed is not filed a second time', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    await svc.fileToChart(db, ORG, notice.id, {
      mode: 'fhir_documentreference', epicPatientId: EPIC_ID,
      submit: async () => ({ id: 'DocRef-1' }),
    });
    await assert.rejects(
      () => svc.fileToChart(db, ORG, notice.id, {
        mode: 'fhir_documentreference', epicPatientId: EPIC_ID,
        submit: async () => ({ id: 'DocRef-DUPLICATE' }),
      }),
      /already filed/,
    );
    db.close();
  });

  // -------------------------------------------------------------------------
  console.log('\n=== Manual filing ===');

  await test('a site without write access can record a manual filing', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    const result = await svc.fileToChart(db, ORG, notice.id, { mode: 'manual' });
    assert.strictEqual(result.outcome.status, 'filed');
    assert.strictEqual(result.outcome.channel, 'manual');
    assert.strictEqual(svc.getComplianceSummary(db, ORG).notFiledToChart, 0);
    db.close();
  });

  await test('an unknown mode is refused', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    await assert.rejects(
      () => svc.fileToChart(db, ORG, notice.id, { mode: 'fax-it' }),
      /unknown mode/,
    );
    db.close();
  });

  await test('another organization cannot file this centre\'s notice', async () => {
    const db = makeDb();
    const notice = seedNotice(db);
    db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').run('org-x', 'Other');
    await assert.rejects(
      () => svc.fileToChart(db, 'org-x', notice.id, { mode: 'manual' }),
      /not found/i,
    );
    db.close();
  });

  // -------------------------------------------------------------------------
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  if (FAIL > 0) {
    for (const f of failures) console.error(`\n${f.name}\n${f.error.stack}`);
    process.exit(1);
  }
};

function db_noop() { /* the validation test needs no database */ }

run();
