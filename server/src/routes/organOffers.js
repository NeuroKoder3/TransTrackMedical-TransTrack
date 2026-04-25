'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const svc = require('../services/organOfferService');
const { requireRole } = require('../middleware/auth');

module.exports = async function organOfferRoutes(app) {
  app.get('/organ-offers', async (req) => {
    const q = z.object({
      status: z.string().optional(),
      patientId: z.string().uuid().optional(),
      limit: z.coerce.number().int().positive().max(500).optional(),
    }).parse(req.query);
    return withTransaction(req.auth, async (client) => svc.list(client, req.auth, q));
  });

  app.post('/organ-offers', { preHandler: requireRole('admin', 'coordinator', 'physician') }, async (req) => {
    const body = z.object({
      donor_organ_id: z.string().uuid().optional(),
      patient_id: z.string().uuid().optional(),
      optn_match_id: z.string().optional(),
      sequence_number: z.number().int().optional(),
      response_due_at: z.string().optional(),
      cold_ischemia_hours: z.number().optional(),
      notes: z.string().optional(),
    }).parse(req.body);
    return withTransaction(req.auth, async (client) => svc.create(client, req.auth, body));
  });

  app.post('/organ-offers/:id/:action', { preHandler: requireRole('admin', 'coordinator', 'physician') },
    async (req) => {
      const params = z.object({
        id: z.string().uuid(),
        action: z.enum(['accept', 'decline', 'expire', 'implant', 'backup']),
      }).parse(req.params);
      const body = z.object({
        decline_code: z.string().optional(),
        decline_reason: z.string().optional(),
        cold_ischemia_hours: z.number().optional(),
      }).parse(req.body || {});
      return withTransaction(req.auth, async (client) =>
        svc.transition(client, req.auth, params.id, params.action, body));
    });
};
