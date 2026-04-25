'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const ingestMod = require('../hl7/ingest');
const { parseMessage, buildAck } = require('../../../electron/services/hl7v2.cjs');

module.exports = async function hl7Routes(app) {
  app.get('/hl7/messages',
    { preHandler: requireRole('admin', 'coordinator') },
    async (req) => {
      const q = z.object({
        limit:  z.coerce.number().int().positive().max(500).optional(),
        status: z.string().optional(),
      }).parse(req.query);
      const limit = q.limit || 100;
      return withTransaction(req.auth, async (client) => {
        const params = [req.auth.orgId];
        let where = 'org_id = $1';
        if (q.status) { params.push(q.status); where += ` AND processed_status = $${params.length}`; }
        params.push(limit);
        const r = await client.query(
          `SELECT id, direction, transport, sending_app, sending_facility,
                  message_type, trigger_event, message_control_id,
                  processed_status, ack_code, ack_message,
                  peer_address, received_at, processed_at
           FROM hl7_messages WHERE ${where}
           ORDER BY received_at DESC LIMIT $${params.length}`,
          params
        );
        return r.rows;
      });
    });

  app.get('/hl7/messages/:id',
    { preHandler: requireRole('admin', 'coordinator') },
    async (req) => {
      const id = z.string().uuid().parse(req.params.id);
      return withTransaction(req.auth, async (client) => {
        const r = await client.query(
          `SELECT * FROM hl7_messages WHERE org_id = $1 AND id = $2`,
          [req.auth.orgId, id]
        );
        return r.rows[0] || null;
      });
    });

  // Manual paste-and-ingest (mirrors the Electron Inbox).
  app.post('/hl7/ingest',
    { preHandler: requireRole('admin', 'coordinator', 'physician') },
    async (req) => {
      const body = z.object({ message: z.string().min(8) }).parse(req.body);
      const parsed = parseMessage(body.message);
      const result = await ingestMod.ingest({
        rawMessage: body.message,
        parsed,
        ctx: req.auth,
        peer: { address: req.ip },
        transport: 'rest',
      });
      const ack = buildAck(parsed, result.ackCode, result.ackText);
      return { ...result, parsed, ack };
    });
};
