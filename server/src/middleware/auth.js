'use strict';

const jwt = require('../auth/jwt');
const smartTokens = require('../smart/tokens');
const smartScopes = require('../smart/scopes');
const { errors } = require('../util/errors');

/**
 * Decorates the Fastify request with .auth = { userId, orgId, role, email }.
 *
 * Two token formats are accepted:
 *
 *   1. Native TransTrack JWT (HS256) issued by /auth/login.
 *   2. Opaque SMART on FHIR access token issued by /oauth2/token.
 *
 * SMART tokens come with .smart = { clientId, scope, launchContext } and a
 * .role of 'smart' if no user is associated (backend-services). When a user
 * is associated, that user's role from the users table is used.
 *
 * Throws 401 on missing/invalid token. Public routes mark themselves with
 * config.public = true.
 */
function makeAuthHook(config) {
  return async function authHook(req) {
    if (req.routeOptions?.config?.public) return;
    const header = req.headers['authorization'] || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) throw errors.unauthorized('Missing Bearer token');
    const raw = m[1];

    // Heuristic: native JWT contains exactly two dots and base64url segments;
    // SMART opaque tokens are a single base64url string. Try JWT first if it
    // has dots, otherwise SMART.
    if (raw.split('.').length === 3) {
      try {
        const claims = jwt.verify(raw, config.JWT_SECRET, {
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
        });
        req.auth = {
          userId: claims.sub,
          orgId: claims.org,
          role: claims.role,
          email: claims.email,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          tokenType: 'jwt',
        };
        return;
      } catch (_e) {
        // fall through to SMART check
      }
    }
    // SMART opaque
    try {
      const found = await smartTokens.lookupAccess(raw);
      if (!found) throw errors.unauthorized('Invalid token');
      req.auth = {
        userId: found.userId || null,
        orgId: found.orgId,
        role: found.userId ? 'smart_user' : 'smart_system',
        email: null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tokenType: 'smart',
        smart: {
          clientId: found.clientId,
          scope: found.scope,
          parsedScopes: smartScopes.parseScopes(found.scope),
          launchContext: found.launchContext || {},
        },
      };
    } catch (e) {
      if (e.statusCode) throw e;
      throw errors.unauthorized('Invalid token: ' + e.message);
    }
  };
}

function requireRole(...allowed) {
  return async function (req) {
    if (!req.auth) throw errors.unauthorized();
    // SMART system tokens (backend services) act as 'admin' for purposes of
    // RBAC — scope-based filtering is the actual access-control mechanism.
    if (req.auth.role === 'smart_system') return;
    if (req.auth.role === 'smart_user') {
      // For SMART user tokens, treat as 'user' unless the calling route
      // permits it explicitly (e.g. routes that require 'admin' will deny).
      if (allowed.includes('user') || allowed.includes('smart_user')) return;
      throw errors.forbidden('SMART user token cannot access role-restricted endpoint');
    }
    if (!allowed.includes(req.auth.role) && req.auth.role !== 'admin') {
      throw errors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
  };
}

/**
 * Enforce a SMART scope for FHIR routes. op is one of c/r/u/d/s.
 */
function requireSmartScope(resource, op) {
  return async function (req) {
    if (!req.auth) throw errors.unauthorized();
    // Native JWTs do not require SMART scopes — they are the API's own users.
    if (req.auth.tokenType !== 'smart') return;
    const ok = smartScopes.isAllowed(
      req.auth.smart.parsedScopes,
      resource,
      op,
      {
        launchPatient: req.auth.smart.launchContext?.patient,
        subject: req.body?.subject?.reference || req.query?.patient,
      }
    );
    if (!ok) throw errors.forbidden(`SMART scope does not permit ${op} on ${resource}`);
  };
}

module.exports = { makeAuthHook, requireRole, requireSmartScope };
