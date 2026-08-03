/**
 * TransTrack — SIEM forwarder formatter tests.
 * Pure formatting tests; no socket I/O.
 *
 * Run with: node tests/siemForwarder.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');
const initModule = require('../electron/database/init.cjs');

// Build a minimal in-memory db so the module's lazy `getDatabase()` works
// even though formatter tests don't need it.
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE siem_destinations (
    id TEXT PRIMARY KEY, org_id TEXT, name TEXT, host TEXT, port INTEGER,
    protocol TEXT, format TEXT, enabled INTEGER, severity_filter TEXT,
    last_success_at TEXT, last_failure_at TEXT, last_failure_reason TEXT,
    dropped_count INTEGER DEFAULT 0, created_by TEXT,
    created_at TEXT, updated_at TEXT
  );
`);
initModule.getDatabase = () => db;

const siem = require('../electron/services/siemForwarder.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

const sample = {
  org_id: 'ORG1',
  user_email: 'admin@example.com',
  user_role: 'admin',
  action: 'login',
  entity_type: 'User',
  entity_id: 'U1',
  patient_name: null,
  details: 'logged in',
  request_id: 'req-1',
  created_at: '2026-04-23T12:00:00.000Z',
};

console.log('\n=== Formatters ===');

test('CEF includes header + extension fields (after redaction)', () => {
  const out = siem.toCef(sample);
  assert.ok(out.startsWith('CEF:0|TransTrack|TransTrack|'), `CEF header missing, got: ${out.slice(0, 60)}`);
  assert.ok(out.includes('act=login'));
  // The workforce identifier is pseudonymised by default (finding L-10), so
  // suser carries the stable pseudonym rather than the mailbox address.
  assert.ok(/suser=wf-[a-f0-9]{32}\b/.test(out), `expected a pseudonymous suser, got: ${out}`);
  assert.ok(!out.includes('admin@example.com'), 'raw workforce address must not be forwarded by default');
  assert.ok(out.includes('cs1Label=org_id'));
  assert.ok(out.includes('cs1=ORG1'));
  assert.ok(!out.includes('patient_name'), 'PHI must be redacted');
});

console.log('\n=== Workforce identifier (L-10) ===');

test('the default mode is pseudonymous and stable across calls', () => {
  delete process.env.TRANSTRACK_SIEM_WORKFORCE_ID;
  assert.strictEqual(siem.getWorkforceIdMode(), 'pseudonymous');
  const first = siem.workforceIdentifier('admin@example.com');
  const second = siem.workforceIdentifier('ADMIN@Example.com ');
  assert.match(first, /^wf-[a-f0-9]{32}$/);
  assert.strictEqual(first, second, 'the pseudonym must be case/whitespace stable so a SIEM can correlate');
  assert.notStrictEqual(first, siem.workforceIdentifier('other@example.com'));
});

test('an unrecognised mode falls back to pseudonymous, never to raw', () => {
  process.env.TRANSTRACK_SIEM_WORKFORCE_ID = 'RAWW';
  try {
    assert.strictEqual(siem.getWorkforceIdMode(), 'pseudonymous');
    assert.ok(!siem.toJson(sample).includes('admin@example.com'));
  } finally {
    delete process.env.TRANSTRACK_SIEM_WORKFORCE_ID;
  }
});

test('every formatter withholds the address unless raw is opted into', () => {
  for (const format of ['cef', 'json', 'rfc5424']) {
    assert.ok(
      !siem.formatRecord(sample, format).includes('admin@example.com'),
      `${format} leaked the workforce address`
    );
  }
});

test('omit mode forwards no workforce identifier at all', () => {
  process.env.TRANSTRACK_SIEM_WORKFORCE_ID = 'omit';
  try {
    const parsed = JSON.parse(siem.toJson(sample));
    assert.strictEqual(parsed.user_id, null);
    assert.strictEqual(parsed.user_email, undefined);
    assert.ok(siem.toCef(sample).includes('suser= '));
  } finally {
    delete process.env.TRANSTRACK_SIEM_WORKFORCE_ID;
  }
});

test('raw mode is honoured when the deployment explicitly opts in', () => {
  process.env.TRANSTRACK_SIEM_WORKFORCE_ID = 'raw';
  try {
    assert.ok(siem.toCef(sample).includes('suser=admin@example.com'));
    const parsed = JSON.parse(siem.toJson(sample));
    assert.strictEqual(parsed.user_id, 'admin@example.com');
    assert.strictEqual(parsed.user_email, 'admin@example.com');
    assert.ok(siem.toRfc5424(sample).includes('user="admin@example.com"'));
  } finally {
    delete process.env.TRANSTRACK_SIEM_WORKFORCE_ID;
  }
});

console.log('\n=== Formatters (continued) ===');

test('CEF escapes special chars in redacted details', () => {
  const out = siem.toCef({ ...sample, details: 'a=b\\c\nlinebreak' });
  assert.ok(!/\n/.test(out), 'Newlines must be stripped from CEF output');
});

test('JSON formatter emits valid JSON with redacted details', () => {
  const out = siem.toJson({ ...sample, details: '{"k":1}' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.action, 'login');
  assert.strictEqual(typeof parsed.details, 'string', 'Details must be redacted to a string');
  assert.ok(!parsed.patient_name, 'patient_name must not appear in JSON output');
});

test('RFC5424 syslog formatter uses correct PRI and structured data', () => {
  const out = siem.toRfc5424(sample);
  assert.ok(out.startsWith('<14>1 '));
  assert.ok(out.includes('transtrack'));
  assert.ok(out.includes('[transtrack@53914 org="ORG1"'));
});

test('formatRecord dispatches by format', () => {
  assert.ok(siem.formatRecord(sample, 'cef').startsWith('CEF:0|'));
  assert.ok(siem.formatRecord(sample, 'json').startsWith('{'));
  assert.ok(siem.formatRecord(sample, 'rfc5424').startsWith('<'));
});

test('mapSeverity boosts critical actions', () => {
  assert.ok(siem.mapSeverity('login_failed') >= 8);
  assert.ok(siem.mapSeverity('breach_notification') >= 8);
  assert.strictEqual(siem.mapSeverity('login'), 3);
  assert.strictEqual(siem.mapSeverity('update'), 4);
});

console.log('\n=== CRUD ===');

test('createDestination + listDestinations + getDestination', () => {
  const created = siem.createDestination({
    orgId: 'ORG1', name: 'splunk', host: '127.0.0.1', port: 514,
    protocol: 'udp', format: 'cef',
  });
  assert.ok(created.id);
  const list = siem.listDestinations('ORG1');
  assert.ok(list.find(d => d.id === created.id));
  const got = siem.getDestination(created.id, 'ORG1');
  assert.strictEqual(got.name, 'splunk');
});

test('createDestination rejects bad protocol/format/port', () => {
  assert.throws(() => siem.createDestination({ orgId: 'ORG1', name: 'x', host: 'h', port: 514, protocol: 'icmp' }));
  assert.throws(() => siem.createDestination({ orgId: 'ORG1', name: 'x', host: 'h', port: 514, format: 'msgpack' }));
  assert.throws(() => siem.createDestination({ orgId: 'ORG1', name: 'x', host: 'h', port: 99999 }));
});

test('updateDestination updates allowed fields', () => {
  const created = siem.createDestination({ orgId: 'ORG1', name: 'qradar', host: 'h', port: 514 });
  const updated = siem.updateDestination({ id: created.id, orgId: 'ORG1', fields: { enabled: false, format: 'json' } });
  assert.strictEqual(updated.enabled, 0);
  assert.strictEqual(updated.format, 'json');
});

test('deleteDestination removes the row', () => {
  const created = siem.createDestination({ orgId: 'ORG1', name: 'rm', host: 'h', port: 514 });
  const r = siem.deleteDestination(created.id, 'ORG1');
  assert.strictEqual(r.deleted, true);
  assert.strictEqual(siem.getDestination(created.id, 'ORG1'), undefined);
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
