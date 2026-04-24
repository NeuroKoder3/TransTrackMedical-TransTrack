/**
 * HL7 v2 ingest service.
 *
 * Lifts a parsed HL7 message (from `hl7v2.cjs::parseMessage`) into the
 * application's internal entities:
 *
 *   - PID  → patients   (lookup by org + MRN; create new or update demographics)
 *   - OBX  → lab_results (one row per OBX; only when patient was matched / created)
 *
 * The ingest is conservative:
 *   - It NEVER infers an organ_needed value (operational decision, not HL7-derived).
 *   - Lab results are stored as strings to prevent any clinical interpretation
 *     downstream (matches existing schema contract).
 *   - The whole ingest runs in a single SQLite transaction. If anything fails,
 *     the database is unchanged.
 *
 * Per SRS TT-R070 / TT-R071. The contract returned from `ingest()` is suitable
 * for both UI display and audit logging.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');

function trim(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

function findPatientByMrn(db, orgId, mrn) {
  if (!mrn) return null;
  return db.prepare(
    'SELECT * FROM patients WHERE org_id = ? AND patient_id = ? LIMIT 1'
  ).get(orgId, mrn);
}

function buildPatientInsert({ orgId, parsedPatient, createdBy }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  return {
    id,
    org_id: orgId,
    patient_id: trim(parsedPatient.mrn),
    first_name: trim(parsedPatient.first_name) || 'Unknown',
    last_name: trim(parsedPatient.last_name) || 'Unknown',
    date_of_birth: trim(parsedPatient.date_of_birth),
    blood_type: null,
    organ_needed: null,
    waitlist_status: 'active',
    medical_urgency: 'medium',
    phone: trim(parsedPatient.phone),
    created_by: createdBy || null,
    created_at: now,
    updated_at: now,
  };
}

function insertPatient(db, row) {
  db.prepare(`
    INSERT INTO patients
      (id, org_id, patient_id, first_name, last_name, date_of_birth,
       blood_type, organ_needed, medical_urgency, waitlist_status,
       phone, created_by, created_at, updated_at)
    VALUES
      (@id, @org_id, @patient_id, @first_name, @last_name, @date_of_birth,
       @blood_type, @organ_needed, @medical_urgency, @waitlist_status,
       @phone, @created_by, @created_at, @updated_at)
  `).run(row);
}

function updatePatientDemographics(db, existing, parsedPatient, updatedBy) {
  const fields = {};
  if (parsedPatient.first_name && existing.first_name !== parsedPatient.first_name) {
    fields.first_name = trim(parsedPatient.first_name);
  }
  if (parsedPatient.last_name && existing.last_name !== parsedPatient.last_name) {
    fields.last_name = trim(parsedPatient.last_name);
  }
  if (parsedPatient.date_of_birth && existing.date_of_birth !== parsedPatient.date_of_birth) {
    fields.date_of_birth = trim(parsedPatient.date_of_birth);
  }
  if (parsedPatient.phone && existing.phone !== parsedPatient.phone) {
    fields.phone = trim(parsedPatient.phone);
  }
  const keys = Object.keys(fields);
  if (keys.length === 0) return { updated: false, fields: [] };

  const setClause = keys.map(k => `${k} = @${k}`).join(', ');
  fields.id = existing.id;
  fields.org_id = existing.org_id;
  fields.updated_at = new Date().toISOString();
  db.prepare(
    `UPDATE patients SET ${setClause}, updated_at = @updated_at WHERE id = @id AND org_id = @org_id`
  ).run(fields);
  return { updated: true, fields: keys, by: updatedBy || null };
}

function insertLabResult(db, { orgId, patientId, parsedObx, sendingApp, enteredBy, fallbackUserId }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  // Lab results require a non-null entered_by (FK to users.id). When ingest is
  // run by a system process without a user id we fall back to the configured
  // fallback (typically the current session user). If neither is available we
  // skip the row rather than violate the FK.
  if (!fallbackUserId && !enteredBy) {
    return { id: null, skipped: true, reason: 'no entered_by' };
  }
  // The schema CHECK constrains source to {MANUAL, FHIR_IMPORT}; mark
  // HL7-imported rows as FHIR_IMPORT (external, non-manual) and record the
  // HL7 origin in ordering_service so it remains discoverable downstream
  // without a destructive schema migration.
  db.prepare(`
    INSERT INTO lab_results
      (id, org_id, patient_id, test_code, test_name, value, units,
       reference_range, collected_at, resulted_at, source, ordering_service,
       entered_by, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FHIR_IMPORT', ?, ?, ?, ?)
  `).run(
    id, orgId, patientId,
    trim(parsedObx.test_code) || 'UNKNOWN',
    trim(parsedObx.test_name) || trim(parsedObx.test_code) || 'Unknown',
    parsedObx.value === null || parsedObx.value === undefined ? '' : String(parsedObx.value),
    trim(parsedObx.unit),
    trim(parsedObx.reference_range),
    trim(parsedObx.observation_datetime) || now,
    trim(parsedObx.observation_datetime) || null,
    `HL7_v2/${trim(sendingApp) || 'unknown'}`,
    fallbackUserId || enteredBy,
    now,
    now,
  );
  return { id, skipped: false };
}

/**
 * Lift a parsed HL7 message into internal entities.
 *
 * @param {object} args
 * @param {string} args.orgId         - Organization to scope inserts to.
 * @param {object} args.parsed        - Output of hl7v2.parseMessage().
 * @param {object} [args.options]     - Ingest behaviour toggles.
 * @param {boolean} [args.options.createPatient=true]
 *        When true, create the patient if no MRN match exists. When false,
 *        skip the message.
 * @param {boolean} [args.options.updateDemographics=true]
 *        When true, update first/last/DOB/phone on demographic-style messages.
 * @param {boolean} [args.options.ingestObservations=true]
 *        When true, OBX rows are written to lab_results for ORU^R01.
 * @param {string} [args.userEmail]   - Audit / created_by attribution.
 * @param {string} [args.userId]      - Used for lab_results.entered_by FK.
 *
 * @returns {{
 *   ok: boolean,
 *   message_type: string|null,
 *   trigger_event: string|null,
 *   patient: { id: string, action: 'created'|'updated'|'matched', mrn: string|null,
 *              updatedFields?: string[] } | null,
 *   labs: { inserted: number, skipped: number, ids: string[] },
 *   warnings: string[]
 * }}
 */
function ingest({ orgId, parsed, options = {}, userEmail = null, userId = null }) {
  if (!orgId) throw new Error('orgId required');
  if (!parsed) throw new Error('parsed message required');

  const opts = {
    createPatient: options.createPatient !== false,
    updateDemographics: options.updateDemographics !== false,
    ingestObservations: options.ingestObservations !== false,
  };

  const db = getDatabase();
  const warnings = [...(parsed.warnings || [])];
  const summary = {
    ok: false,
    message_type: parsed.message_type || null,
    trigger_event: parsed.trigger_event || null,
    patient: null,
    labs: { inserted: 0, skipped: 0, ids: [] },
    warnings,
  };

  if (!parsed.patient || !parsed.patient.mrn) {
    warnings.push('No PID/MRN in message; nothing to ingest.');
    return summary;
  }

  const tx = db.transaction(() => {
    let patientRow = findPatientByMrn(db, orgId, parsed.patient.mrn);
    let action = 'matched';
    let updatedFields = [];

    if (!patientRow) {
      if (!opts.createPatient) {
        warnings.push(`No patient with MRN ${parsed.patient.mrn}; create disabled.`);
        summary.ok = true;
        return;
      }
      const ins = buildPatientInsert({ orgId, parsedPatient: parsed.patient, createdBy: userEmail });
      insertPatient(db, ins);
      patientRow = db.prepare('SELECT * FROM patients WHERE id = ?').get(ins.id);
      action = 'created';
    } else if (opts.updateDemographics) {
      const upd = updatePatientDemographics(db, patientRow, parsed.patient, userEmail);
      if (upd.updated) {
        action = 'updated';
        updatedFields = upd.fields;
        patientRow = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientRow.id);
      }
    }

    summary.patient = {
      id: patientRow.id,
      action,
      mrn: patientRow.patient_id,
      first_name: patientRow.first_name,
      last_name: patientRow.last_name,
      ...(updatedFields.length ? { updatedFields } : {}),
    };

    if (opts.ingestObservations && Array.isArray(parsed.observations) && parsed.observations.length) {
      for (const obx of parsed.observations) {
        const r = insertLabResult(db, {
          orgId,
          patientId: patientRow.id,
          parsedObx: obx,
          sendingApp: parsed.sending_app,
          enteredBy: userId,
          fallbackUserId: userId,
        });
        if (r.skipped) {
          summary.labs.skipped += 1;
          warnings.push(`OBX skipped (${r.reason}) for code=${obx.test_code || 'UNKNOWN'}`);
        } else {
          summary.labs.inserted += 1;
          summary.labs.ids.push(r.id);
        }
      }
    }

    summary.ok = true;
  });

  try {
    tx();
  } catch (e) {
    summary.ok = false;
    warnings.push(`Ingest failed: ${e.message}`);
  }
  return summary;
}

module.exports = {
  ingest,
  // exported for tests
  _internals: { findPatientByMrn, buildPatientInsert, updatePatientDemographics },
};
