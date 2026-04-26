import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { parseMessage } = require('../../src/hl7/messageParser.js');
const messageTypes = require('../../src/hl7/messageTypes.js');

describe('HL7 extended message types', () => {
  it('recognises ADT^A40 merge messages', () => {
    const msg = [
      'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||ADT^A40|MSG40|P|2.5',
      'EVN|A40|20260101120000',
      'PID|1||MRN_NEW^^^HOSP^MR||DOE^JANE',
      'MRG|MRN_OLD^^^HOSP^MR',
    ].join('\r');
    const out = parseMessage(msg);
    expect(out.message_type).toBe('ADT');
    expect(out.trigger_event).toBe('A40');
    expect(out.supported).toBe(true);
    expect(out.category).toBe('admin');
    expect(out.extended.merge_info?.prior_patient_identifier_list).toBe('MRN_OLD');
  });

  it('parses MDM^T02 documents into TXA', () => {
    const msg = [
      'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||MDM^T02|MSGMDM|P|2.5',
      'EVN|T02|20260101120000',
      'PID|1||MRN1^^^HOSP^MR||DOE^JANE',
      'TXA|1|CN|TX|20260101||DR^SMITH^J||20260101120000|||TRANS|DOC123|||||CO|F|A',
      'OBX|1|TX|||This is the discharge summary.',
    ].join('\r');
    const out = parseMessage(msg);
    expect(out.category).toBe('document');
    expect(out.extended.document?.document_type).toBe('CN');
    expect(out.extended.document?.unique_document_number).toBe('DOC123');
  });

  it('parses SIU^S12 appointment notification', () => {
    const msg = [
      'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||SIU^S12|MSGSIU|P|2.5',
      'SCH|APPT001||||||||30',
      'PID|1||MRN1^^^HOSP^MR||DOE^JANE',
    ].join('\r');
    const out = parseMessage(msg);
    expect(out.category).toBe('schedule');
    expect(out.extended.schedule?.placer_appointment_id).toBe('APPT001');
    expect(out.extended.schedule?.duration_minutes).toBe('30');
  });

  it('parses BAR^P01 with FT1 segments', () => {
    const msg = [
      'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||DFT^P03|MSGDFT|P|2.5',
      'EVN|P03|20260101120000',
      'PID|1||MRN1^^^HOSP^MR||DOE^JANE',
      'PV1|1|O|CLINIC',
      'FT1|1|TXN001|||20260101|20260101120000|CG|99213^Office Visit|1|150.00',
    ].join('\r');
    const out = parseMessage(msg);
    expect(out.category).toBe('financial');
    expect(out.extended.financial_transactions).toHaveLength(1);
    expect(out.extended.financial_transactions[0].transaction_amount).toBe('150.00');
  });

  it('captures unknown Z-segments without failing', () => {
    const msg = [
      'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||ADT^A04|MSGZ|P|2.5',
      'EVN|A04|20260101120000',
      'PID|1||MRN1^^^HOSP^MR||DOE^JANE',
      'ZQQ|alpha|beta|gamma',
    ].join('\r');
    const out = parseMessage(msg);
    expect(out.z_segments._other).toHaveLength(1);
    expect(out.z_segments._other[0].name).toBe('ZQQ');
  });

  it('exposes a comprehensive supported-types list', () => {
    const list = messageTypes.listSupported();
    expect(list).toContain('ADT^A40');
    expect(list).toContain('MDM^T01');
    expect(list).toContain('SIU^S12');
    expect(list).toContain('ORM^O01');
    expect(list).toContain('RDE^O11');
    expect(list).toContain('BAR^P01');
    expect(list).toContain('DFT^P03');
    expect(list).toContain('MFN^M02');
    expect(list.length).toBeGreaterThanOrEqual(25);
  });
});
