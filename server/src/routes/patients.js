'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const svc = require('../services/patientService');
const { requireRole } = require('../middleware/auth');
const { errors } = require('../util/errors');

module.exports = async function patientRoutes(app) {
  app.get('/patients', async (req) => {
    const q = z.object({
      limit: z.coerce.number().int().positive().max(500).optional(),
      offset: z.coerce.number().int().nonnegative().optional(),
      search: z.string().optional(),
      organ: z.string().optional(),
      status: z.string().optional(),
    }).parse(req.query);
    return withTransaction(req.auth, async (client) => svc.list(client, req.auth, q));
  });

  app.get('/patients/:id', async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    const r = await withTransaction(req.auth, async (client) => svc.get(client, req.auth, id));
    if (!r) throw errors.notFound();
    return r;
  });

  app.post('/patients', { preHandler: requireRole('admin', 'coordinator', 'physician') }, async (req) => {
    const body = z.object({
      mrn: z.string().min(1).optional(),
      first_name: z.string().min(1),
      last_name: z.string().min(1),
      date_of_birth: z.string().optional(),
      sex: z.string().optional(),
      blood_type: z.string().optional(),
      organ_needed: z.string().optional(),
      medical_urgency: z.string().optional(),
      waitlist_status: z.string().optional(),
      diagnosis: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      notes: z.string().optional(),
    }).passthrough().parse(req.body);
    return withTransaction(req.auth, async (client) => svc.create(client, req.auth, body));
  });

  app.patch('/patients/:id', { preHandler: requireRole('admin', 'coordinator', 'physician') }, async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({}).passthrough().parse(req.body);
    return withTransaction(req.auth, async (client) => svc.update(client, req.auth, id, body));
  });
};
