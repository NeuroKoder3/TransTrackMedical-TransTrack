'use strict';

const audit = require('./auditService');

const COLS = [
  'id', 'org_id', 'patient_id', 'code', 'code_system', 'display',
  'allergy_type', 'category', 'criticality', 'clinical_status',
  'verification_status', 'reaction_description', 'onset_date',
  'notes', 'source', 'fhir_resource_id',
  'created_at', 'updated_at',
];

async function listForPatient(client, ctx, patientId, { limit = 100 } = {}) {
  const r = await client.query(
    `SELECT ${COLS.join(',')} FROM patient_allergies
     WHERE org_id = $1 AND patient_id = $2
     ORDER BY criticality DESC NULLS LAST, created_at DESC
     LIMIT $3`,
    [ctx.orgId, patientId, limit],
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
    `INSERT INTO patient_allergies (${cols.join(',')}) VALUES (${ph})
     RETURNING ${COLS.join(',')}`,
    vals,
  );
  await audit.record(client, ctx, {
    action: 'allergy.create',
    entityType: 'patient_allergy',
    entityId: r.rows[0].id,
    details: {
      display: r.rows[0].display,
      criticality: r.rows[0].criticality,
      source: r.rows[0].source,
    },
  });
  return r.rows[0];
}

module.exports = { listForPatient, create, COLS };
