'use strict';

/**
 * CDS Hooks endpoints (cds-hooks 1.1).
 *
 *   GET  /cds-services                      discovery
 *   POST /cds-services/:id                  invocation
 *   POST /cds-services/:id/feedback         feedback (1.1)
 *
 * Discovery is public (per spec). Invocations require either a SMART access
 * token or our native JWT — the hospital EHR will normally be configured
 * with a backend-services SMART client and supply a JWT in Authorization.
 *
 * Global authentication alone is not authorisation (H-12): every token in the
 * organisation could previously invoke every service and receive cards
 * describing any patient the service could resolve. Invocation is a read of
 * patient data and is gated as one.
 */

const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const { errors } = require('../util/errors');
const { NATIVE_FHIR_ROLES } = require('../middleware/auth');
const registry = require('../cds/registry');
const { summariseRequest, summariseResponse } = require('../cds/auditSummary');
require('../cds/services'); // side-effect: register built-in services

/** Roles that may read patient data with a native TransTrack JWT. */
const NATIVE_READ_ROLES = new Set([...NATIVE_FHIR_ROLES.r, 'admin']);

/**
 * A SMART token may invoke a CDS service when it has been granted at least
 * one FHIR read or search scope. A write-only or launch-only token has no
 * business receiving decision-support cards about a patient.
 */
function smartTokenMayRead(auth) {
  const granted = auth.smart?.parsedScopes || [];
  return granted.some((s) => s.kind === 'fhir' && (s.ops.has('r') || s.ops.has('s')));
}

async function requireCdsInvoke(req) {
  if (!req.auth) throw errors.unauthorized();
  if (req.auth.tokenType === 'smart') {
    if (!smartTokenMayRead(req.auth)) {
      throw errors.forbidden('SMART scope does not permit invoking a CDS service');
    }
    return;
  }
  if (!NATIVE_READ_ROLES.has(req.auth.role)) {
    throw errors.forbidden(`Role '${req.auth.role}' may not invoke a CDS service`);
  }
}

const feedbackSchema = z.object({
  feedback: z.array(z.object({
    card: z.string().min(1),
    outcome: z.enum(['accepted', 'overridden']),
    outcomeTimestamp: z.string().optional(),
    acceptedSuggestions: z.array(z.object({ id: z.string() }).passthrough()).optional(),
    // overrideReason.reason is clinician free text and may name the patient,
    // so only the coded part is read out of it.
    overrideReason: z.object({
      code: z.string().optional(),
      system: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough()).min(1),
});

module.exports = async function cdsRoutes(app, opts) {
  const config = opts?.config || {};
  const captureRawPayloads = config.CDS_CAPTURE_RAW_PAYLOADS === true;
  const rawRetentionDays = config.CDS_RAW_PAYLOAD_RETENTION_DAYS || 7;

  if (captureRawPayloads) {
    app.log.warn(
      { retentionDays: rawRetentionDays },
      'CDS_CAPTURE_RAW_PAYLOADS is enabled: full CDS Hooks request and response ' +
      'payloads (patient context and prefetched FHIR resources) are being written to ' +
      'cds_service_invocations. Every captured row carries raw_payload_expires_at and ' +
      'must be purged by that time.'
    );
  }

  app.get('/cds-services',
    { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async () => ({ services: registry.list() }));

  app.post('/cds-services/:id', { preHandler: requireCdsInvoke }, async (req, reply) => {
    const id = req.params.id;
    const svc = registry.get(id);
    if (!svc) {
      reply.code(404);
      return { error: 'service_not_found' };
    }
    const body = req.body || {};
    if (!body.hook || body.hook !== svc.hook) {
      throw errors.badRequest(`hook must be ${svc.hook}`);
    }
    if (!body.hookInstance) throw errors.badRequest('hookInstance required');
    const t0 = Date.now();
    let response = { cards: [] };
    let errorMessage = null;
    try {
      const enriched = { ...body, __auth: req.auth };
      response = await svc.handler(enriched);
      if (!Array.isArray(response.cards)) response.cards = [];
    } catch (e) {
      errorMessage = e.message;
      response = { cards: [] };
    }
    const dur = Date.now() - t0;
    // Audit. The default row is PHI-free: shape, counts and timings only.
    try {
      await withTransaction(req.auth, async (client) => {
        await client.query(
          `INSERT INTO cds_service_invocations
             (org_id, service_id, hook, hook_instance, fhir_server,
              user_reference, patient_reference, encounter_reference,
              request_summary, response_summary,
              request_body, response_body,
              raw_payload_captured, raw_payload_expires_at,
              cards_returned, duration_ms, error_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                   CASE WHEN $13::boolean THEN now() + ($14 || ' days')::interval ELSE NULL END,
                   $15,$16,$17)`,
          [
            req.auth.orgId,
            id,
            body.hook,
            body.hookInstance,
            body.fhirServer || null,
            body.user || null,
            body.context?.patientId || null,
            body.context?.encounterId || null,
            JSON.stringify(summariseRequest(body)),
            JSON.stringify(summariseResponse(response)),
            captureRawPayloads ? JSON.stringify(body) : null,
            captureRawPayloads ? JSON.stringify(response) : null,
            captureRawPayloads,
            rawRetentionDays,
            response.cards.length,
            dur,
            errorMessage,
          ]
        );
      });
    } catch (e) {
      req.log.warn({ err: e.message }, 'cds audit insert failed');
    }
    return response;
  });

  app.post('/cds-services/:id/feedback', { preHandler: requireCdsInvoke }, async (req) => {
    // Per CDS Hooks 1.1, feedback informs the CDS service about user actions.
    // L-15: this used to answer { acknowledged: true } without storing
    // anything, so every EHR sending outcomes believed we were recording
    // them. Persist first, and let a failure surface as a failure.
    const serviceId = req.params.id;
    if (!registry.get(serviceId)) throw errors.notFound('service_not_found');
    const body = feedbackSchema.parse(req.body || {});

    const stored = await withTransaction(req.auth, async (client) => {
      let n = 0;
      for (const item of body.feedback) {
        await client.query(
          `INSERT INTO cds_service_feedback
             (org_id, service_id, card_uuid, outcome, outcome_timestamp,
              accepted_suggestion_id, override_reason_code, override_reason_system)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            req.auth.orgId,
            serviceId,
            item.card,
            item.outcome,
            item.outcomeTimestamp || null,
            item.acceptedSuggestions?.[0]?.id || null,
            item.overrideReason?.code || null,
            item.overrideReason?.system || null,
          ]
        );
        n++;
      }
      return n;
    });

    req.log.info({ id: serviceId, outcomeCount: stored }, 'cds feedback recorded');
    return { acknowledged: true, recorded: stored };
  });
};

module.exports.requireCdsInvoke = requireCdsInvoke;
