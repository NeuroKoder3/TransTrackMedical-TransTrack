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
const dns = require('dns');
const { withTransaction, getPool } = require('../db/pool');

let _logger = null;
function setLogger(logger) { _logger = logger; }
function log() { return _logger || console; }

const FORBIDDEN_HEADER_NAMES = new Set([
  'host', 'content-length', 'transfer-encoding', 'connection',
  'keep-alive', 'upgrade', 'proxy-authorization', 'te',
]);

function sanitizeHeaders(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const clean = {};
  for (const [k, v] of Object.entries(raw)) {
    const lower = k.toLowerCase();
    if (FORBIDDEN_HEADER_NAMES.has(lower)) continue;
    const sv = String(v).replace(/[\r\n]/g, '');
    clean[k] = sv;
  }
  return clean;
}

const PRIVATE_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^0\./, /^169\.254\./, /^::1$/, /^fc00:/i, /^fe80:/i, /^fd/i,
];

function isPrivateIp(ip) {
  return PRIVATE_RANGES.some(r => r.test(ip));
}

/**
 * Resolve and validate the subscription endpoint URL.
 * In production, HTTPS is mandatory. DNS is resolved once and pinned
 * (custom agent connects to the validated IP with original hostname for SNI).
 */
async function resolveAndValidateUrl(endpoint, { requireHttps = false } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('unsupported protocol');
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new Error('subscription endpoints must use HTTPS in production');
  }
  const addresses = await dns.promises.resolve4(url.hostname).catch(() => []);
  const addresses6 = await dns.promises.resolve6(url.hostname).catch(() => []);
  const all = [...addresses, ...addresses6];
  if (all.length === 0) {
    throw new Error(`DNS resolution failed for ${url.hostname}`);
  }
  if (all.some(isPrivateIp)) {
    throw new Error('subscription endpoint resolves to private IP');
  }
  // Pin resolved IP for the request
  url._pinnedIp = addresses[0] || addresses6[0];
  return url;
}

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
 * Drain pending deliveries using FOR UPDATE SKIP LOCKED to safely allow
 * multiple dispatchers without double-delivery. Called periodically by
 * startDispatcher() and immediately after notify().
 */
async function dispatchPending(maxBatch = 50) {
  const isProduction = process.env.NODE_ENV === 'production';
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE fhir_subscription_deliveries
         SET status = 'in_progress'
       WHERE id IN (
         SELECT d.id FROM fhir_subscription_deliveries d
         WHERE d.status IN ('pending','retrying')
           AND d.attempt_count < 5
           AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
         ORDER BY d.created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, subscription_id, org_id, event_type, triggering_resource, attempt_count`,
      [maxBatch]
    );
    await client.query('COMMIT');

    for (const row of r.rows) {
      const sub = await getPool().query(
        `SELECT endpoint, channel_type, header, payload_mime FROM fhir_subscriptions WHERE id = $1`,
        [row.subscription_id]
      );
      const s = sub.rows[0];
      if (!s || s.channel_type !== 'rest-hook' || !s.endpoint) {
        await markFailed(row.id, 'unsupported channel');
        continue;
      }
      await deliverOne({ ...row, ...s }, { requireHttps: isProduction });
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    log().error?.({ err: err.message }, 'subscription dispatch batch error');
  } finally {
    client.release();
  }
}

async function deliverOne(row, { requireHttps = false } = {}) {
  const [type, id] = String(row.triggering_resource).split('/');
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
    ...sanitizeHeaders(row.header),
  };

  let url;
  try {
    url = await resolveAndValidateUrl(row.endpoint, { requireHttps });
  } catch (e) {
    log().error?.({ subscriptionId: row.subscription_id, attempt: row.attempt_count, err: e.message },
      'subscription endpoint validation failed');
    await markFailed(row.id, e.message || 'invalid endpoint url');
    return;
  }

  await new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: 'POST',
      hostname: url._pinnedIp || url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: { ...headers, Host: url.hostname },
      timeout: 10_000,
      servername: url.hostname,
    };
    const req = lib.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          markDelivered(row.id, res.statusCode, body).finally(resolve);
        } else {
          log().warn?.({ subscriptionId: row.subscription_id, attempt: row.attempt_count + 1,
            status: res.statusCode }, 'subscription delivery non-2xx');
          markRetry(row.id, res.statusCode, body, row.attempt_count).finally(resolve);
        }
      });
    });
    req.on('error', (err) => {
      log().error?.({ subscriptionId: row.subscription_id, attempt: row.attempt_count + 1,
        err: err.message }, 'subscription delivery network error');
      markRetry(row.id, 0, err.message, row.attempt_count).finally(resolve);
    });
    req.on('timeout', () => {
      req.destroy();
      log().warn?.({ subscriptionId: row.subscription_id, attempt: row.attempt_count + 1 },
        'subscription delivery timeout');
      markRetry(row.id, 0, 'timeout', row.attempt_count).finally(resolve);
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
async function markRetry(id, status, body, currentAttempt = 0) {
  const nextAttempt = currentAttempt + 1;
  const backoffSeconds = Math.min(30 * Math.pow(2, nextAttempt), 3600);
  await getPool().query(
    `UPDATE fhir_subscription_deliveries
        SET status = CASE WHEN attempt_count + 1 >= 5 THEN 'failed' ELSE 'retrying' END,
            last_attempt_at = now(),
            attempt_count = attempt_count + 1,
            next_attempt_at = now() + ($4 || ' seconds')::interval,
            response_status = $2, response_body = $3
      WHERE id = $1`,
    [id, status, String(body || '').slice(0, 4096), String(backoffSeconds)]
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

let _dispatchTimer = null;

function startDispatcher(intervalMs = 5000) {
  if (dispatcherStarted) return _dispatchTimer;
  dispatcherStarted = true;
  _dispatchTimer = setInterval(() => { dispatchPending().catch(() => {}); }, intervalMs);
  _dispatchTimer.unref();
  return _dispatchTimer;
}

module.exports = { matches, notify, dispatchPending, startDispatcher, setLogger };
