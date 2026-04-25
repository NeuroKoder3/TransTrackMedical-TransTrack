'use strict';

const jwt = require('../auth/jwt');
const { errors } = require('../util/errors');

/**
 * Decorates the Fastify request with .auth = { userId, orgId, role, email }.
 * Throws 401 on missing/invalid Bearer token. Routes that need to be public
 * (e.g. health, /auth/login) can mark themselves with config.public = true.
 */
function makeAuthHook(config) {
  return async function authHook(req) {
    if (req.routeOptions?.config?.public) return;
    const header = req.headers['authorization'] || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) throw errors.unauthorized('Missing Bearer token');
    let claims;
    try {
      claims = jwt.verify(m[1], config.JWT_SECRET, {
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      });
    } catch (e) {
      throw errors.unauthorized('Invalid token: ' + e.message);
    }
    req.auth = {
      userId: claims.sub,
      orgId: claims.org,
      role: claims.role,
      email: claims.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  };
}

function requireRole(...allowed) {
  return async function (req) {
    if (!req.auth) throw errors.unauthorized();
    if (!allowed.includes(req.auth.role) && req.auth.role !== 'admin') {
      throw errors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
  };
}

module.exports = { makeAuthHook, requireRole };
