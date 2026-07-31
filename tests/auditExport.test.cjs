/**
 * TransTrack — audit trail inspection export tests.
 *
 * 21 CFR 11.10(b) requires accurate and complete copies of records in both
 * human-readable and electronic form suitable for inspection. These tests cover
 * electron/services/auditExport.cjs:
 *
 *   • completeness — every record and column reaches the output
 *   • before/after rendering — 11.10(e) requires changes not obscure prior values
 *   • CSV injection defence — audit content must never execute in a spreadsheet
 *   • HTML escaping — audit content must never execute in a browser
 *   • de-identification — patient identifiers can be withheld
 *   • integrity statement — the chain verdict is carried into the export
 *
 * Run standalone: node tests/auditExport.test.cjs
 */

'use strict';

const assert = require('assert');

const auditExport = require('../electron/services/auditExport.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

function makeReport(entries) {
  return {
    report_type: 'HIPAA_AUDIT_TRAIL',
    generated_at: '2026-07-30T12:00:00.000Z',
    organization_id: 'ORG-1',
    organization_name: 'General Transplant Center',
    period: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-30T12:00:00.000Z' },
    summary: {
      total_entries: entries.length,
      by_action: { update: 1, view: 1 },
      by_entity_type: { Patient: 2 },
      by_user: { 'coordinator@example.org': 2 },
      by_outcome: { SUCCESS: 2, FAILURE: 0, UNKNOWN: 0 },
    },
    entries,
  };
}

const SAMPLE_ENTRIES = [
  {
    id: 'a1',
    created_at: '2026-07-30T11:00:00.000Z',
    user_email: 'coordinator@example.org',
    user_role: 'coordinator',
    action: 'update',
    entity_type: 'Patient',
    entity_id: 'p-1',
    patient_name: 'Lopez, Camila',
    outcome: 'SUCCESS',
    access_justification: 'treatment',
    details: JSON.stringify({
      message: 'Patient updated',
      before: { medical_urgency: 'STATUS_2', meld_score: 18 },
      after: { medical_urgency: 'STATUS_1A', meld_score: 31 },
    }),
    request_id: 'req-1',
    record_hash: 'a'.repeat(64),
  },
  {
    id: 'a2',
    created_at: '2026-07-30T11:05:00.000Z',
    user_email: 'coordinator@example.org',
    user_role: 'coordinator',
    action: 'view',
    entity_type: 'Patient',
    entity_id: 'p-1',
    patient_name: 'Lopez, Camila',
    outcome: 'SUCCESS',
    access_justification: null,
    details: 'Patient record viewed',
    request_id: 'req-2',
    record_hash: 'b'.repeat(64),
  },
];

console.log('\n=== CSV export ===');

test('emits a header row plus one row per record', () => {
  const csv = auditExport.toCsv(makeReport(SAMPLE_ENTRIES));
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines.length, 3, 'header + 2 records');
  assert.ok(lines[0].includes('Timestamp (UTC)'));
  assert.ok(lines[0].includes('Record Hash'));
});

test('includes every expected column', () => {
  const csv = auditExport.toCsv(makeReport(SAMPLE_ENTRIES));
  const header = csv.split('\r\n')[0];
  for (const col of auditExport.EXPORT_COLUMNS) {
    assert.ok(header.includes(col.label), `missing column: ${col.label}`);
  }
});

test('renders before/after values instead of raw JSON', () => {
  const csv = auditExport.toCsv(makeReport(SAMPLE_ENTRIES));
  // Part 11.10(e): the previous value must remain legible.
  assert.ok(csv.includes('STATUS_2'), 'previous value must be present');
  assert.ok(csv.includes('STATUS_1A'), 'new value must be present');
  assert.ok(csv.includes('->'), 'change must be rendered as a transition');
  assert.ok(!csv.includes('"before":'), 'must not dump raw JSON keys');
});

test('quotes and escapes fields containing commas, quotes, and newlines', () => {
  const csv = auditExport.toCsv(makeReport([{
    ...SAMPLE_ENTRIES[1],
    details: 'Note with, comma and "quotes"\nand a newline',
  }]));
  const dataLine = csv.split('\r\n').slice(1).join('\r\n');
  assert.ok(dataLine.includes('""quotes""'), 'internal quotes must be doubled');
  assert.ok(/"Note with, comma/.test(dataLine), 'field must be quoted');
});

test('neutralizes CSV formula injection', () => {
  // An attacker who can influence an audited value must not get code execution
  // when the inspection copy is opened in Excel or Google Sheets.
  const dangerous = ['=cmd|\'/c calc\'!A1', '+1+1', '-1+1', '@SUM(A1)'];
  for (const payload of dangerous) {
    const escaped = auditExport.csvEscape(payload);
    assert.ok(
      escaped.startsWith("'") || escaped.startsWith('"\''),
      `formula "${payload}" must be prefixed, got ${escaped}`
    );
  }
});

test('renders empty strings for null and undefined', () => {
  assert.strictEqual(auditExport.csvEscape(null), '');
  assert.strictEqual(auditExport.csvEscape(undefined), '');
});

test('withholds patient identifiers when requested', () => {
  const csv = auditExport.toCsv(makeReport(SAMPLE_ENTRIES), { includePatientName: false });
  assert.ok(!csv.includes('Lopez, Camila'), 'patient name must be withheld');
  assert.ok(!csv.includes('Patient"') || !csv.split('\r\n')[0].includes('Patient,'), 'PHI column omitted');
  // Non-PHI content must still be present.
  assert.ok(csv.includes('coordinator@example.org'));
  assert.ok(csv.includes('STATUS_1A'));
});

test('includes patient identifiers by default', () => {
  const csv = auditExport.toCsv(makeReport(SAMPLE_ENTRIES));
  assert.ok(csv.includes('Lopez, Camila'));
});

test('handles an empty report', () => {
  const csv = auditExport.toCsv(makeReport([]));
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines.length, 1, 'header only');
});

console.log('\n=== HTML export ===');

test('produces a self-contained document with no external references', () => {
  const html = auditExport.toHtml(makeReport(SAMPLE_ENTRIES));
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!/<script/i.test(html), 'must contain no scripts');
  assert.ok(!/src\s*=\s*["']http/i.test(html), 'must not load remote assets');
  assert.ok(!/<link/i.test(html), 'must not link external stylesheets');
});

test('carries the report metadata', () => {
  const html = auditExport.toHtml(makeReport(SAMPLE_ENTRIES));
  assert.ok(html.includes('General Transplant Center'));
  assert.ok(html.includes('ORG-1'));
  assert.ok(html.includes('2026-07-01T00:00:00.000Z'));
  assert.ok(html.includes(auditExport.REPORT_TITLE));
});

test('renders one table row per record', () => {
  const html = auditExport.toHtml(makeReport(SAMPLE_ENTRIES));
  const bodyRows = (html.match(/<tr><td/g) || []).length;
  assert.strictEqual(bodyRows, 2);
});

test('escapes HTML so audit content cannot execute', () => {
  const html = auditExport.toHtml(makeReport([{
    ...SAMPLE_ENTRIES[1],
    patient_name: '<img src=x onerror=alert(1)>',
    details: '<script>steal()</script>',
  }]));
  assert.ok(!html.includes('<script>steal()'), 'script tag must be escaped');
  assert.ok(!html.includes('<img src=x'), 'img tag must be escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'must contain the escaped form');
});

test('htmlEscape covers all five entities', () => {
  assert.strictEqual(
    auditExport.htmlEscape(`<a href="x">&'</a>`),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'
  );
});

test('states that the chain verified when it did', () => {
  const html = auditExport.toHtml(makeReport(SAMPLE_ENTRIES), {
    chainVerification: { ok: true, verified: 2, hmac: { checked: 2, unverifiable: 0, available: true } },
  });
  assert.ok(/Integrity verified/.test(html));
  assert.ok(html.includes('2 records replayed'));
  assert.ok(/HMAC-verified/.test(html));
});

test('warns prominently when the chain failed', () => {
  const html = auditExport.toHtml(makeReport(SAMPLE_ENTRIES), {
    chainVerification: { ok: false, brokenAt: 'a1', failure: 'hmac', verified: 0 },
  });
  assert.ok(/INTEGRITY WARNING/.test(html), 'must warn');
  assert.ok(html.includes('a1'), 'must identify the broken record');
  assert.ok(html.includes('chain broken'), 'must apply the alert style');
});

test('labels the PHI status of the document', () => {
  const withPhi = auditExport.toHtml(makeReport(SAMPLE_ENTRIES));
  assert.ok(/contains Protected Health Information/.test(withPhi));

  const withoutPhi = auditExport.toHtml(makeReport(SAMPLE_ENTRIES), { includePatientName: false });
  assert.ok(/identifiers have been withheld/.test(withoutPhi));
  assert.ok(!withoutPhi.includes('Lopez, Camila'));
});

test('renders the summary counts', () => {
  const html = auditExport.toHtml(makeReport(SAMPLE_ENTRIES));
  assert.ok(html.includes('Actions'));
  assert.ok(html.includes('coordinator@example.org'));
});

console.log('\n=== formatDetails ===');

test('passes through plain-text details unchanged', () => {
  assert.strictEqual(auditExport.formatDetails('Patient record viewed'), 'Patient record viewed');
});

test('returns an empty string for no details', () => {
  assert.strictEqual(auditExport.formatDetails(null), '');
  assert.strictEqual(auditExport.formatDetails(undefined), '');
});

test('renders a message-only JSON payload as its message', () => {
  assert.strictEqual(
    auditExport.formatDetails(JSON.stringify({ message: 'User deactivated' })),
    'User deactivated'
  );
});

test('shows a field added where there was no previous value', () => {
  const rendered = auditExport.formatDetails(JSON.stringify({
    message: 'Patient updated',
    before: {},
    after: { notes: 'new note' },
  }));
  assert.ok(rendered.includes('notes: "" -> "new note"'), rendered);
});

test('shows a field cleared where there was a previous value', () => {
  const rendered = auditExport.formatDetails(JSON.stringify({
    message: 'Patient updated',
    before: { notes: 'old note' },
    after: { notes: null },
  }));
  assert.ok(rendered.includes('notes: "old note" -> ""'), rendered);
});

test('renders every changed field', () => {
  const rendered = auditExport.formatDetails(JSON.stringify({
    before: { a: 1, b: 2, c: 3 },
    after: { a: 9, b: 8, c: 7 },
  }));
  for (const fragment of ['a: "1" -> "9"', 'b: "2" -> "8"', 'c: "3" -> "7"']) {
    assert.ok(rendered.includes(fragment), `missing ${fragment} in ${rendered}`);
  }
});

test('falls back to the raw string on malformed JSON', () => {
  assert.strictEqual(auditExport.formatDetails('{not valid json'), '{not valid json');
});

console.log('\n=== buildInspectionPackage ===');

test('returns json, csv, and html together with a filename base', () => {
  const pkg = auditExport.buildInspectionPackage(makeReport(SAMPLE_ENTRIES));
  assert.ok(pkg.json && pkg.json.entries.length === 2);
  assert.ok(typeof pkg.csv === 'string' && pkg.csv.includes('Timestamp'));
  assert.ok(typeof pkg.html === 'string' && pkg.html.startsWith('<!DOCTYPE html>'));
  assert.ok(/^transtrack-audit-ORG-1-/.test(pkg.filenameBase), pkg.filenameBase);
  assert.ok(!/[:.]/.test(pkg.filenameBase.replace('transtrack-audit-ORG-1-', '')), 'filename must be filesystem-safe');
});

test('the electronic and human-readable copies describe the same records', () => {
  const pkg = auditExport.buildInspectionPackage(makeReport(SAMPLE_ENTRIES));
  const csvRows = pkg.csv.trim().split('\r\n').length - 1;
  const htmlRows = (pkg.html.match(/<tr><td/g) || []).length;
  assert.strictEqual(csvRows, pkg.json.entries.length, 'CSV must be complete');
  assert.strictEqual(htmlRows, pkg.json.entries.length, 'HTML must be complete');
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
