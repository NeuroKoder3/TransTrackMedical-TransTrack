'use strict';

const { withTransaction } = require('../db/pool');
const cap = require('../fhir/capabilityStatement');
const storage = require('../fhir/storage');
const bundle = require('../fhir/bundle');
const resources = require('../fhir/resources');
const subscriptions = require('../fhir/subscriptions');
const bulk = require('../fhir/bulkData');
const { errors } = require('../util/errors');
const { requireSmartScope } = require('../middleware/auth');

const SUPPORTED = new Set(Object.keys(resources));

module.exports = async function fhirRoutes(app, opts) {
  const { config } = opts;
  const baseUrl = config.FHIR_BASE_URL;

  // CapabilityStatement (public unless tenant requires auth)
  app.get('/fhir/metadata',
    { config: { public: !config.FHIR_REQUIRE_AUTH } },
    async () => {
      let smartIssuer = baseUrl;
      try { smartIssuer = new URL(baseUrl).origin; } catch { /* keep */ }
      return cap.build({ baseUrl, requireAuth: config.FHIR_REQUIRE_AUTH, smartIssuer });
    });

  // ----- Bulk Data Access ($export) ----------------------------------------

  app.post('/fhir/$export', {
    preHandler: [requireSmartScope('*', 's')],
  }, kickoffExport.bind(null, 'system'));

  app.post('/fhir/Patient/$export', {
    preHandler: [requireSmartScope('Patient', 's')],
  }, kickoffExport.bind(null, 'patient'));

  app.post('/fhir/Group/:id/$export', {
    preHandler: [requireSmartScope('Group', 's')],
  }, async (req, reply) => kickoffExport.call(null, 'group', req, reply, req.params.id));

  app.get('/fhir/$export-status/:jobId', async (req, reply) => {
    const job = await bulk.status(req.auth, req.params.jobId);
    if (!job) {
      reply.code(404);
      return bundle.operationOutcome({ diagnostics: 'job not found' });
    }
    if (job.status === 'queued' || job.status === 'in-progress') {
      reply.code(202).header('X-Progress', `${job.progress_percent || 0}% complete`);
      return '';
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      reply.code(500);
      return bundle.operationOutcome({ diagnostics: job.error_message || job.status });
    }
    const files = await bulk.listFiles(req.auth, req.params.jobId);
    const manifest = {
      transactionTime: job.completed_at,
      request: `${baseUrl}/$export`,
      requiresAccessToken: true,
      output: files.map(f => ({
        type: f.resource_type,
        url: `${baseUrl}/$export-file/${f.id}`,
        count: f.resource_count,
      })),
      error: [],
    };
    reply.code(200).type('application/json');
    return manifest;
  });

  app.get('/fhir/$export-file/:fileId', async (req, reply) => {
    const f = await bulk.getFileContent(req.auth, req.params.fileId);
    if (!f) {
      reply.code(404);
      return bundle.operationOutcome({ diagnostics: 'file not found' });
    }
    reply.type('application/fhir+ndjson').code(200);
    return f.content;
  });

  app.delete('/fhir/$export-status/:jobId', async (req, reply) => {
    const r = await bulk.cancel(req.auth, req.params.jobId);
    if (!r) { reply.code(404); return ''; }
    reply.code(202);
    return '';
  });

  async function kickoffExport(exportType, req, reply, groupId) {
    const types = (req.query?._type || '').split(',').map(s => s.trim()).filter(Boolean);
    const since = req.query?._since || null;
    const job = await bulk.kickoff(req.auth, { exportType, types, since, groupId });
    // Run the export inline (deferred) — the spec allows synchronous-but-deferred
    setImmediate(() => bulk.runJob(req.auth, job.id).catch(err => {
      req.log.warn({ err: err.message, jobId: job.id }, 'bulk export failed');
    }));
    reply.code(202)
      .header('Content-Location', `${baseUrl}/$export-status/${job.id}`)
      .header('Cache-Control', 'no-store')
      .header('Pragma', 'no-cache');
    return '';
  }

  // ----- Generic CRUD -----------------------------------------------------

  app.get('/fhir/:type/:id', {
    preHandler: [async (req) => {
      const { type } = req.params;
      if (SUPPORTED.has(type)) await requireSmartScope(type, 'r')(req);
    }],
  }, async (req, reply) => {
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

  app.get('/fhir/:type', {
    preHandler: [async (req) => {
      const { type } = req.params;
      if (SUPPORTED.has(type)) await requireSmartScope(type, 's')(req);
    }],
  }, async (req, reply) => {
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

  app.post('/fhir/:type', {
    preHandler: [async (req) => {
      const { type } = req.params;
      if (SUPPORTED.has(type)) await requireSmartScope(type, 'c')(req);
    }],
  }, async (req, reply) => {
    const { type } = req.params;
    if (!SUPPORTED.has(type)) throw errors.badRequest(`Unsupported resourceType ${type}`);
    const handler = resources[type];
    handler.validate(req.body);
    return withTransaction(req.auth, async (client) => {
      const row = await storage.create(client, req.auth, type, req.body);
      if (handler.postCreate) await handler.postCreate(client, req.auth, row.body);
      reply.code(201).type('application/fhir+json')
        .header('Location', `${baseUrl}/${type}/${row.body.id}`);
      // Fire subscription notifications (after tx commits)
      setImmediate(() => subscriptions.notify(req.auth, row.body, 'create').catch(() => {}));
      return row.body;
    });
  });

  app.put('/fhir/:type/:id', {
    preHandler: [async (req) => {
      const { type } = req.params;
      if (SUPPORTED.has(type)) await requireSmartScope(type, 'u')(req);
    }],
  }, async (req, reply) => {
    const { type, id } = req.params;
    if (!SUPPORTED.has(type)) throw errors.badRequest(`Unsupported resourceType ${type}`);
    const handler = resources[type];
    handler.validate(req.body);
    return withTransaction(req.auth, async (client) => {
      const row = await storage.update(client, req.auth, type, id, req.body);
      if (handler.postCreate) await handler.postCreate(client, req.auth, row.body);
      reply.type('application/fhir+json');
      setImmediate(() => subscriptions.notify(req.auth, row.body, 'update').catch(() => {}));
      return row.body;
    });
  });
};
