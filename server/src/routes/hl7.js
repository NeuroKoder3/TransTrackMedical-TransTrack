'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const ingestMod = require('../hl7/ingest');
const { parseMessage, buildAck } = require('../hl7/messageParser');
const messageTypes = require('../hl7/messageTypes');
const vendorProfileService = require('../services/vendorProfileService');

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
      let parsed = parseMessage(body.message);
      try {
        const profile = await vendorProfileService.findFor(req.auth, parsed.sending_app, parsed.sending_facility);
        if (profile) parsed = parseMessage(body.message, profile);
      } catch (_e) { /* ignore */ }
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

  // Discovery: which message types do we currently accept?
  app.get('/hl7/supported-types', async () => ({
    supported: messageTypes.listSupported(),
  }));

  // Vendor profile management
  app.get('/hl7/vendor-profiles',
    { preHandler: requireRole('admin') },
    async (req) => vendorProfileService.list(req.auth));

  app.post('/hl7/vendor-profiles',
    { preHandler: requireRole('admin') },
    async (req) => {
      const body = z.object({
        vendor_name: z.string().min(1),
        sending_app_pattern: z.string().min(1),
        mrn_authority: z.string().optional(),
        config: z.record(z.any()).optional(),
        is_active: z.boolean().optional(),
      }).parse(req.body);
      return vendorProfileService.create(req.auth, body);
    });

  app.put('/hl7/vendor-profiles/:id',
    { preHandler: requireRole('admin') },
    async (req) => {
      const id = z.string().uuid().parse(req.params.id);
      return vendorProfileService.update(req.auth, id, req.body || {});
    });

  app.delete('/hl7/vendor-profiles/:id',
    { preHandler: requireRole('admin') },
    async (req) => {
      const id = z.string().uuid().parse(req.params.id);
      return vendorProfileService.remove(req.auth, id);
    });

  app.post('/hl7/vendor-profiles/seed-defaults',
    { preHandler: requireRole('admin') },
    async (req) => vendorProfileService.seedDefaults(req.auth));
};
