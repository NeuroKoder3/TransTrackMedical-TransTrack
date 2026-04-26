'use strict';

/**
 * FHIR R4 Subscriptions delivery engine.
 *
 * The criteria language we support is the basic FHIR R4 search-style format:
 *   "ResourceType?paramName=value&otherParam=value"
 *
 * For each created/updated resource we evaluate every active subscription's
 * criteria. On match, we enqueue a delivery in fhir_subscription_deliveries
 * and (if this process owns the dispatcher) immediately POST to the endpoint.
 *
 * REST-hook notification body uses an empty Bundle with type=history per
 * the R4 baseline; full-payload deliveries (R5 backport) include the
 * triggering resource as the first entry.
 */

const https = require('https');
const http = require('http');
const { withTransaction, getPool } = require('../db/pool');

let dispatcherStarted = false;

/**
 * Evaluate a subscription criteria string against a candidate resource.
 * Returns true on match.
 */
function matches(criteria, resource) {
  if (!criteria || !resource) return false;
  const [type, qs] = criteria.split('?');
  if (type !== resource.resourceType) return false;
  if (!qs) return true;
  const params = new URLSearchParams(qs);
  for (const [key, val] of params.entries()) {
    if (!matchesParam(resource, key, val)) return false;
  }
  return true;
}

function matchesParam(resource, key, val) {
  switch (key) {
    case '_id': return resource.id === val;
    case 'patient':
    case 'subject': {
      const ref = resource.subject?.reference || resource.patient?.reference;
      if (!ref) return false;
      return ref === val || ref.endsWith(`/${val}`) || ref === `Patient/${val}`;
    }
    case 'status': return resource.status === val;
    case 'category': {
      return (resource.category || []).some(c =>
        (c.coding || []).some(cc => cc.code === val || `${cc.system}|${cc.code}` === val)
      );
    }
    case 'code': {
      const coding = resource.code?.coding || [];
      return coding.some(c => c.code === val || `${c.system}|${c.code}` === val);
    }
    case 'identifier': {
      return (resource.identifier || []).some(id =>
        id.value === val || `${id.system}|${id.value}` === val
      );
    }
    default:
      // Generic text-match against a top-level string field
      return String(resource[key] || '') === val;
  }
}

/**
 * Notify all active subscriptions in the org about a triggering resource.
 * Called from the FHIR storage layer after create/update.
 */
async function notify(ctx, resource, eventType /* 'create' | 'update' | 'delete' */) {
  await withTransaction(ctx, async (client) => {
    const r = await client.query(
      `SELECT id, criteria, channel_type, endpoint, header, payload_mime
       FROM fhir_subscriptions
       WHERE org_id = $1 AND status = 'active'`,
      [ctx.orgId]
    );
    for (const sub of r.rows) {
      if (!matches(sub.criteria, resource)) continue;
      await client.query(
        `INSERT INTO fhir_subscription_deliveries
           (subscription_id, org_id, event_type, triggering_resource, status)
         VALUES ($1,$2,$3,$4,'pending')`,
        [sub.id, ctx.orgId, eventType, `${resource.resourceType}/${resource.id}`]
      );
    }
  });
  // Trigger dispatch immediately so latency-sensitive callers see < 1s delivery
  setImmediate(() => dispatchPending().catch(() => {}));
}

/**
 * Drain pending deliveries. Called periodically by startDispatcher() and
 * immediately after notify().
 */
async function dispatchPending(maxBatch = 50) {
  const r = await getPool().query(
    `SELECT d.id, d.subscription_id, d.org_id, d.event_type, d.triggering_resource, d.attempt_count,
            s.endpoint, s.channel_type, s.header, s.payload_mime
     FROM fhir_subscription_deliveries d
     JOIN fhir_subscriptions s ON s.id = d.subscription_id
     WHERE d.status IN ('pending','retrying') AND d.attempt_count < 5
     ORDER BY d.created_at ASC
     LIMIT $1`,
    [maxBatch]
  );
  for (const row of r.rows) {
    if (row.channel_type !== 'rest-hook' || !row.endpoint) {
      await markFailed(row.id, 'unsupported channel');
      continue;
    }
    await deliverOne(row);
  }
}

async function deliverOne(row) {
  const [type, id] = String(row.triggering_resource).split('/');
  // Fetch the triggering resource for full-payload mode
  const resR = await getPool().query(
    `SELECT body FROM fhir_resources
     WHERE org_id = $1 AND resource_type = $2 AND resource_id = $3`,
    [row.org_id, type, id]
  );
  const triggering = resR.rows[0]?.body || null;

  const bundle = {
    resourceType: 'Bundle',
    type: 'history',
    timestamp: new Date().toISOString(),
    entry: triggering ? [
      {
        fullUrl: `${type}/${id}`,
        resource: triggering,
        request: {
          method: row.event_type === 'create' ? 'POST'
                : row.event_type === 'update' ? 'PUT' : 'DELETE',
          url: `${type}/${id}`,
        },
      },
    ] : [],
  };
  const payload = JSON.stringify(bundle);
  const headers = {
    'Content-Type': row.payload_mime || 'application/fhir+json',
    'Content-Length': Buffer.byteLength(payload),
    ...(row.header || {}),
  };

  await new Promise((resolve) => {
    let url;
    try { url = new URL(row.endpoint); }
    catch (e) {
      markFailed(row.id, 'invalid endpoint url').finally(resolve);
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers,
      timeout: 10_000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          markDelivered(row.id, res.statusCode, body).finally(resolve);
        } else {
          markRetry(row.id, res.statusCode, body).finally(resolve);
        }
      });
    });
    req.on('error', (err) => {
      markRetry(row.id, 0, err.message).finally(resolve);
    });
    req.on('timeout', () => {
      req.destroy();
      markRetry(row.id, 0, 'timeout').finally(resolve);
    });
    req.write(payload);
    req.end();
  });
}

async function markDelivered(id, status, body) {
  await getPool().query(
    `UPDATE fhir_subscription_deliveries
        SET status='delivered', last_attempt_at = now(),
            attempt_count = attempt_count + 1,
            response_status = $2, response_body = $3
      WHERE id = $1`,
    [id, status, String(body || '').slice(0, 4096)]
  );
}
async function markRetry(id, status, body) {
  await getPool().query(
    `UPDATE fhir_subscription_deliveries
        SET status = CASE WHEN attempt_count + 1 >= 5 THEN 'failed' ELSE 'retrying' END,
            last_attempt_at = now(),
            attempt_count = attempt_count + 1,
            response_status = $2, response_body = $3
      WHERE id = $1`,
    [id, status, String(body || '').slice(0, 4096)]
  );
}
async function markFailed(id, reason) {
  await getPool().query(
    `UPDATE fhir_subscription_deliveries
        SET status = 'failed', last_attempt_at = now(),
            attempt_count = attempt_count + 1,
            error_message = $2
      WHERE id = $1`,
    [id, reason]
  );
}

function startDispatcher(intervalMs = 5000) {
  if (dispatcherStarted) return;
  dispatcherStarted = true;
  setInterval(() => { dispatchPending().catch(() => {}); }, intervalMs).unref();
}

module.exports = { matches, notify, dispatchPending, startDispatcher };
