'use strict';

const audit = require('./auditService');

const PATIENT_COLUMNS = [
  'id', 'org_id', 'mrn', 'patient_id', 'first_name', 'last_name', 'middle_name',
  'date_of_birth', 'sex', 'blood_type', 'organ_needed', 'medical_urgency',
  'waitlist_status', 'date_added_to_waitlist', 'priority_score',
  'priority_score_breakdown', 'hla_typing', 'pra_percentage', 'cpra_percentage',
  'meld_score', 'las_score', 'functional_status', 'prognosis_rating',
  'last_evaluation_date', 'comorbidity_score', 'previous_transplants',
  'compliance_score', 'weight_kg', 'height_cm', 'phone', 'email', 'address',
  'emergency_contact_name', 'emergency_contact_phone', 'diagnosis',
  'comorbidities', 'medications', 'donor_preferences', 'psychological_clearance',
  'support_system_rating', 'document_urls', 'notes',
  'created_at', 'updated_at', 'created_by', 'updated_by',
];

async function list(client, ctx, { limit = 50, offset = 0, search, organ, status }) {
  const where = ['org_id = $1'];
  const params = [ctx.orgId];
  if (organ)  { params.push(organ);  where.push(`organ_needed = $${params.length}`); }
  if (status) { params.push(status); where.push(`waitlist_status = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR mrn ILIKE $${params.length})`);
  }
  params.push(limit, offset);
  const sql = `
    SELECT ${PATIENT_COLUMNS.join(',')}
    FROM patients
    WHERE ${where.join(' AND ')}
    ORDER BY priority_score DESC NULLS LAST, last_name ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const r = await client.query(sql, params);
  return r.rows;
}

async function get(client, ctx, id) {
  const r = await client.query(
    `SELECT ${PATIENT_COLUMNS.join(',')} FROM patients WHERE org_id = $1 AND id = $2`,
    [ctx.orgId, id]
  );
  return r.rows[0] || null;
}

async function getByMrn(client, ctx, mrn) {
  const r = await client.query(
    `SELECT ${PATIENT_COLUMNS.join(',')} FROM patients WHERE org_id = $1 AND mrn = $2`,
    [ctx.orgId, mrn]
  );
  return r.rows[0] || null;
}

async function create(client, ctx, input) {
  const cols = ['org_id', 'created_by', 'updated_by'];
  const vals = [ctx.orgId, ctx.userId || null, ctx.userId || null];
  for (const k of Object.keys(input)) {
    if (PATIENT_COLUMNS.includes(k) && k !== 'id' && k !== 'org_id') {
      cols.push(k);
      vals.push(input[k]);
    }
  }
  const ph = vals.map((_, i) => `$${i + 1}`).join(',');
  const r = await client.query(
    `INSERT INTO patients (${cols.join(',')}) VALUES (${ph})
     RETURNING ${PATIENT_COLUMNS.join(',')}`,
    vals
  );
  await audit.record(client, ctx, {
    action: 'patient.create', entityType: 'patient', entityId: r.rows[0].id,
    patientName: `${r.rows[0].last_name}, ${r.rows[0].first_name}`,
    details: { mrn: r.rows[0].mrn },
  });
  return r.rows[0];
}

async function update(client, ctx, id, input) {
  const sets = [];
  const vals = [];
  for (const k of Object.keys(input)) {
    if (PATIENT_COLUMNS.includes(k) && k !== 'id' && k !== 'org_id' && k !== 'created_at') {
      vals.push(input[k]);
      sets.push(`${k} = $${vals.length}`);
    }
  }
  if (sets.length === 0) return get(client, ctx, id);
  vals.push(ctx.userId || null);
  sets.push(`updated_by = $${vals.length}`);
  vals.push(ctx.orgId, id);
  const r = await client.query(
    `UPDATE patients SET ${sets.join(', ')}
     WHERE org_id = $${vals.length - 1} AND id = $${vals.length}
     RETURNING ${PATIENT_COLUMNS.join(',')}`,
    vals
  );
  if (r.rows[0]) {
    await audit.record(client, ctx, {
      action: 'patient.update', entityType: 'patient', entityId: id,
      patientName: `${r.rows[0].last_name}, ${r.rows[0].first_name}`,
      details: { fields: Object.keys(input) },
    });
  }
  return r.rows[0] || null;
}

/**
 * Upsert from an HL7 ADT/PID. mrn is the natural key per (org_id, mrn).
 */
async function upsertFromHl7(client, ctx, parsed) {
  const p = parsed.patient;
  if (!p?.mrn) return null;
  const existing = await getByMrn(client, ctx, p.mrn);
  if (existing) {
    return update(client, ctx, existing.id, {
      first_name: p.first_name || existing.first_name,
      last_name: p.last_name || existing.last_name,
      middle_name: p.middle_name || existing.middle_name,
      date_of_birth: p.date_of_birth || existing.date_of_birth,
      sex: p.sex || existing.sex,
      phone: p.phone || existing.phone,
    });
  }
  return create(client, ctx, {
    mrn: p.mrn,
    first_name: p.first_name || 'UNKNOWN',
    last_name: p.last_name || 'UNKNOWN',
    middle_name: p.middle_name,
    date_of_birth: p.date_of_birth,
    sex: p.sex,
    phone: p.phone,
  });
}

module.exports = { list, get, getByMrn, create, update, upsertFromHl7, PATIENT_COLUMNS };
