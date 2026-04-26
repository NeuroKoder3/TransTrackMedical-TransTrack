'use strict';

/**
 * FHIR Bulk Data Access ($export) implementation.
 *
 * Implements the kickoff/poll/download flow per the HL7 Bulk Data spec:
 *   1. Client kicks off:  POST /fhir/$export   (system-level)
 *                         POST /fhir/Patient/$export
 *                         POST /fhir/Group/<id>/$export
 *      Returns 202 with a Content-Location header pointing at the poll URL.
 *
 *   2. Client polls:      GET <Content-Location>
 *      Returns 202 with X-Progress while in-progress; 200 with manifest JSON
 *      when complete; 4xx/5xx on error.
 *
 *   3. Client downloads:  GET <manifest.output[i].url>
 *      Streams NDJSON.
 *
 * For initial production-ready release the export is run inline (synchronous-
 * but-deferred) inside a single transaction — adequate for tens of thousands
 * of resources. A queued worker can be substituted by replacing runJob().
 */

const { withTransaction } = require('../db/pool');

async function kickoff(ctx, { exportType, types, since, groupId }) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `INSERT INTO bulk_export_jobs
         (org_id, requested_by, requested_via_client,
          export_type, group_id, types_requested, since,
          out_format, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued', now() + interval '7 days')
       RETURNING id, requested_at`,
      [
        ctx.orgId,
        ctx.userId || null,
        ctx.smart?.clientId || null,
        exportType,
        groupId || null,
        JSON.stringify(types || []),
        since || null,
        'application/fhir+ndjson',
      ]
    );
    return r.rows[0];
  });
}

async function status(ctx, jobId) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `SELECT id, export_type, group_id, types_requested, since, status,
              progress_percent, error_message, requested_at, started_at,
              completed_at, expires_at
       FROM bulk_export_jobs WHERE org_id = $1 AND id = $2`,
      [ctx.orgId, jobId]
    );
    return r.rows[0] || null;
  });
}

async function listFiles(ctx, jobId) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `SELECT id, resource_type, file_index, resource_count, byte_size
       FROM bulk_export_files
       WHERE job_id = (SELECT id FROM bulk_export_jobs
                        WHERE org_id = $1 AND id = $2)
       ORDER BY resource_type, file_index`,
      [ctx.orgId, jobId]
    );
    return r.rows;
  });
}

async function getFileContent(ctx, fileId) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `SELECT f.content, f.resource_type FROM bulk_export_files f
       JOIN bulk_export_jobs j ON j.id = f.job_id
       WHERE j.org_id = $1 AND f.id = $2`,
      [ctx.orgId, fileId]
    );
    return r.rows[0] || null;
  });
}

/**
 * Run the export. This is invoked synchronously by the kickoff route after
 * 202 has been sent; queued in a real deployment.
 *
 * Resource selection rules:
 *   exportType=system  -> all FHIR resources for org
 *   exportType=patient -> all resources whose subject/patient = some Patient/<id> in org
 *   exportType=group   -> resources for patients listed in the named Group
 */
async function runJob(ctx, jobId) {
  const job = await status(ctx, jobId);
  if (!job) return;
  await markRunning(ctx, jobId);

  try {
    await withTransaction(ctx, async (client) => {
      const types = job.types_requested?.length
        ? job.types_requested
        : await defaultTypes(client, ctx);

      // Patients-of-interest determination
      let patientIds = null;
      if (job.export_type === 'patient') {
        const r = await client.query(
          `SELECT resource_id FROM fhir_resources
           WHERE org_id = $1 AND resource_type = 'Patient' AND deleted = FALSE
                 ${job.since ? 'AND last_updated >= $2' : ''}`,
          job.since ? [ctx.orgId, job.since] : [ctx.orgId]
        );
        patientIds = r.rows.map(x => x.resource_id);
      } else if (job.export_type === 'group') {
        const grp = await client.query(
          `SELECT body FROM fhir_resources
           WHERE org_id = $1 AND resource_type = 'Group' AND resource_id = $2 AND deleted = FALSE`,
          [ctx.orgId, job.group_id]
        );
        const members = grp.rows[0]?.body?.member || [];
        patientIds = members
          .map(m => m.entity?.reference || '')
          .filter(r => r.startsWith('Patient/'))
          .map(r => r.replace(/^Patient\//, ''));
      }

      let totalTypes = types.length;
      let typesProcessed = 0;
      for (const type of types) {
        await exportType(client, ctx, jobId, type, { since: job.since, patientIds });
        typesProcessed++;
        await client.query(
          `UPDATE bulk_export_jobs SET progress_percent = $1 WHERE id = $2`,
          [Math.round((typesProcessed / totalTypes) * 100), jobId]
        );
      }
    });
    await markCompleted(ctx, jobId);
  } catch (e) {
    await markFailed(ctx, jobId, e.message);
    throw e;
  }
}

async function defaultTypes(client, ctx) {
  const r = await client.query(
    `SELECT DISTINCT resource_type FROM fhir_resources
     WHERE org_id = $1 AND deleted = FALSE
     ORDER BY resource_type`,
    [ctx.orgId]
  );
  return r.rows.map(x => x.resource_type);
}

async function exportType(client, ctx, jobId, resourceType, { since, patientIds }) {
  const params = [ctx.orgId, resourceType];
  let where = `org_id = $1 AND resource_type = $2 AND deleted = FALSE`;
  if (since) {
    params.push(since);
    where += ` AND last_updated >= $${params.length}::timestamptz`;
  }
  if (patientIds && resourceType !== 'Patient') {
    // Best-effort scope: filter by subject/patient reference matching one of the patient ids
    const refs = patientIds.map(id => `Patient/${id}`);
    params.push(refs);
    where += ` AND (
      body->'subject'->>'reference' = ANY($${params.length}::text[])
      OR body->'patient'->>'reference' = ANY($${params.length}::text[])
    )`;
  }
  if (patientIds && resourceType === 'Patient') {
    params.push(patientIds);
    where += ` AND resource_id = ANY($${params.length}::text[])`;
  }
  const r = await client.query(
    `SELECT body FROM fhir_resources WHERE ${where} ORDER BY last_updated`,
    params
  );
  if (!r.rows.length) return;
  const ndjsonChunks = [];
  for (const row of r.rows) ndjsonChunks.push(JSON.stringify(row.body));
  const content = Buffer.from(ndjsonChunks.join('\n') + '\n', 'utf8');
  await client.query(
    `INSERT INTO bulk_export_files
       (job_id, resource_type, file_index, resource_count, byte_size, content)
     VALUES ($1, $2, 0, $3, $4, $5)`,
    [jobId, resourceType, r.rows.length, content.length, content]
  );
}

async function markRunning(ctx, jobId) {
  return withTransaction(ctx, async (client) => {
    await client.query(
      `UPDATE bulk_export_jobs
         SET status='in-progress', started_at = now()
       WHERE org_id = $1 AND id = $2 AND status='queued'`,
      [ctx.orgId, jobId]
    );
  });
}

async function markCompleted(ctx, jobId) {
  return withTransaction(ctx, async (client) => {
    await client.query(
      `UPDATE bulk_export_jobs
         SET status='completed', progress_percent=100, completed_at = now()
       WHERE org_id = $1 AND id = $2`,
      [ctx.orgId, jobId]
    );
  });
}

async function markFailed(ctx, jobId, message) {
  return withTransaction(ctx, async (client) => {
    await client.query(
      `UPDATE bulk_export_jobs
         SET status='failed', error_message=$3, completed_at = now()
       WHERE org_id = $1 AND id = $2`,
      [ctx.orgId, jobId, message]
    );
  });
}

async function cancel(ctx, jobId) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `UPDATE bulk_export_jobs
         SET status='cancelled', completed_at = now()
       WHERE org_id = $1 AND id = $2 AND status IN ('queued','in-progress')
       RETURNING id`,
      [ctx.orgId, jobId]
    );
    return r.rows[0] || null;
  });
}

module.exports = { kickoff, status, listFiles, getFileContent, runJob, cancel };
