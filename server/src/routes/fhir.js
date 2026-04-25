'use strict';

const { withTransaction } = require('../db/pool');
const cap = require('../fhir/capabilityStatement');
const storage = require('../fhir/storage');
const bundle = require('../fhir/bundle');
const resources = require('../fhir/resources');
const { errors } = require('../util/errors');

const SUPPORTED = new Set(Object.keys(resources));

module.exports = async function fhirRoutes(app, opts) {
  const { config } = opts;
  const baseUrl = config.FHIR_BASE_URL;

  // CapabilityStatement: discovery — must be public for some clients,
  // but if the deployment requires auth even here, set FHIR_REQUIRE_AUTH=true
  // and the auth hook will reject unauthenticated calls.
  app.get('/fhir/metadata', { config: { public: !config.FHIR_REQUIRE_AUTH } }, async () =>
    cap.build({ baseUrl, requireAuth: config.FHIR_REQUIRE_AUTH }));

  // Generic READ
  app.get('/fhir/:type/:id', async (req, reply) => {
    const { type, id } = req.params;
    if (!SUPPORTED.has(type)) {
      reply.code(404).type('application/fhir+json');
      return bundle.operationOutcome({ diagnostics: `Unsupported resourceType ${type}` });
    }
    return withTransaction(req.auth, async (client) => {
      const row = await storage.read(client, req.auth, type, id);
      if (!row || row.deleted) {
        reply.code(404).type('application/fhir+json');
        return bundle.operationOutcome({ diagnostics: 'not found' });
      }
      reply.type('application/fhir+json');
      return row.body;
    });
  });

  // Generic SEARCH
  app.get('/fhir/:type', async (req, reply) => {
    const { type } = req.params;
    if (!SUPPORTED.has(type)) {
      reply.code(404).type('application/fhir+json');
      return bundle.operationOutcome({ diagnostics: `Unsupported resourceType ${type}` });
    }
    return withTransaction(req.auth, async (client) => {
      const rows = await storage.search(client, req.auth, type, req.query || {});
      reply.type('application/fhir+json');
      return bundle.searchset({ baseUrl, type, rows });
    });
  });

  // CREATE
  app.post('/fhir/:type', async (req, reply) => {
    const { type } = req.params;
    if (!SUPPORTED.has(type)) throw errors.badRequest(`Unsupported resourceType ${type}`);
    const handler = resources[type];
    handler.validate(req.body);
    return withTransaction(req.auth, async (client) => {
      const row = await storage.create(client, req.auth, type, req.body);
      if (handler.postCreate) await handler.postCreate(client, req.auth, row.body);
      reply.code(201).type('application/fhir+json')
        .header('Location', `${baseUrl}/${type}/${row.body.id}`);
      return row.body;
    });
  });

  // UPDATE
  app.put('/fhir/:type/:id', async (req, reply) => {
    const { type, id } = req.params;
    if (!SUPPORTED.has(type)) throw errors.badRequest(`Unsupported resourceType ${type}`);
    const handler = resources[type];
    handler.validate(req.body);
    return withTransaction(req.auth, async (client) => {
      const row = await storage.update(client, req.auth, type, id, req.body);
      if (handler.postCreate) await handler.postCreate(client, req.auth, row.body);
      reply.type('application/fhir+json');
      return row.body;
    });
  });
};
