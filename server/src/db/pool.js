'use strict';

const { Pool } = require('pg');

let pool = null;

function init(config, logger) {
  if (pool) return pool;
  const ssl = config.PGSSL === 'disable' ? false : { rejectUnauthorized: config.PGSSL !== 'disable' };
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

async function shutdown() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { init, getPool, query, withTransaction, shutdown };
