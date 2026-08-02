'use strict';

/**
 * Replay cache for SMART Backend Services client assertions (L-14).
 *
 * verifyAssertion required a `jti` but never recorded one, so a captured
 * assertion could be presented again and again until its `exp` — which the
 * spec allows to be several minutes out. Requiring an identifier without
 * remembering it provides no replay protection at all.
 *
 * Uniqueness is enforced by the (client_id, jti) primary key, so two
 * concurrent redemptions of the same assertion cannot both win: exactly one
 * INSERT inserts a row, and the other sees the conflict.
 */

const { getPool } = require('../db/pool');

const PURGE_INTERVAL_MS = 60 * 1000;
let lastPurge = 0;

/**
 * Record a jti as used. Returns true when this is the first time it has been
 * seen for this client, false when it is a replay.
 *
 * Throws if the store is unreachable — an assertion that cannot be checked
 * for replay is not accepted.
 */
async function remember({ clientId, jti, expiresAtSeconds }) {
  const r = await getPool().query(
    `INSERT INTO smart_client_assertion_jtis (client_id, jti, expires_at)
     VALUES ($1, $2, to_timestamp($3))
     ON CONFLICT (client_id, jti) DO NOTHING
     RETURNING jti`,
    [clientId, jti, expiresAtSeconds]
  );
  const first = r.rowCount > 0;
  if (first) void maybePurge();
  return first;
}

/**
 * Drop rows whose assertion could no longer be accepted anyway. Throttled so
 * a busy token endpoint does not issue a DELETE per request; failures are
 * ignored because this is housekeeping, not a control.
 */
async function maybePurge() {
  const now = Date.now();
  if (now - lastPurge < PURGE_INTERVAL_MS) return 0;
  lastPurge = now;
  try {
    const r = await getPool().query(
      `DELETE FROM smart_client_assertion_jtis WHERE expires_at < now()`
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

module.exports = { remember, maybePurge, resetPurgeClock };
