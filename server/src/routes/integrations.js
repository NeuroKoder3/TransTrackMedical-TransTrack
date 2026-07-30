'use strict';

/**
 * Integration HTTP endpoints.
 *
 * Exposes:
 *   POST /integrations/epic/import  — pull or push patient data from Epic
 *
 * Uses the multi-tenant org registry for production deployments. Falls back
 * to global EPIC_SANDBOX_CLIENT_ID / EPIC_PRIVATE_KEY_FILE for single-tenant.
 */

const fs = require('node:fs');
const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { errors } = require('../util/errors');
const epic = require('../integrations/epic');
const epicRegistry = require('../integrations/epic/registry');

const fhirResourceSchema = z
  .object({ resourceType: z.string() })
  .passthrough();

const bundleSchema = z.object({
  patient: fhirResourceSchema,
  observations: z.array(fhirResourceSchema).optional().default([]),
  conditions: z.array(fhirResourceSchema).optional().default([]),
  medicationRequests: z.array(fhirResourceSchema).optional().default([]),
  allergies: z.array(fhirResourceSchema).optional().default([]),
  scopeGranted: z.string().optional(),
});

const bodySchema = z
  .object({
    epicPatientId: z.string().min(1).optional(),
    bundle: bundleSchema.optional(),
    environment: z.enum(['sandbox', 'prod']).optional().default('sandbox'),
  })
  .refine(
    (b) => b.epicPatientId || b.bundle,
    'Provide either epicPatientId (server-fetch mode) or bundle (push mode)',
  );

function buildEpicClientFromConfig(config) {
  const clientId = config.EPIC_SANDBOX_CLIENT_ID;
  const keyFile = config.EPIC_PRIVATE_KEY_FILE;
  if (!clientId || !keyFile) return null;
  if (!fs.existsSync(keyFile)) return null;
  return epic.createEpicClientFromKeyFile({
    clientId,
    privateKeyFile: keyFile,
    tokenUrl: config.EPIC_TOKEN_URL || undefined,
    fhirBase: config.EPIC_FHIR_BASE || undefined,
    kid: config.EPIC_KID || undefined,
    scope: config.EPIC_SCOPE || undefined,
  });
}

/**
 * Resolve an Epic client for the requesting org using the multi-tenant
 * registry. Falls back to the global config for single-tenant deployments.
 */
function buildEpicClientForOrg(orgId, environment, config, logger) {
  try {
    const customerCfg = epicRegistry.getCustomerConfig({ orgId, environment });
    return epic.createEpicClientFromKeyFile({
      clientId: customerCfg.clientId,
      privateKeyFile: customerCfg.privateKeyFile,
      tokenUrl: customerCfg.tokenUrl,
      fhirBase: customerCfg.fhirBase,
      kid: customerCfg.kid,
      scope: customerCfg.scope,
      logger,
    });
  } catch {
    return buildEpicClientFromConfig(config);
  }
}

module.exports = async function integrationRoutes(app, opts) {
  const config = opts?.config || {};

  app.get('/integrations/epic/status', async (req) => {
    const orgId = req.auth?.orgId;
    let registryAvailable = false;
    if (orgId) {
      try {
        epicRegistry.getCustomerConfig({ orgId, environment: 'prod' });
        registryAvailable = true;
      } catch { /* not configured */ }
    }
    return {
      enabled: registryAvailable || !!(config.EPIC_SANDBOX_CLIENT_ID && config.EPIC_PRIVATE_KEY_FILE),
      modes: ['bundle', 'server-fetch'],
      multiTenant: registryAvailable,
    };
  });

  app.post(
    '/integrations/epic/import',
    {
      preHandler: requireRole('admin', 'coordinator', 'physician'),
    },
    async (req) => {
      const body = bodySchema.parse(req.body);

      let bundle;
      if (body.bundle) {
        bundle = body.bundle;
      } else {
        const environment = config.NODE_ENV === 'production' ? 'prod' : (body.environment || 'sandbox');
        const client = buildEpicClientForOrg(req.auth.orgId, environment, config, req.log);
        if (!client) {
          throw errors.badRequest(
            'Epic server-fetch mode is not configured for this organisation. ' +
            'Set EPIC_SANDBOX_CLIENT_ID and EPIC_PRIVATE_KEY_FILE, configure ' +
            'the org registry, or POST a "bundle" instead.',
          );
        }
        try {
          bundle = await client.fetchPatientBundle(body.epicPatientId);
        } catch (e) {
          req.log.error({ err: e.message, epicPatientId: body.epicPatientId }, 'epic fetchPatientBundle failed');
          throw errors.badGateway('Epic FHIR pull failed — see server logs for details');
        }
      }

      const result = await withTransaction(req.auth, (c) =>
        epic.importPatientFromBundle(c, req.auth, bundle),
      );
      return result;
    },
  );
};
