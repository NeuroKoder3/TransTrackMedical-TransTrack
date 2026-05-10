'use strict';

const { getPool } = require('../db/pool');

// Health/readiness endpoints are intentionally generous — they are polled
// by k8s, load balancers, and uptime monitors — but they MUST still be
// rate-limited per-IP so a hostile client can't use them as a DoS amplifier
// or to exhaust the connection pool by spamming `SELECT 1` against pg.
// 600 req / 1 min / IP is roughly 10 req/sec, which is plenty for any
// real probe but well below what's needed to weaponise the endpoint.
//
// Closes CodeQL alert js/missing-rate-limiting on this file.
const HEALTH_RATE_LIMIT = { max: 600, timeWindow: '1 minute' };

module.exports = async function healthRoutes(app) {
  app.get('/health', {
    config: { public: true, rateLimit: HEALTH_RATE_LIMIT },
  }, async () => ({
    status: 'ok',
    time: new Date().toISOString(),
  }));

  app.get('/ready', {
    config: { public: true, rateLimit: HEALTH_RATE_LIMIT },
  }, async (_req, reply) => {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ready', time: new Date().toISOString() };
    } catch (e) {
      reply.code(503);
      return { status: 'not_ready', error: e.message };
    }
  });
};
