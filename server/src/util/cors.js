'use strict';

/**
 * CORS origin policy (M-14).
 *
 * The previous configuration fell back to `origin: true` whenever
 * CORS_ALLOWED_ORIGINS was empty and NODE_ENV was development. Combined with
 * `credentials: true` that reflects *any* requesting origin back in
 * Access-Control-Allow-Origin and lets it read authenticated responses, so a
 * developer visiting a hostile page had their session readable by it.
 *
 * The origin is now always matched against an explicit allowlist:
 *   - CORS_ALLOWED_ORIGINS when set (any environment), otherwise
 *   - a fixed localhost allowlist in development and test, otherwise
 *   - nothing at all.
 *
 * Requests with no Origin header (same-origin fetches, curl, server-to-server)
 * are unaffected — the browser only enforces CORS when it sends one.
 */

const DEV_DEFAULT_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

/**
 * Resolve the effective allowlist for a config. Never returns a wildcard.
 */
function resolveAllowedOrigins(config) {
  const configured = String(config.CORS_ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (configured.length > 0) return configured;
  if (config.NODE_ENV === 'development' || config.NODE_ENV === 'test') {
    return [...DEV_DEFAULT_ORIGINS];
  }
  return [];
}

/**
 * Build the @fastify/cors `origin` callback. Credentialed responses are only
 * ever produced for an origin that appears on the allowlist.
 */
function makeOriginChecker(config) {
  const allowed = resolveAllowedOrigins(config);
  return function corsOrigin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error('CORS origin rejected'), false);
  };
}

module.exports = { resolveAllowedOrigins, makeOriginChecker, DEV_DEFAULT_ORIGINS };
