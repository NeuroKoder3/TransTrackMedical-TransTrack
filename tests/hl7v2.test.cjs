/**
 * TransTrack — HL7 v2 parser unit tests.
 * Run with: node tests/hl7v2.test.cjs
 */

'use strict';

const assert = require('assert');
const hl7 = require('../electron/services/hl7v2.cjs');

let PASS = 0;
let FAIL = 0;
const failures = [];

function test(name, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${name}`); }
  catch (e) {
    FAIL++;
    failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

function msg(...lines) { return lines.join('\r'); }

const ADT_A04 = msg(
  'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||ADT^A04|MSG00001|P|2.5',
  'EVN|A04|20260101120000',
  'PID|1||MRN001234^^^HOSP^MR||DOE^JOHN^Q||19800101|M|||123 MAIN ST^^CITY^ST^00000^USA||(555)123-4567',
  'PV1|1|O|CLINIC^^^HOSP'
);

const ORU_R01 = msg(
  'MSH|^~\\&|LIS|LAB|TT|TT|20260102083015||ORU^R01|LAB99|P|2.5',
  'PID|1||MRN001234^^^HOSP^MR||DOE^JANE',
  'OBR|1|ORD123^LIS|FIL456^LIS|CBC^Complete Blood Count^L|||20260102081500',
  'OBX|1|NM|HGB^Hemoglobin^LN||13.7|g/dL|12.0-16.0|N|||F|||20260102083000',
  'OBX|2|NM|WBC^White Blood Cell^LN||7.4|10*3/uL|4.0-11.0|N|||F|||20260102083000'
);

console.log('\n=== ADT^A04 ===');

test('parses MSH metadata', () => {
  const r = hl7.parseMessage(ADT_A04);
  assert.strictEqual(r.message_type, 'ADT');
  assert.strictEqual(r.trigger_event, 'A04');
  assert.strictEqual(r.message_control_id, 'MSG00001');
  assert.strictEqual(r.supported, true);
});

test('parses PID demographics', () => {
  const r = hl7.parseMessage(ADT_A04);
  assert.ok(r.patient);
  assert.strictEqual(r.patient.last_name, 'DOE');
  assert.strictEqual(r.patient.first_name, 'JOHN');
  assert.strictEqual(r.patient.middle_name, 'Q');
  assert.strictEqual(r.patient.date_of_birth, '1980-01-01');
  assert.strictEqual(r.patient.sex, 'M');
  assert.strictEqual(r.patient.mrn, 'MRN001234');
});

test('parses PV1 visit', () => {
  const r = hl7.parseMessage(ADT_A04);
  assert.ok(r.visit);
  assert.strictEqual(r.visit.patient_class, 'O');
});

console.log('\n=== ORU^R01 ===');

test('parses ORU^R01 with multiple OBX observations', () => {
  const r = hl7.parseMessage(ORU_R01);
  assert.strictEqual(r.message_type, 'ORU');
  assert.strictEqual(r.trigger_event, 'R01');
  assert.strictEqual(r.observations.length, 2);
  const hgb = r.observations[0];
  assert.strictEqual(hgb.test_code, 'HGB');
  assert.strictEqual(hgb.value, '13.7');
  assert.strictEqual(hgb.unit, 'g/dL');
  assert.strictEqual(hgb.result_status, 'F');
});

test('parses OBR order info', () => {
  const r = hl7.parseMessage(ORU_R01);
  assert.strictEqual(r.orders.length, 1);
  assert.strictEqual(r.orders[0].test_code, 'CBC');
});

console.log('\n=== Negative / edge cases ===');

test('throws on missing MSH', () => {
  assert.throws(() => hl7.parseMessage('PID|1||X'));
});

test('marks unsupported event with warning', () => {
  const m = msg(
    'MSH|^~\\&|S|F|TT|TT|20260101120000||ADT^A99|MSGX|P|2.5',
    'PID|1||MRN^^^H^MR||LAST^FIRST'
  );
  const r = hl7.parseMessage(m);
  assert.strictEqual(r.supported, false);
  assert.ok(r.warnings.length > 0);
});

test('builds an AA ACK with the original control id', () => {
  const ack = hl7.buildAck({ message_control_id: 'MSG00001' }, 'AA', '');
  assert.ok(/MSA\|AA\|MSG00001/.test(ack));
});

test('handles \\r\\n line endings', () => {
  const m = ADT_A04.replace(/\r/g, '\r\n');
  const r = hl7.parseMessage(m);
  assert.strictEqual(r.patient.last_name, 'DOE');
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
