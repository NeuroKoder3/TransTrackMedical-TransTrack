'use strict';

const fs = require('fs');
const { Pool } = require('pg');

let pool = null;

/**
 * Build the `ssl` option for the pg pool (M-13).
 *
 * `require` used to mean `rejectUnauthorized: false`, which encrypts the
 * connection but accepts any certificate — so it stopped a passive listener
 * and nothing else. Both `require` and `verify-full` now verify the server
 * certificate against PGSSL_CA_FILE (or the Node trust store when unset);
 * `verify-full` additionally keeps hostname checking on, while `require`
 * tolerates a certificate issued to a different name (the usual reason to
 * pick it over `verify-full`).
 *
 * Skipping verification altogether requires PGSSL_ALLOW_UNVERIFIED, which
 * config.js refuses in production.
 */
function buildSslOptions(config) {
  if (config.PGSSL === 'disable') return false;

  if (config.PGSSL_ALLOW_UNVERIFIED) {
    return { rejectUnauthorized: false };
  }

  const ssl = { rejectUnauthorized: true };
  if (config.PGSSL_CA_FILE) {
    ssl.ca = fs.readFileSync(config.PGSSL_CA_FILE, 'utf8');
  }
  if (config.PGSSL === 'require') {
    // Verify the chain but not the hostname.
    ssl.checkServerIdentity = () => undefined;
  }
  return ssl;
}

function init(config, logger) {
  if (pool) return pool;
  const ssl = buildSslOptions(config);
  if (ssl && ssl.rejectUnauthorized === false && logger) {
    logger.warn('PGSSL_ALLOW_UNVERIFIED is set: the PostgreSQL server certificate is NOT verified');
  }
  pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.PG_POOL_MAX,
    idleTimeoutMillis: config.PG_IDLE_TIMEOUT_MS,
    ssl,
  });
  pool.on('error', (err) => {
    if (logger) logger.error({ err }, 'idle pg client error');
  });
  return pool;
}

function getPool() {
  if (!pool) throw new Error('pg pool not initialised');
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Run a callback inside a transaction. The callback receives a dedicated
 * pg client that must be used for all queries inside the transaction.
 * If a request context is supplied, app.current_org_id and app.current_user_id
 * are set as session variables so DB-level constraints / triggers / row-level
 * security policies can read them.
 */
async function withTransaction(ctx, callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (ctx?.orgId) {
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [ctx.orgId]);
    }
    if (ctx?.userId) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [ctx.userId]);
    }
    if (ctx?.userEmail) {
      await client.query(`SELECT set_config('app.current_user_email', $1, true)`, [ctx.userEmail]);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run a callback inside a transaction that declares itself as the Stripe
 * billing back-office (see migration 010). issued_licenses rows are keyed by
 * Stripe subscription rather than by tenant, so renewal and cancellation have
 * no org context to set; this marker is what the billing_webhook_issued_licenses
 * policy accepts instead.
 *
 * Only the signature-verified Stripe webhook handler may call this. No
 * request-driven code path sets app.billing_context, so an API caller cannot
 * obtain cross-tenant license access through it.
 */
async function withBillingContext(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.billing_context', 'stripe_webhook', true)`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function shutdown() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  init, getPool, query, withTransaction, withBillingContext, shutdown, buildSslOptions,
};
