/**
 * Living donor workflow service.
 *
 * Manages: living_donors, living_donor_evaluations, living_donor_followups.
 *
 * Per SRS TT-R068. Implements OPTN Policy 14 follow-up cadence at 6, 12, and
 * 24 months post-donation. Follow-ups are auto-created when status moves to
 * DONATED.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');

const STATUSES = Object.freeze({
  INQUIRY: 'INQUIRY',
  SCREENING: 'SCREENING',
  EVALUATION: 'EVALUATION',
  APPROVED: 'APPROVED',
  DEFERRED: 'DEFERRED',
  DECLINED: 'DECLINED',
  DONATED: 'DONATED',
  WITHDRAWN: 'WITHDRAWN',
});

const TRANSITIONS = Object.freeze({
  INQUIRY: new Set(['SCREENING', 'WITHDRAWN', 'DECLINED']),
  SCREENING: new Set(['EVALUATION', 'DEFERRED', 'DECLINED', 'WITHDRAWN']),
  EVALUATION: new Set(['APPROVED', 'DEFERRED', 'DECLINED', 'WITHDRAWN']),
  APPROVED: new Set(['DONATED', 'DEFERRED', 'WITHDRAWN']),
  DEFERRED: new Set(['SCREENING', 'EVALUATION', 'DECLINED', 'WITHDRAWN']),
  DECLINED: new Set([]),
  DONATED: new Set([]),
  WITHDRAWN: new Set([]),
});

// OPTN Policy 14 follow-up milestones (months post-donation)
const FOLLOWUP_MILESTONES = [6, 12, 24];

function ensure(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} is required`);
  }
}

function addMonthsIso(dateIso, months) {
  const d = new Date(dateIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function createDonor({ orgId, mrn, firstName, lastName, dateOfBirth, sex, bloodType,
  relationshipToRecipient, recipientPatientId, intendedOrgan, phone, email, address,
  notes, createdBy }) {
  ensure(orgId, 'orgId');
  ensure(firstName, 'first_name');
  ensure(lastName, 'last_name');
  ensure(intendedOrgan, 'intended_organ');
  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO living_donors (
      id, org_id, mrn, first_name, last_name, date_of_birth, sex, blood_type,
      relationship_to_recipient, recipient_patient_id, intended_organ,
      phone, email, address, status, status_reason, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INQUIRY', ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, mrn ?? null, firstName, lastName, dateOfBirth ?? null, sex ?? null, bloodType ?? null,
    relationshipToRecipient ?? null, recipientPatientId ?? null, intendedOrgan,
    phone ?? null, email ?? null, address ?? null, notes ?? null, createdBy ?? null, createdBy ?? null);
  return getDonor(id, orgId);
}

function getDonor(id, orgId) {
  return getDatabase().prepare('SELECT * FROM living_donors WHERE id = ? AND org_id = ?').get(id, orgId);
}

function listDonors({ orgId, status, recipientPatientId, limit = 200 } = {}) {
  if (!orgId) throw new Error('orgId required');
  let sql = 'SELECT * FROM living_donors WHERE org_id = ?';
  const params = [orgId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (recipientPatientId) { sql += ' AND recipient_patient_id = ?'; params.push(recipientPatientId); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(500, limit)));
  return getDatabase().prepare(sql).all(...params);
}

function transitionDonor({ id, orgId, toStatus, reason, donationDate, updatedBy }) {
  if (!orgId) throw new Error('orgId required');
  const db = getDatabase();
  const donor = getDonor(id, orgId);
  if (!donor) throw new Error('Living donor not found or access denied');

  const allowed = TRANSITIONS[donor.status] || new Set();
  if (!allowed.has(toStatus)) {
    throw new Error(`Illegal transition ${donor.status} → ${toStatus}`);
  }

  if ((toStatus === 'DECLINED' || toStatus === 'DEFERRED' || toStatus === 'WITHDRAWN') && !reason) {
    throw new Error(`status_reason is required when transitioning to ${toStatus}`);
  }

  if (toStatus === 'DONATED' && !donationDate) {
    throw new Error('donation_date is required when transitioning to DONATED');
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE living_donors SET status = ?, status_reason = COALESCE(?, status_reason),
                                updated_by = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?
    `).run(toStatus, reason ?? null, updatedBy ?? null, id, orgId);

    if (toStatus === 'DONATED') {
      for (const m of FOLLOWUP_MILESTONES) {
        const fid = uuidv4();
        const due = addMonthsIso(donationDate, m);
        db.prepare(`
          INSERT INTO living_donor_followups (
            id, org_id, living_donor_id, milestone_months, due_date, status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'PENDING', datetime('now'), datetime('now'))
        `).run(fid, orgId, id, m, due);
      }
    }
  });
  tx();
  return getDonor(id, orgId);
}

function addEvaluationStep({ orgId, livingDonorId, step, scheduledDate, ownerRole, notes }) {
  ensure(orgId, 'orgId'); ensure(livingDonorId, 'living_donor_id'); ensure(step, 'step');
  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO living_donor_evaluations (
      id, org_id, living_donor_id, step, status, scheduled_date, owner_role,
      notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, livingDonorId, step, scheduledDate ?? null, ownerRole ?? null, notes ?? null);
  return getDatabase().prepare('SELECT * FROM living_donor_evaluations WHERE id = ?').get(id);
}

function updateEvaluationStep({ id, orgId, status, completedDate, notes }) {
  const db = getDatabase();
  const allowed = ['PENDING', 'SCHEDULED', 'COMPLETE', 'DEFERRED', 'FAILED'];
  if (status && !allowed.includes(status)) throw new Error('Invalid evaluation status');
  db.prepare(`
    UPDATE living_donor_evaluations
       SET status = COALESCE(?, status),
           completed_date = COALESCE(?, completed_date),
           notes = COALESCE(?, notes),
           updated_at = datetime('now')
     WHERE id = ? AND org_id = ?
  `).run(status ?? null, completedDate ?? null, notes ?? null, id, orgId);
  return db.prepare('SELECT * FROM living_donor_evaluations WHERE id = ?').get(id);
}

function listEvaluations(livingDonorId, orgId) {
  return getDatabase().prepare(`
    SELECT * FROM living_donor_evaluations
    WHERE living_donor_id = ? AND org_id = ?
    ORDER BY scheduled_date IS NULL, scheduled_date ASC, created_at ASC
  `).all(livingDonorId, orgId);
}

function listFollowups(livingDonorId, orgId) {
  return getDatabase().prepare(`
    SELECT * FROM living_donor_followups
    WHERE living_donor_id = ? AND org_id = ?
    ORDER BY milestone_months ASC
  `).all(livingDonorId, orgId);
}

function updateFollowup({ id, orgId, status, completedDate, notes }) {
  const db = getDatabase();
  const allowed = ['PENDING', 'SCHEDULED', 'COMPLETE', 'OVERDUE', 'LOST_TO_FOLLOWUP'];
  if (status && !allowed.includes(status)) throw new Error('Invalid followup status');
  db.prepare(`
    UPDATE living_donor_followups
       SET status = COALESCE(?, status),
           completed_date = COALESCE(?, completed_date),
           notes = COALESCE(?, notes),
           updated_at = datetime('now')
     WHERE id = ? AND org_id = ?
  `).run(status ?? null, completedDate ?? null, notes ?? null, id, orgId);
  return db.prepare('SELECT * FROM living_donor_followups WHERE id = ?').get(id);
}

/**
 * Mark any PENDING/SCHEDULED follow-up whose due_date has passed as OVERDUE.
 * Returns the count of records updated.
 */
function markOverdueFollowups(orgId) {
  const db = getDatabase();
  const sql = orgId
    ? `UPDATE living_donor_followups
         SET status = 'OVERDUE', updated_at = datetime('now')
       WHERE org_id = ? AND status IN ('PENDING','SCHEDULED')
         AND due_date < date('now') AND completed_date IS NULL`
    : `UPDATE living_donor_followups
         SET status = 'OVERDUE', updated_at = datetime('now')
       WHERE status IN ('PENDING','SCHEDULED')
         AND due_date < date('now') AND completed_date IS NULL`;
  const info = orgId ? db.prepare(sql).run(orgId) : db.prepare(sql).run();
  return { overdueCount: info.changes };
}

function getDonorSummary(donorId, orgId) {
  const donor = getDonor(donorId, orgId);
  if (!donor) return null;
  return {
    donor,
    evaluations: listEvaluations(donorId, orgId),
    followups: listFollowups(donorId, orgId),
  };
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  FOLLOWUP_MILESTONES,
  createDonor, getDonor, listDonors, transitionDonor,
  addEvaluationStep, updateEvaluationStep, listEvaluations,
  listFollowups, updateFollowup, markOverdueFollowups,
  getDonorSummary,
};
