'use strict';

const audit = require('./auditService');

const COLS = [
  'id', 'org_id', 'patient_id', 'test_code', 'test_name', 'value', 'units',
  'reference_range', 'abnormal_flag', 'result_status', 'collected_at',
  'resulted_at', 'source', 'source_message_id', 'ordering_service',
  'entered_by', 'created_at', 'updated_at', 'updated_by',
];

async function listForPatient(client, ctx, patientId, { limit = 100, testCode } = {}) {
  const params = [ctx.orgId, patientId];
  let where = 'org_id = $1 AND patient_id = $2';
  if (testCode) {
    params.push(testCode);
    where += ` AND test_code = $${params.length}`;
  }
  params.push(limit);
  const r = await client.query(
    `SELECT ${COLS.join(',')} FROM lab_results
     WHERE ${where} ORDER BY collected_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

async function create(client, ctx, input) {
  const cols = ['org_id', 'entered_by'];
  const vals = [ctx.orgId, ctx.userId || null];
  for (const k of Object.keys(input)) {
    if (COLS.includes(k) && k !== 'id' && k !== 'org_id') {
      cols.push(k);
      vals.push(input[k]);
    }
  }
  const ph = vals.map((_, i) => `$${i + 1}`).join(',');
  const r = await client.query(
    `INSERT INTO lab_results (${cols.join(',')}) VALUES (${ph}) RETURNING ${COLS.join(',')}`,
    vals
  );
  await audit.record(client, ctx, {
    action: 'lab.create', entityType: 'lab_result', entityId: r.rows[0].id,
    details: { test_code: r.rows[0].test_code, source: r.rows[0].source },
  });
  return r.rows[0];
}

/**
 * Bulk-insert OBX rows from a parsed HL7 ORU^R01 message.
 */
async function ingestFromHl7(client, ctx, { patientId, parsed, sourceMessageId }) {
  const created = [];
  for (const obx of parsed.observations || []) {
    if (!obx.test_code || obx.value === null || obx.value === undefined) continue;
    created.push(await create(client, ctx, {
      patient_id: patientId,
      test_code: obx.test_code,
      test_name: obx.test_name || obx.test_code,
      value: String(obx.value),
      units: obx.unit,
      reference_range: obx.reference_range,
      abnormal_flag: obx.abnormal_flag || null,
      result_status: obx.result_status || null,
      collected_at: obx.observation_datetime || new Date().toISOString(),
      resulted_at: obx.observation_datetime || null,
      source: 'HL7_V2',
      source_message_id: sourceMessageId,
      ordering_service: parsed.sending_app || null,
    }));
  }
  return created;
}

module.exports = { listForPatient, create, ingestFromHl7, COLS };
