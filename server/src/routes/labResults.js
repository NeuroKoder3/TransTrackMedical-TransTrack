'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const svc = require('../services/labResultService');
const { requireRole } = require('../middleware/auth');

module.exports = async function labRoutes(app) {
  app.get('/patients/:patientId/labs', async (req) => {
    const params = z.object({ patientId: z.string().uuid() }).parse(req.params);
    const q = z.object({
      limit: z.coerce.number().int().positive().max(500).optional(),
      testCode: z.string().optional(),
    }).parse(req.query);
    return withTransaction(req.auth, async (client) =>
      svc.listForPatient(client, req.auth, params.patientId, q));
  });

  app.post('/patients/:patientId/labs',
    { preHandler: requireRole('admin', 'coordinator', 'physician') },
    async (req) => {
      const params = z.object({ patientId: z.string().uuid() }).parse(req.params);
      const body = z.object({
        test_code: z.string().min(1),
        test_name: z.string().min(1),
        value: z.string().min(1),
        units: z.string().optional(),
        reference_range: z.string().optional(),
        abnormal_flag: z.string().optional(),
        result_status: z.string().optional(),
        collected_at: z.string(),
        resulted_at: z.string().optional(),
        ordering_service: z.string().optional(),
      }).parse(req.body);
      body.patient_id = params.patientId;
      body.source = body.source || 'MANUAL';
      return withTransaction(req.auth, async (client) =>
        svc.create(client, req.auth, body));
    });
};
