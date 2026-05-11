'use strict';

const { getPool } = require('../db/pool');

module.exports = async function healthRoutes(app) {
  app.get('/health', { config: { public: true, rateLimit: { max: 120, timeWindow: '1 minute' } } }, async () => ({
    status: 'ok',
    time: new Date().toISOString(),
  }));

  app.get('/ready', { config: { public: true, rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_req, reply) => {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ready', time: new Date().toISOString() };
    } catch (e) {
      reply.code(503);
      return { status: 'not_ready', error: e.message };
    }
  });
};
