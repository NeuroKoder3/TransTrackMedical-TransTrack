'use strict';

const jwt = require('../auth/jwt');
const smartTokens = require('../smart/tokens');
const smartScopes = require('../smart/scopes');
const { readAccessToken } = require('../auth/sessionCookies');
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
    if (typeof req.rateLimit === 'function') {
      await req.rateLimit();
    }
    const header = req.headers['authorization'] || '';
    let raw = '';
    if (header.toLowerCase().startsWith('bearer ')) {
      raw = header.slice(header.indexOf(' ') + 1).trim();
    }
    if (!raw) raw = readAccessToken(req) || '';
    if (!raw) throw errors.unauthorized('Missing Bearer token');

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
      throw errors.unauthorized('Invalid token');
    }
  };
}

function requireRole(...allowed) {
  return async function (req) {
    if (!req.auth) throw errors.unauthorized();
    if (req.auth.role === 'smart_system' || req.auth.role === 'smart_user') {
      throw errors.forbidden('SMART tokens cannot access native API endpoints');
    }
    if (!allowed.includes(req.auth.role) && req.auth.role !== 'admin') {
      throw errors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
  };
}

/**
 * Roles permitted to perform each FHIR operation with a native TransTrack JWT.
 *
 * M-9: native JWTs previously bypassed FHIR authorisation entirely, so a
 * `viewer` had full CRUD. Native tokens carry no SMART scopes, so role is the
 * only available authority and it is now enforced. `admin` is accepted for
 * every operation.
 */
const NATIVE_FHIR_ROLES = Object.freeze({
  r: ['viewer', 'coordinator', 'physician', 'auditor'],
  s: ['viewer', 'coordinator', 'physician', 'auditor'],
  c: ['coordinator', 'physician'],
  u: ['coordinator', 'physician'],
  d: [],
});

const OP_NAMES = Object.freeze({
  c: 'create', r: 'read', u: 'update', d: 'delete', s: 'search',
});

/**
 * Enforce authorisation for a FHIR route. `op` is one of c/r/u/d/s.
 *
 * For SMART tokens this evaluates the granted scopes and, when the grant is
 * patient-level, pins `req.auth.compartment.patient` to the launch-context
 * patient. Storage then refuses to read or write anything outside that
 * compartment (C-1). The scope check alone never releases data.
 *
 * For native JWTs this enforces the role matrix above (M-9).
 */
function requireSmartScope(resource, op) {
  return async function (req) {
    if (!req.auth) throw errors.unauthorized();

    if (req.auth.tokenType !== 'smart') {
      const allowed = NATIVE_FHIR_ROLES[op] || [];
      if (req.auth.role !== 'admin' && !allowed.includes(req.auth.role)) {
        throw errors.forbidden(
          `Role '${req.auth.role}' may not ${OP_NAMES[op] || op} ${resource}`
        );
      }
      return;
    }

    const launchPatient = req.auth.smart.launchContext?.patient || null;
    const { allowed, level } = smartScopes.resolveAccess(
      req.auth.smart.parsedScopes,
      resource,
      op,
      {
        launchPatient,
        subject: req.body?.subject?.reference || req.query?.patient,
      }
    );
    if (!allowed) throw errors.forbidden(`SMART scope does not permit ${op} on ${resource}`);

    // Patient-level grants are confined to the launch patient's compartment.
    // Recorded on req.auth so the storage layer enforces it unconditionally.
    if (level === 'patient') {
      req.auth.compartment = { patient: launchPatient };
    }
  };
}

module.exports = { makeAuthHook, requireRole, requireSmartScope, NATIVE_FHIR_ROLES };
