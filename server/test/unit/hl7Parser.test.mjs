import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { parseMessage, buildAck } = require('../../../electron/services/hl7v2.cjs');

describe('hl7v2 (re-used by server)', () => {
  it('parses ADT^A04 and surfaces patient', () => {
    const msg = [
      'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||ADT^A04|MSG0001|P|2.5',
      'EVN|A04|20260101120000',
      'PID|1||MRN12345^^^HOSP^MR||DOE^JANE^Q^^^||19800101|F||2106-3|123 MAIN ST^^TOWN^ST^12345||555-1212|||S|||111-22-3333',
      'PV1|1|O|CLINIC^^^|',
    ].join('\r');
    const out = parseMessage(msg);
    expect(out.message_type).toBe('ADT');
    expect(out.trigger_event).toBe('A04');
    expect(out.supported).toBe(true);
    expect(out.patient.mrn).toBe('MRN12345');
    expect(out.patient.last_name).toBe('DOE');
    expect(out.patient.first_name).toBe('JANE');
    expect(out.patient.date_of_birth).toBe('1980-01-01');
  });

  it('parses ORU^R01 with multiple OBX', () => {
    const msg = [
      'MSH|^~\\&|LAB|HOSP|TT|TT|20260101120000||ORU^R01|MSG0002|P|2.5',
      'PID|1||MRN12345^^^HOSP^MR||DOE^JANE',
      'OBR|1|ORDER1||CHEM7^Chem 7^L|||20260101120000|||',
      'OBX|1|NM|2160-0^Creatinine^LN||1.1|mg/dL|0.7-1.3||||F|||20260101120000',
      'OBX|2|NM|2823-3^Potassium^LN||4.2|mmol/L|3.5-5.0||||F|||20260101120000',
    ].join('\r');
    const out = parseMessage(msg);
    expect(out.observations).toHaveLength(2);
    expect(out.observations[0].test_code).toBe('2160-0');
    expect(out.observations[0].value).toBe('1.1');
    expect(out.observations[1].test_code).toBe('2823-3');
  });

  it('builds AA ACK', () => {
    const ack = buildAck({ message_control_id: 'X1' }, 'AA', '');
    expect(ack).toMatch(/^MSH\|/);
    expect(ack).toMatch(/MSA\|AA\|X1/);
  });
});
