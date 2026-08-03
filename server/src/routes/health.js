'use strict';

const { getPool } = require('../db/pool');

module.exports = async function healthRoutes(app) {
  app.get('/health', { config: { public: true, rateLimit: { max: 120, timeWindow: '1 minute' } } }, async () => ({
    status: 'ok',
    time: new Date().toISOString(),
  }));

  app.get('/ready', { config: { public: true, rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ready', time: new Date().toISOString() };
    } catch (err) {
      // L-8: /ready is public and unauthenticated. The driver's message
      // carries the host, port, database and role of the connection, so it
      // goes to the log and not to the caller.
      req.log.error({ err }, 'readiness probe failed');
      reply.code(503);
      return { status: 'not_ready', time: new Date().toISOString() };
    }
  });
};
