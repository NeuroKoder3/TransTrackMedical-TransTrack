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
    -- verify_tls mirrors migration 10: TLS peer-cert verification ON by
    -- default, can be opted out per destination by an admin.
    verify_tls INTEGER NOT NULL DEFAULT 1,
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

test('CEF includes header + extension fields', () => {
  const out = siem.toCef(sample);
  assert.ok(out.startsWith('CEF:0|TransTrack|TransTrack|1.0|'));
  assert.ok(out.includes('act=login'));
  assert.ok(out.includes('suser=admin@example.com'));
  assert.ok(out.includes('cs1Label=org_id'));
  assert.ok(out.includes('cs1=ORG1'));
});

test('CEF escapes "=" and "\\" in values', () => {
  const out = siem.toCef({ ...sample, details: 'a=b\\c\nlinebreak' });
  assert.ok(out.includes('msg=a\\=b\\\\c linebreak'));
  assert.ok(!/\n/.test(out));
});

test('JSON formatter emits valid JSON with parsed details', () => {
  const out = siem.toJson({ ...sample, details: '{"k":1}' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.action, 'login');
  assert.deepStrictEqual(parsed.details, { k: 1 });
});

test('RFC5424 syslog formatter uses correct PRI and structured data', () => {
  const out = siem.toRfc5424(sample);
  assert.ok(out.startsWith('<14>1 '));
  assert.ok(out.includes('transtrack'));
  assert.ok(out.includes('[transtrack@53914 org="ORG1"'));
});

test('RFC5424 SD escapes ALL special chars (\\, ", ]) per RFC 5424 §6.3.3', () => {
  // Hostile attacker controls org_id via an injected user. They try to
  // break out of the SD value to inject extra structured-data params.
  const out = siem.toRfc5424({
    ...sample,
    org_id: 'a]b"c\\d',
    user_email: 'x"y]z',
    entity_type: 'E\\F',
    entity_id: 'I"d',
  });
  // Each of '\', '"', ']' inside a PARAM-VALUE must be preceded by '\'.
  assert.ok(out.includes('org="a\\]b\\"c\\\\d"'),
    `org param not escaped correctly: ${out}`);
  assert.ok(out.includes('user="x\\"y\\]z"'),
    `user param not escaped correctly: ${out}`);
  assert.ok(out.includes('entity="E\\\\F"'),
    `entity param not escaped correctly: ${out}`);
  assert.ok(out.includes('id="I\\"d"'),
    `id param not escaped correctly: ${out}`);
  // The SD block must close exactly once, at the end of the SD section,
  // before the free-form MSG. Every ']' the attacker tried to inject
  // inside a PARAM-VALUE must be escaped as '\]'. We count "unescaped ]"
  // as those not preceded by a backslash.
  const unescaped = (out.match(/(?<!\\)\]/g) || []).length;
  assert.strictEqual(
    unescaped,
    1,
    `SD must contain exactly one unescaped ']' that terminates the SD: ${out}`,
  );
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
