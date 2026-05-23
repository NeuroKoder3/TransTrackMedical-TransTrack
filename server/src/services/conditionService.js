'use strict';

const audit = require('./auditService');

const COLS = [
  'id', 'org_id', 'patient_id', 'code', 'code_system', 'display',
  'clinical_status', 'verification_status', 'category',
  'onset_date', 'abatement_date', 'notes', 'source', 'fhir_resource_id',
  'created_at', 'updated_at',
];

async function listForPatient(client, ctx, patientId, { limit = 100, clinicalStatus } = {}) {
  const params = [ctx.orgId, patientId];
  let where = 'org_id = $1 AND patient_id = $2';
  if (clinicalStatus) {
    params.push(clinicalStatus);
    where += ` AND clinical_status = $${params.length}`;
  }
  params.push(limit);
  const r = await client.query(
    `SELECT ${COLS.join(',')} FROM patient_conditions
     WHERE ${where}
     ORDER BY onset_date DESC NULLS LAST, created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

async function create(client, ctx, input) {
  const cols = ['org_id'];
  const vals = [ctx.orgId];
  for (const k of Object.keys(input)) {
    if (COLS.includes(k) && k !== 'id' && k !== 'org_id') {
      cols.push(k);
      vals.push(input[k]);
    }
  }
  const ph = vals.map((_, i) => `$${i + 1}`).join(',');
  const r = await client.query(
    `INSERT INTO patient_conditions (${cols.join(',')}) VALUES (${ph})
     RETURNING ${COLS.join(',')}`,
    vals,
  );
  await audit.record(client, ctx, {
    action: 'condition.create',
    entityType: 'patient_condition',
    entityId: r.rows[0].id,
    details: {
      code: r.rows[0].code,
      display: r.rows[0].display,
      source: r.rows[0].source,
    },
  });
  return r.rows[0];
}

module.exports = { listForPatient, create, COLS };
