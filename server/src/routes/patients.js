'use strict';

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const svc = require('../services/patientService');
const { requireRole } = require('../middleware/auth');
const { errors } = require('../util/errors');

/**
 * Writable patient fields (M-12).
 *
 * PATCH used to accept `z.object({}).passthrough()`, which let any caller
 * with write access set any allowlisted column — priority_score,
 * psychological_clearance, meld_score, waitlist_status and the rest — by
 * naming it in the body. The columns the service layer will persist are
 * therefore enumerated here with their types, and everything else is
 * dropped by Zod rather than forwarded.
 *
 * Server-owned columns (id, org_id, created_at/by, updated_at/by) are
 * deliberately absent.
 */
const jsonValue = z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(z.any()), z.record(z.any()),
]);

const PATIENT_FIELDS = {
  mrn: z.string().min(1),
  patient_id: z.string().min(1),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  middle_name: z.string(),
  date_of_birth: z.string(),
  sex: z.string(),
  blood_type: z.string(),
  organ_needed: z.string(),
  medical_urgency: z.string(),
  waitlist_status: z.string(),
  date_added_to_waitlist: z.string(),
  priority_score: z.number(),
  priority_score_breakdown: z.record(z.any()),
  hla_typing: jsonValue,
  pra_percentage: z.number(),
  cpra_percentage: z.number(),
  meld_score: z.number().int(),
  las_score: z.number(),
  functional_status: z.string(),
  prognosis_rating: z.string(),
  last_evaluation_date: z.string(),
  comorbidity_score: z.number().int(),
  previous_transplants: z.number().int().nonnegative(),
  compliance_score: z.number().int(),
  weight_kg: z.number(),
  height_cm: z.number(),
  phone: z.string(),
  email: z.string().email(),
  address: jsonValue,
  emergency_contact_name: z.string(),
  emergency_contact_phone: z.string(),
  diagnosis: z.string(),
  comorbidities: z.string(),
  medications: jsonValue,
  donor_preferences: jsonValue,
  psychological_clearance: z.boolean(),
  support_system_rating: z.string(),
  document_urls: jsonValue,
  notes: z.string(),
};

/** Every field optional and nullable, for partial updates. */
const patientPatchSchema = z.object(
  Object.fromEntries(
    Object.entries(PATIENT_FIELDS).map(([k, v]) => [k, v.nullable().optional()])
  )
);

const patientCreateSchema = patientPatchSchema.extend({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
});

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
    const body = patientCreateSchema.parse(req.body);
    return withTransaction(req.auth, async (client) => svc.create(client, req.auth, body));
  });

  app.patch('/patients/:id', { preHandler: requireRole('admin', 'coordinator', 'physician') }, async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = patientPatchSchema.parse(req.body);
    if (Object.keys(body).length === 0) {
      throw errors.badRequest('No writable patient fields supplied');
    }
    return withTransaction(req.auth, async (client) => svc.update(client, req.auth, id, body));
  });
};
