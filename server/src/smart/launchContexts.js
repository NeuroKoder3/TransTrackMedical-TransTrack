'use strict';

/**
 * Server-side SMART launch context store (M-11).
 *
 * The EHR launch parameter is resolved once at GET /oauth2/authorize and the
 * result is written here. The consent page then carries only an opaque
 * handle. At POST /oauth2/authorize the context is read back by handle, so
 * the patient a code is issued against is always the one the launch resolved
 * to — a client cannot substitute another patient by editing the form.
 *
 * Handles are single-use and short-lived: one handle covers one consent
 * interaction.
 */

const { randomBytes, createHash } = require('crypto');
const { getPool } = require('../db/pool');

const DEFAULT_TTL_SECONDS = 600;
const PURGE_INTERVAL_MS = 60 * 1000;
let lastPurge = 0;

function newHandle() {
  return randomBytes(24).toString('base64url');
}

function hash(handle) {
  return createHash('sha256').update(handle).digest('hex');
}

/**
 * Persist a resolved launch context and return its handle. Returns null when
 * the launch resolved to nothing at all, so callers do not mint handles for
 * empty contexts.
 */
async function issue({ orgId, clientId, context, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const ctx = context && typeof context === 'object' ? context : {};
  if (Object.keys(ctx).length === 0) return null;
  const handle = newHandle();
  await getPool().query(
    `INSERT INTO smart_launch_contexts
       (handle_hash, org_id, client_id, context, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
    [hash(handle), orgId, clientId, JSON.stringify(ctx), ttlSeconds]
  );
  void purgeExpired();
  return handle;
}

/**
 * Redeem a handle. Returns the stored context, or null when the handle is
 * unknown, expired, already used, or was issued to a different client.
 * Never throws on a bad handle: the caller treats "no context" as "no launch
 * context", which is the safe interpretation.
 */
async function consume(handle, { clientId } = {}) {
  if (!handle || typeof handle !== 'string') return null;
  const r = await getPool().query(
    `UPDATE smart_launch_contexts
        SET consumed_at = now()
      WHERE handle_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
        AND client_id = $2
      RETURNING context`,
    [hash(handle), clientId]
  );
  return r.rows[0]?.context || null;
}

/**
 * Drop handles that can no longer be redeemed. Throttled so a burst of
 * launches does not issue a DELETE apiece; failures are ignored because this
 * is housekeeping and a stale row is already unredeemable.
 */
async function purgeExpired() {
  const now = Date.now();
  if (now - lastPurge < PURGE_INTERVAL_MS) return 0;
  lastPurge = now;
  try {
    const r = await getPool().query(
      `DELETE FROM smart_launch_contexts WHERE expires_at < now()`
    );
    return r.rowCount || 0;
  } catch {
    return 0;
  }
}

/** Test seam: forget when the last purge ran. */
function resetPurgeClock() {
  lastPurge = 0;
}

module.exports = { issue, consume, purgeExpired, resetPurgeClock };
