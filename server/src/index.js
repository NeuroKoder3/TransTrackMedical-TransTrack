'use strict';

/**
 * TransTrack server entry point.
 *
 * Composes:
 *   - Fastify HTTP server (REST API + FHIR R4)
 *   - PostgreSQL connection pool
 *   - HL7 v2 MLLP/TLS listener (separate TCP listener on its own port)
 *
 * Designed to be started directly (node src/index.js) or supervised by
 * docker compose. Returns the assembled `app` for tests via build().
 */

const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const sensible = require('@fastify/sensible');
const rateLimit = require('@fastify/rate-limit');
const formbody = require('@fastify/formbody');

const { load } = require('./config');
const pool = require('./db/pool');
const { makeAuthHook } = require('./middleware/auth');
const hl7Server = require('./hl7/server');
const { HttpError } = require('./util/errors');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

async function build() {
  loadDotEnv();
  const config = load();
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
        : undefined,
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 8 * 1024 * 1024,
  });

  pool.init(config, app.log);

  await app.register(cors, { origin: true, credentials: true });
  await app.register(helmet, {
    contentSecurityPolicy: false, // SPA-served separately; FHIR clients break with strict CSP
  });
  await app.register(sensible);
  await app.register(formbody);
  // Global rate limiter is the OUTER ring of defence. Sensitive routes
  // (auth, MFA, OAuth token exchange, etc.) declare a much stricter
  // per-route `config.rateLimit` override on top of this. Health/readiness
  // routes have their own per-route override too — they are NOT
  // allow-listed here, so the per-route override actually takes effect.
  // (When `allowList` returns true for a request, @fastify/rate-limit
  // skips the check entirely — including any per-route override — which
  // is the opposite of what we want for `js/missing-rate-limiting`.)
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
  });

  app.addContentTypeParser('application/fhir+json', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, JSON.parse(body)); } catch (e) { done(e); }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    if (err.name === 'ZodError') {
      reply.code(400).send({
        error: { code: 'validation_error', message: 'Invalid input', details: err.issues },
      });
      return;
    }
    if (err.code === '23505') { // pg unique violation
      reply.code(409).send({
        error: { code: 'conflict', message: err.detail || 'Conflict' },
      });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    reply.code(err.statusCode || 500).send({
      error: { code: 'internal_error', message: err.message },
    });
  });

  const authHook = makeAuthHook(config);
  app.addHook('preHandler', authHook);

  app.register(require('./routes/health'));
  app.register(require('./routes/auth'), { config });
  app.register(require('./routes/patients'));
  app.register(require('./routes/organOffers'));
  app.register(require('./routes/labResults'));
  app.register(require('./routes/calculators'));
  app.register(require('./routes/audit'));
  app.register(require('./routes/hl7'));
  app.register(require('./routes/fhir'), { config });
  app.register(require('./routes/smart'), { config });
  app.register(require('./routes/cds'));
  app.register(require('./routes/integrations'), { config });

  app.addHook('onClose', async () => {
    await pool.shutdown();
  });

  return { app, config };
}

async function start() {
  const { app, config } = await build();
  await app.listen({ port: config.HTTP_PORT, host: config.HTTP_HOST });
  hl7Server.start({ config, logger: app.log.child({ component: 'mllp' }) });
  // Subscription delivery dispatcher
  const subs = require('./fhir/subscriptions');
  subs.startDispatcher(config.SUBSCRIPTION_DISPATCH_MS || 5000);
}

if (require.main === module) {
  start().catch((err) => {
    console.error('fatal startup error', err);
    process.exit(1);
  });
}

module.exports = { build, start };
