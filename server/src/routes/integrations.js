'use strict';

/**
 * Integration HTTP endpoints.
 *
 * Currently exposes:
 *
 *   POST /integrations/epic/import
 *
 * which pulls a single patient (and the USCDI-core data around them) from
 * Epic on FHIR and persists them as a native TransTrack patient. Two
 * invocation modes (see body schema) - server-fetch and bundle.
 */

const fs = require('node:fs');
const { z } = require('zod');
const { withTransaction } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { errors } = require('../util/errors');
const epic = require('../integrations/epic');

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

module.exports = async function integrationRoutes(app, opts) {
  const config = opts?.config || {};

  app.get('/integrations/epic/status', async () => {
    return {
      enabled: !!(config.EPIC_SANDBOX_CLIENT_ID && config.EPIC_PRIVATE_KEY_FILE),
      modes: ['bundle', 'server-fetch'],
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
        const client = buildEpicClientFromConfig(config);
        if (!client) {
          throw errors.badRequest(
            'Epic server-fetch mode is not configured on this server. ' +
            'Set EPIC_SANDBOX_CLIENT_ID and EPIC_PRIVATE_KEY_FILE, ' +
            'or POST a "bundle" instead.',
          );
        }
        try {
          bundle = await client.fetchPatientBundle(body.epicPatientId);
        } catch (e) {
          req.log.error({ err: e }, 'epic fetchPatientBundle failed');
          throw errors.badGateway(`Epic FHIR pull failed: ${e.message}`);
        }
      }

      const result = await withTransaction(req.auth, (c) =>
        epic.importPatientFromBundle(c, req.auth, bundle),
      );
      return result;
    },
  );
};
