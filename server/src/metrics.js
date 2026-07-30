'use strict';

/**
 * Simple in-process counters exposed on GET /metrics.
 *
 * Not a full Prometheus client — just the four counters the ops team
 * needs to alert on. Output is Prometheus text exposition format so
 * any scraper can consume it without a library dependency.
 */

const counters = {
  auth_failures_total: 0,
  backup_failures_total: 0,
  hl7_errors_total: 0,
  fhir_delivery_failures_total: 0,
};

function inc(name, n = 1) {
  if (name in counters) counters[name] += n;
}

function snapshot() {
  return { ...counters };
}

function toPrometheusText() {
  const lines = [];
  for (const [k, v] of Object.entries(counters)) {
    lines.push(`# TYPE ${k} counter`);
    lines.push(`${k} ${v}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Fastify plugin — registers GET /metrics.
 * Access: localhost only (no auth required) or admin bearer token.
 */
async function metricsPlugin(app) {
  app.get('/metrics', { config: { public: true } }, async (req, reply) => {
    const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
    if (!isLocalhost && !req.auth) {
      return reply.code(403).send({ error: 'metrics endpoint is localhost-only or requires auth' });
    }
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    return toPrometheusText();
  });
}

module.exports = { inc, snapshot, toPrometheusText, metricsPlugin };
