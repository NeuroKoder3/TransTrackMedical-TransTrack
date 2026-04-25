'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const audit = require('../services/auditService');

module.exports = async function auditRoutes(app) {
  app.get('/audit', { preHandler: requireRole('admin', 'regulator') }, async (req) => {
    const q = z.object({
      limit:  z.coerce.number().int().positive().max(1000).optional(),
      action: z.string().optional(),
      user:   z.string().optional(),
    }).parse(req.query);
    const limit = q.limit || 200;
    return withTransaction(req.auth, async (client) => {
      const params = [req.auth.orgId];
      let where = 'org_id = $1';
      if (q.action) { params.push(q.action + '%'); where += ` AND action LIKE $${params.length}`; }
      if (q.user)   { params.push(q.user);         where += ` AND user_email = $${params.length}`; }
      params.push(limit);
      const r = await client.query(
        `SELECT id, action, entity_type, entity_id, patient_name, details,
                user_email, user_role, ip_address, created_at, prev_hash, record_hash
         FROM audit_logs WHERE ${where}
         ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      return r.rows;
    });
  });

  app.get('/audit/verify',
    { preHandler: requireRole('admin', 'regulator') },
    async (req) =>
      withTransaction(req.auth, async (client) => audit.verifyChain(client, req.auth.orgId)));
};
