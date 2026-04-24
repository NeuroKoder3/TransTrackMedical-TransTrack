/**
 * OPTN-style CSV export (TCR / TRR / TRF skeletons).
 *
 * Per SRS TT-R071. This module produces CSV files that follow the *shape*
 * of OPTN data submission forms, intended to assist the customer in
 * preparing their own submission. TransTrack does NOT submit to OPTN/UNet
 * on behalf of the customer.
 *
 *   TCR — Transplant Candidate Registration (waitlist registration)
 *   TRR — Transplant Recipient Registration (event of transplantation)
 *   TRF — Transplant Recipient Follow-up
 *
 * Field sets here are intentionally a small, well-defined subset of the
 * full OPTN forms (which evolve), chosen so the output is recognizable to
 * OPTN coordinators while being unambiguous and round-trippable from
 * TransTrack's internal schema.
 */

'use strict';

const { getDatabase } = require('../database/init.cjs');

const DISCLAIMER = 'NOT AN OPTN SUBMISSION. This file mirrors the shape of OPTN data submission forms to help your transplant data coordinator prepare a submission. TransTrack does not submit to OPTN/UNet on your behalf. You must verify and submit through the appropriate OPTN channel.';

// Quote a CSV field per RFC 4180.
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => csvField(r[c])).join(',')).join('\n');
  return `# ${DISCLAIMER}\n${header}\n${body}\n`;
}

// ---------------- TCR ----------------

const TCR_COLUMNS = [
  'patient_internal_id',
  'mrn',
  'last_name',
  'first_name',
  'date_of_birth',
  'sex',
  'blood_type',
  'organ_needed',
  'medical_urgency',
  'date_added_to_waitlist',
  'meld_score',
  'las_score',
  'pra_percentage',
  'cpra_percentage',
  'diagnosis',
  'height_cm',
  'weight_kg',
  'previous_transplants',
];

function exportTCR(orgId, { since, until } = {}) {
  if (!orgId) throw new Error('orgId required');
  const db = getDatabase();
  const params = [orgId];
  let where = 'org_id = ?';
  if (since) { where += ' AND date_added_to_waitlist >= ?'; params.push(since); }
  if (until) { where += ' AND date_added_to_waitlist <= ?'; params.push(until); }
  const rows = db.prepare(`
    SELECT id AS patient_internal_id, patient_id AS mrn, last_name, first_name,
           date_of_birth, NULL AS sex, blood_type, organ_needed, medical_urgency,
           date_added_to_waitlist, meld_score, las_score, pra_percentage,
           cpra_percentage, diagnosis, height_cm, weight_kg, previous_transplants
      FROM patients WHERE ${where}
      ORDER BY date_added_to_waitlist ASC
  `).all(...params);
  return { csv: toCsv(rows, TCR_COLUMNS), rowCount: rows.length, columns: TCR_COLUMNS, disclaimer: DISCLAIMER };
}

// ---------------- TRR ----------------

const TRR_COLUMNS = [
  'transplant_event_id',
  'patient_internal_id',
  'mrn',
  'organ_type',
  'transplant_date',
  'donor_organ_id',
  'donor_age',
  'cold_ischemia_time_hours',
  'warm_ischemia_time_min',
  'induction_regimen',
  'discharge_date',
];

function exportTRR(orgId, { since, until } = {}) {
  if (!orgId) throw new Error('orgId required');
  const db = getDatabase();
  const params = [orgId];
  let where = 'tx.org_id = ?';
  if (since) { where += ' AND tx.transplant_date >= ?'; params.push(since); }
  if (until) { where += ' AND tx.transplant_date <= ?'; params.push(until); }
  const rows = db.prepare(`
    SELECT tx.id AS transplant_event_id,
           tx.patient_id AS patient_internal_id,
           p.patient_id AS mrn,
           tx.organ_type,
           tx.transplant_date,
           tx.donor_organ_id,
           d.donor_age,
           d.cold_ischemia_time_hours,
           tx.warm_ischemia_time_min,
           tx.induction_regimen,
           tx.discharge_date
      FROM transplant_events tx
      LEFT JOIN patients p ON p.id = tx.patient_id
      LEFT JOIN donor_organs d ON d.id = tx.donor_organ_id
      WHERE ${where}
      ORDER BY tx.transplant_date ASC
  `).all(...params);
  return { csv: toCsv(rows, TRR_COLUMNS), rowCount: rows.length, columns: TRR_COLUMNS, disclaimer: DISCLAIMER };
}

// ---------------- TRF ----------------

const TRF_COLUMNS = [
  'transplant_event_id',
  'patient_internal_id',
  'mrn',
  'organ_type',
  'transplant_date',
  'graft_status',
  'patient_status',
  'deceased_date',
  'deceased_cause',
  'rejection_count',
  'biopsy_count',
  'readmission_count',
  'most_recent_immuno_drug',
];

function exportTRF(orgId) {
  if (!orgId) throw new Error('orgId required');
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT tx.id AS transplant_event_id,
           tx.patient_id AS patient_internal_id,
           p.patient_id AS mrn,
           tx.organ_type,
           tx.transplant_date,
           tx.graft_status,
           tx.patient_status,
           tx.deceased_date,
           tx.deceased_cause,
           (SELECT COUNT(*) FROM rejection_episodes r WHERE r.transplant_event_id = tx.id) AS rejection_count,
           (SELECT COUNT(*) FROM biopsies b WHERE b.transplant_event_id = tx.id) AS biopsy_count,
           (SELECT COUNT(*) FROM post_tx_readmissions ad WHERE ad.transplant_event_id = tx.id) AS readmission_count,
           (SELECT drug_name FROM immunosuppression_regimens i
              WHERE i.patient_id = tx.patient_id AND (i.end_date IS NULL OR i.end_date = '')
              ORDER BY i.start_date DESC LIMIT 1) AS most_recent_immuno_drug
      FROM transplant_events tx
      LEFT JOIN patients p ON p.id = tx.patient_id
      WHERE tx.org_id = ?
      ORDER BY tx.transplant_date ASC
  `).all(orgId);
  return { csv: toCsv(rows, TRF_COLUMNS), rowCount: rows.length, columns: TRF_COLUMNS, disclaimer: DISCLAIMER };
}

module.exports = {
  exportTCR,
  exportTRR,
  exportTRF,
  TCR_COLUMNS,
  TRR_COLUMNS,
  TRF_COLUMNS,
  DISCLAIMER,
};
