/**
 * Minimal, dependency-free HL7 v2.x parser.
 *
 * Per SRS TT-R070. Supports parsing of:
 *   - ADT^A01  (admit)
 *   - ADT^A03  (discharge)
 *   - ADT^A04  (registration)
 *   - ADT^A08  (update demographics)
 *   - ORU^R01  (lab/observation result)
 *
 * Parsing is intentionally tolerant — it never throws on unknown segments,
 * and returns a shape that downstream callers can map to internal entities
 * (Patient, LabResult).
 *
 * NB: this is a parser only. It does not perform MLLP framing or ACK
 * generation; those concerns belong to a transport layer chosen by the
 * deploying organization.
 */

'use strict';

const FIELD_SEP = '|';
// Default encoding characters for HL7 v2: ^ ~ \ &
const COMP_SEP = '^';
const REP_SEP = '~';
const SUBCOMP_SEP = '&';

function splitSegments(message) {
  return String(message || '')
    .replace(/\r\n/g, '\r')
    .replace(/\n/g, '\r')
    .split('\r')
    .map(s => s.trimEnd())
    .filter(Boolean);
}

function parseField(field) {
  if (field === undefined || field === null || field === '') return null;
  const reps = field.split(REP_SEP);
  const decoded = reps.map(rep => {
    const comps = rep.split(COMP_SEP).map(c => {
      if (c === '') return null;
      const sub = c.split(SUBCOMP_SEP);
      return sub.length === 1 ? sub[0] : sub;
    });
    return comps.length === 1 ? comps[0] : comps;
  });
  return decoded.length === 1 ? decoded[0] : decoded;
}

function parseSegment(segmentLine) {
  const parts = segmentLine.split(FIELD_SEP);
  const name = parts[0];
  const fields = parts.slice(1).map(parseField);
  return { name, fields };
}

function getMshType(msh) {
  // For MSH the field separator itself IS MSH-1; encoding chars are MSH-2.
  // After segment-name split: parts[0]="MSH", parts[1]="^~\&", parts[2]=MSH-3, ...
  // So fields[i] (= parts.slice(1)[i]) corresponds to MSH-(i+2):
  //   fields[0]=MSH-2 (encoding chars)
  //   fields[7]=MSH-9 (message type)
  //   fields[8]=MSH-10 (message control id)
  const f = msh.fields;
  if (!f || f.length < 8) return null;
  const t9 = f[7];
  if (Array.isArray(t9)) return { type: t9[0], event: t9[1], structure: t9[2] || null };
  return { type: t9, event: null, structure: null };
}

function pickFirst(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return pickFirst(value[0]);
  return value;
}

function pickAt(field, idx) {
  if (field === null || field === undefined) return null;
  if (!Array.isArray(field)) return idx === 0 ? field : null;
  return field[idx] !== undefined ? field[idx] : null;
}

function pidToPatient(pid) {
  const f = pid.fields;
  // PID-3 (Patient Identifier List)
  const idField = f[2];
  let mrn = null;
  if (Array.isArray(idField) && Array.isArray(idField[0])) {
    mrn = idField[0][0];
  } else if (Array.isArray(idField)) {
    mrn = idField[0];
  } else {
    mrn = idField;
  }
  // PID-5 (Patient Name) — XPN: family^given^middle^suffix^prefix
  const nameField = f[4];
  let lastName = null, firstName = null, middleName = null;
  if (Array.isArray(nameField)) {
    lastName = pickFirst(nameField[0]);
    firstName = pickFirst(nameField[1]);
    middleName = pickFirst(nameField[2]);
  } else {
    lastName = nameField;
  }
  // PID-7 (DOB), PID-8 (Sex)
  const dob = pickFirst(f[6]);
  const sex = pickFirst(f[7]);
  // PID-13 phone, PID-19 SSN, PID-11 address
  const phone = (() => {
    const v = f[12];
    if (!v) return null;
    if (Array.isArray(v) && Array.isArray(v[0])) return v[0][0];
    if (Array.isArray(v)) return v[0];
    return v;
  })();
  return {
    mrn: typeof mrn === 'string' ? mrn : pickFirst(mrn),
    last_name: lastName,
    first_name: firstName,
    middle_name: middleName,
    date_of_birth: dob ? formatHl7Date(dob) : null,
    sex: sex || null,
    phone,
  };
}

function pv1ToVisit(pv1) {
  if (!pv1) return null;
  const f = pv1.fields;
  return {
    patient_class: pickFirst(f[1]),
    assigned_location: pickFirst(f[2]),
    admit_datetime: pickFirst(f[43]) || null,
    discharge_datetime: pickFirst(f[44]) || null,
    visit_number: (() => {
      const v = f[18];
      if (!v) return null;
      if (Array.isArray(v) && Array.isArray(v[0])) return v[0][0];
      if (Array.isArray(v)) return v[0];
      return v;
    })(),
  };
}

function obxToObservation(obx) {
  const f = obx.fields;
  // OBX-1 set-id, OBX-2 value type, OBX-3 observation identifier (CE),
  // OBX-5 value, OBX-6 units (CE), OBX-7 references range, OBX-11 result status,
  // OBX-14 observation date/time
  const obsIdField = f[2];
  let testCode = null, testName = null, codingSystem = null;
  if (Array.isArray(obsIdField)) {
    testCode = pickAt(obsIdField, 0);
    testName = pickAt(obsIdField, 1);
    codingSystem = pickAt(obsIdField, 2);
  } else {
    testCode = obsIdField;
  }
  let unit = null;
  const unitField = f[5];
  if (Array.isArray(unitField)) unit = pickAt(unitField, 0);
  else unit = unitField;
  const value = pickFirst(f[4]);
  return {
    set_id: pickFirst(f[0]),
    value_type: pickFirst(f[1]),
    test_code: testCode,
    test_name: testName,
    coding_system: codingSystem,
    value: value === null ? null : String(value),
    unit,
    reference_range: pickFirst(f[6]),
    result_status: pickFirst(f[10]),
    observation_datetime: f[13] ? formatHl7DateTime(pickFirst(f[13])) : null,
  };
}

function obrToOrder(obr) {
  const f = obr.fields;
  const idField = f[3]; // OBR-4 universal service identifier
  let testCode = null, testName = null;
  if (Array.isArray(idField)) {
    testCode = pickAt(idField, 0);
    testName = pickAt(idField, 1);
  } else {
    testCode = idField;
  }
  return {
    placer_order_number: (() => {
      const v = f[1];
      if (Array.isArray(v) && Array.isArray(v[0])) return v[0][0];
      if (Array.isArray(v)) return v[0];
      return v;
    })(),
    test_code: testCode,
    test_name: testName,
    observation_datetime: f[6] ? formatHl7DateTime(pickFirst(f[6])) : null,
    result_status: pickFirst(f[24]),
  };
}

function formatHl7Date(s) {
  // YYYYMMDD → YYYY-MM-DD
  if (!s || typeof s !== 'string') return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{14}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

function formatHl7DateTime(s) {
  if (!s || typeof s !== 'string') return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`;
  if (/^\d{12}/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14) || '00'}`;
  }
  return s;
}

const SUPPORTED_EVENTS = new Set(['A01', 'A03', 'A04', 'A08', 'R01']);

function parseMessage(raw) {
  const segments = splitSegments(raw).map(parseSegment);
  if (!segments.length || segments[0].name !== 'MSH') {
    throw new Error('Invalid HL7 message: missing MSH');
  }
  const msh = segments[0];
  const typeInfo = getMshType(msh) || { type: null, event: null };
  const isSupported = typeInfo.event && SUPPORTED_EVENTS.has(typeInfo.event);

  const result = {
    message_type: typeInfo.type,
    trigger_event: typeInfo.event,
    supported: !!isSupported,
    sending_app: pickFirst(msh.fields[1]),       // MSH-3
    receiving_app: pickFirst(msh.fields[3]),     // MSH-5
    message_control_id: pickFirst(msh.fields[8]),// MSH-10
    timestamp: msh.fields[5] ? formatHl7DateTime(pickFirst(msh.fields[5])) : null, // MSH-7
    patient: null,
    visit: null,
    observations: [],
    orders: [],
    raw_segments: segments.map(s => s.name),
    warnings: [],
  };

  const pid = segments.find(s => s.name === 'PID');
  if (pid) result.patient = pidToPatient(pid);

  const pv1 = segments.find(s => s.name === 'PV1');
  if (pv1) result.visit = pv1ToVisit(pv1);

  if (typeInfo.type === 'ORU' || typeInfo.event === 'R01') {
    const obrs = segments.filter(s => s.name === 'OBR');
    for (const obr of obrs) result.orders.push(obrToOrder(obr));
    const obxs = segments.filter(s => s.name === 'OBX');
    for (const obx of obxs) result.observations.push(obxToObservation(obx));
  }

  if (!isSupported) {
    result.warnings.push(`Trigger event ${typeInfo.event || 'unknown'} not in supported set ${[...SUPPORTED_EVENTS].join(',')}`);
  }
  return result;
}

/**
 * Build a minimal MLLP-style ACK message (MSA AA = accept).
 */
function buildAck(parsedOrRaw, code = 'AA', textMessage = '') {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const ctrlId = (typeof parsedOrRaw === 'object' && parsedOrRaw?.message_control_id)
    ? parsedOrRaw.message_control_id
    : 'UNKNOWN';
  const lines = [
    `MSH|^~\\&|TransTrack|TransTrack|||${ts}||ACK|${ctrlId}|P|2.5`,
    `MSA|${code}|${ctrlId}|${textMessage}`,
  ];
  return lines.join('\r');
}

module.exports = {
  parseMessage,
  buildAck,
  splitSegments,
  parseSegment,
  pidToPatient,
  pv1ToVisit,
  obxToObservation,
  obrToOrder,
  SUPPORTED_EVENTS: [...SUPPORTED_EVENTS],
};
