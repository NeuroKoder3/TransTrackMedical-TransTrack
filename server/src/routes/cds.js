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
 */

const { withTransaction } = require('../db/pool');
const { errors } = require('../util/errors');
const registry = require('../cds/registry');
require('../cds/services'); // side-effect: register built-in services

module.exports = async function cdsRoutes(app) {
  app.get('/cds-services',
    { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async () => ({ services: registry.list() }));

  app.post('/cds-services/:id', async (req, reply) => {
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
    // Audit
    try {
      await withTransaction(req.auth, async (client) => {
        await client.query(
          `INSERT INTO cds_service_invocations
             (org_id, service_id, hook, hook_instance, fhir_server,
              user_reference, patient_reference, encounter_reference,
              request_body, response_body, cards_returned,
              duration_ms, error_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            req.auth.orgId,
            id,
            body.hook,
            body.hookInstance,
            body.fhirServer || null,
            body.user || null,
            body.context?.patientId || null,
            body.context?.encounterId || null,
            JSON.stringify(body),
            JSON.stringify(response),
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

  app.post('/cds-services/:id/feedback', async (req) => {
    // Per CDS Hooks 1.1, feedback informs the CDS service about user actions.
    // We accept and acknowledge; production deployments use this to tune.
    const fb = req.body || {};
    req.log.info({
      id: req.params.id,
      outcomeCount: Array.isArray(fb.feedback) ? fb.feedback.length : 0,
    }, 'cds feedback');
    return { acknowledged: true };
  });
};
