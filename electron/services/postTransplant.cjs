/**
 * Post-transplant follow-up service.
 *
 * Manages: transplant_events, immunosuppression_regimens, rejection_episodes,
 * biopsies, post_tx_readmissions.
 *
 * Per SRS TT-R067.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');

function ensure(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} is required`);
  }
}

// ---------- transplant events ----------

function createTransplantEvent({ orgId, patientId, donorOrganId, organType, transplantDate, surgeon,
  warmIschemiaTimeMin, coldIschemiaTimeMin, inductionRegimen, dischargeDate, notes, createdBy }) {
  ensure(orgId, 'orgId');
  ensure(patientId, 'patient_id');
  ensure(organType, 'organ_type');
  ensure(transplantDate, 'transplant_date');
  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO transplant_events (
      id, org_id, patient_id, donor_organ_id, organ_type, transplant_date,
      surgeon, warm_ischemia_time_min, cold_ischemia_time_min, induction_regimen,
      discharge_date, notes, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, patientId, donorOrganId ?? null, organType, transplantDate, surgeon ?? null,
    warmIschemiaTimeMin ?? null, coldIschemiaTimeMin ?? null, inductionRegimen ?? null,
    dischargeDate ?? null, notes ?? null, createdBy ?? null, createdBy ?? null);
  return getTransplantEvent(id, orgId);
}

function updateTransplantEvent({ id, orgId, fields, updatedBy }) {
  const db = getDatabase();
  const allowed = ['surgeon', 'warm_ischemia_time_min', 'cold_ischemia_time_min',
    'induction_regimen', 'discharge_date', 'graft_status', 'patient_status',
    'deceased_date', 'deceased_cause', 'notes'];
  const sets = [];
  const params = [];
  for (const k of Object.keys(fields || {})) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); params.push(fields[k]); }
  }
  if (!sets.length) return getTransplantEvent(id, orgId);
  sets.push("updated_by = ?", "updated_at = datetime('now')");
  params.push(updatedBy ?? null, id, orgId);
  db.prepare(`UPDATE transplant_events SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).run(...params);
  return getTransplantEvent(id, orgId);
}

function getTransplantEvent(id, orgId) {
  return getDatabase().prepare('SELECT * FROM transplant_events WHERE id = ? AND org_id = ?').get(id, orgId);
}

function listTransplantEventsByPatient(patientId, orgId) {
  return getDatabase().prepare(`
    SELECT * FROM transplant_events WHERE patient_id = ? AND org_id = ? ORDER BY transplant_date DESC
  `).all(patientId, orgId);
}

// ---------- immunosuppression ----------

function createImmunoRegimen({ orgId, patientId, transplantEventId, startDate, endDate, drugName,
  dose, frequency, targetTrough, notes, createdBy }) {
  ensure(orgId, 'orgId'); ensure(patientId, 'patient_id'); ensure(startDate, 'start_date'); ensure(drugName, 'drug_name');
  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO immunosuppression_regimens (
      id, org_id, patient_id, transplant_event_id, start_date, end_date,
      drug_name, dose, frequency, target_trough, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, patientId, transplantEventId ?? null, startDate, endDate ?? null,
    drugName, dose ?? null, frequency ?? null, targetTrough ?? null, notes ?? null, createdBy ?? null);
  return getDatabase().prepare('SELECT * FROM immunosuppression_regimens WHERE id = ?').get(id);
}

function listImmunoRegimensByPatient(patientId, orgId) {
  return getDatabase().prepare(`
    SELECT * FROM immunosuppression_regimens WHERE patient_id = ? AND org_id = ? ORDER BY start_date DESC
  `).all(patientId, orgId);
}

// ---------- rejection ----------

function createRejection({ orgId, patientId, transplantEventId, episodeDate, rejectionType,
  severity, treatment, resolutionDate, biopsyId, notes, createdBy }) {
  ensure(orgId, 'orgId'); ensure(patientId, 'patient_id'); ensure(episodeDate, 'episode_date');
  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO rejection_episodes (
      id, org_id, patient_id, transplant_event_id, episode_date, rejection_type,
      severity, treatment, resolution_date, biopsy_id, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, patientId, transplantEventId ?? null, episodeDate, rejectionType ?? null,
    severity ?? null, treatment ?? null, resolutionDate ?? null, biopsyId ?? null, notes ?? null, createdBy ?? null);
  return getDatabase().prepare('SELECT * FROM rejection_episodes WHERE id = ?').get(id);
}

function listRejectionsByPatient(patientId, orgId) {
  return getDatabase().prepare(`
    SELECT * FROM rejection_episodes WHERE patient_id = ? AND org_id = ? ORDER BY episode_date DESC
  `).all(patientId, orgId);
}

// ---------- biopsies ----------

function createBiopsy({ orgId, patientId, transplantEventId, biopsyDate, biopsyType, finding,
  banffGrade, notes, createdBy }) {
  ensure(orgId, 'orgId'); ensure(patientId, 'patient_id'); ensure(biopsyDate, 'biopsy_date');
  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO biopsies (
      id, org_id, patient_id, transplant_event_id, biopsy_date, biopsy_type,
      finding, banff_grade, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, patientId, transplantEventId ?? null, biopsyDate, biopsyType ?? null,
    finding ?? null, banffGrade ?? null, notes ?? null, createdBy ?? null);
  return getDatabase().prepare('SELECT * FROM biopsies WHERE id = ?').get(id);
}

function listBiopsiesByPatient(patientId, orgId) {
  return getDatabase().prepare(`
    SELECT * FROM biopsies WHERE patient_id = ? AND org_id = ? ORDER BY biopsy_date DESC
  `).all(patientId, orgId);
}

// ---------- readmissions ----------

function createReadmission({ orgId, patientId, transplantEventId, admitDate, dischargeDate,
  reason, relatedToGraft, notes, createdBy }) {
  ensure(orgId, 'orgId'); ensure(patientId, 'patient_id'); ensure(admitDate, 'admit_date');
  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO post_tx_readmissions (
      id, org_id, patient_id, transplant_event_id, admit_date, discharge_date,
      reason, related_to_graft, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, patientId, transplantEventId ?? null, admitDate, dischargeDate ?? null,
    reason ?? null, relatedToGraft ? 1 : 0, notes ?? null, createdBy ?? null);
  return getDatabase().prepare('SELECT * FROM post_tx_readmissions WHERE id = ?').get(id);
}

function listReadmissionsByPatient(patientId, orgId) {
  return getDatabase().prepare(`
    SELECT * FROM post_tx_readmissions WHERE patient_id = ? AND org_id = ? ORDER BY admit_date DESC
  `).all(patientId, orgId);
}

// ---------- summary ----------

function getPatientPostTxSummary(patientId, orgId) {
  const events = listTransplantEventsByPatient(patientId, orgId);
  const immuno = listImmunoRegimensByPatient(patientId, orgId);
  const rejections = listRejectionsByPatient(patientId, orgId);
  const biopsies = listBiopsiesByPatient(patientId, orgId);
  const readmissions = listReadmissionsByPatient(patientId, orgId);
  return {
    transplant_events: events,
    immunosuppression: immuno,
    rejections,
    biopsies,
    readmissions,
    counts: {
      transplant_events: events.length,
      active_immuno: immuno.filter(r => !r.end_date).length,
      rejections: rejections.length,
      biopsies: biopsies.length,
      readmissions: readmissions.length,
    },
  };
}

module.exports = {
  createTransplantEvent, updateTransplantEvent, getTransplantEvent, listTransplantEventsByPatient,
  createImmunoRegimen, listImmunoRegimensByPatient,
  createRejection, listRejectionsByPatient,
  createBiopsy, listBiopsiesByPatient,
  createReadmission, listReadmissionsByPatient,
  getPatientPostTxSummary,
};
