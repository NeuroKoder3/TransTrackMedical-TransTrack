'use strict';

/**
 * SMART on FHIR scope helpers.
 *
 * Supports both v1 and v2 scope syntax:
 *   v1: patient/Observation.read           system/Patient.write
 *   v2: patient/Observation.rs             system/*.cruds   user/Encounter.cu
 *
 * Plus the SMART standalone-launch scopes:
 *   openid fhirUser profile launch launch/patient launch/encounter
 *   offline_access online_access
 */

const ACCESS_LEVELS = ['patient', 'user', 'system'];
const V1_OPS = new Set(['read', 'write', '*']);
const V2_OPS = new Set(['c', 'r', 'u', 'd', 's']);

function parseScope(scope) {
  // Standalone-launch / OIDC scopes
  if (['openid', 'fhirUser', 'profile', 'email', 'launch',
       'launch/patient', 'launch/encounter', 'launch/practitioner',
       'launch/location', 'offline_access', 'online_access'].includes(scope)) {
    return { kind: 'launch', value: scope };
  }
  // FHIR data scopes: <level>/<resource>.<ops>(?<query>)?
  const m = scope.match(/^(patient|user|system)\/([A-Za-z*]+)\.([a-z*]+)(?:\?(.+))?$/);
  if (!m) return { kind: 'unknown', value: scope };
  const [, level, resource, opsRaw, query] = m;
  let ops;
  if (V1_OPS.has(opsRaw)) {
    ops = new Set(opsRaw === '*' ? ['c','r','u','d','s']
                  : opsRaw === 'read' ? ['r','s']
                  : ['c','u','d']);
  } else {
    ops = new Set(opsRaw === '*' ? ['c','r','u','d','s']
                  : opsRaw.split('').filter(c => V2_OPS.has(c)));
  }
  return { kind: 'fhir', level, resource, ops, query: query || null };
}

function parseScopes(scopeString) {
  if (!scopeString) return [];
  return String(scopeString).split(/\s+/).filter(Boolean).map(parseScope);
}

/**
 * Decide whether a request is allowed under the granted scopes.
 *
 *   resource: FHIR resource type ("Patient", "Observation", ...)
 *   op:       'r' read, 's' search, 'c' create, 'u' update, 'd' delete
 *   subject:  optional FHIR reference of the subject the operation targets;
 *             matched against patient/<id> launch context if 'patient/' scope.
 */
function isAllowed(grantedScopes, resource, op, opts = {}) {
  const granted = Array.isArray(grantedScopes) ? grantedScopes : parseScopes(grantedScopes);
  for (const s of granted) {
    if (s.kind !== 'fhir') continue;
    if (s.resource !== '*' && s.resource !== resource) continue;
    if (!s.ops.has(op)) continue;
    if (s.level === 'patient') {
      // Must be operating within launch-context patient
      if (!opts.launchPatient) continue;
      if (opts.subject && opts.subject !== `Patient/${opts.launchPatient}` &&
          !opts.subject.endsWith(`/${opts.launchPatient}`)) {
        // For non-Patient resources this is fine — search filters apply server-side.
        if (resource !== 'Patient' && op === 's') return true;
        continue;
      }
      return true;
    }
    if (s.level === 'user' || s.level === 'system') return true;
  }
  return false;
}

function summary(grantedScopes) {
  const granted = parseScopes(grantedScopes);
  return {
    launch: granted.filter(s => s.kind === 'launch').map(s => s.value),
    fhir: granted.filter(s => s.kind === 'fhir').map(s => ({
      level: s.level,
      resource: s.resource,
      ops: [...s.ops].sort().join(''),
    })),
    unknown: granted.filter(s => s.kind === 'unknown').map(s => s.value),
  };
}

/**
 * Normalize a space-separated scope string: deduplicate and sort tokens.
 */
function normalizeScopeString(scopeString) {
  if (!scopeString) return '';
  const tokens = String(scopeString).split(/\s+/).filter(Boolean);
  return [...new Set(tokens)].sort().join(' ');
}

/**
 * Assert that the redirect_uri is registered for this client.
 * Throws if redirect_uris is empty or does not include the exact URI.
 */
function assertRegisteredRedirect(smartClient, redirectUri) {
  const uris = smartClient.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    throw new Error('Client has no registered redirect_uris');
  }
  if (!uris.includes(redirectUri)) {
    throw new Error('redirect_uri is not registered for this client');
  }
}

/**
 * Constrain requested scopes to the intersection with registered scopes.
 * Every requested FHIR scope token must be a subset of what the client is
 * registered for. Unknown/malformed FHIR scopes are rejected.
 * Returns the constrained scope string (only tokens that pass).
 */
function constrainScopes(requestedScope, registeredScope) {
  if (!registeredScope || !String(registeredScope).trim()) {
    throw new Error('Client has no registered scopes');
  }
  const registeredParsed = parseScopes(registeredScope);
  const requestedParsed = parseScopes(requestedScope);
  if (requestedParsed.length === 0) {
    throw new Error('No scopes requested');
  }

  const allowed = [];
  for (const req of requestedParsed) {
    if (req.kind === 'unknown') {
      throw new Error(`Unknown or malformed scope: ${req.value}`);
    }
    if (req.kind === 'launch') {
      // Launch/OIDC scopes are allowed if registered scope includes them
      const regLaunch = registeredParsed.filter(s => s.kind === 'launch').map(s => s.value);
      if (regLaunch.includes(req.value)) {
        allowed.push(req.value);
      }
      // openid/fhirUser/profile/offline_access are always passthrough if registered
      // or if the registered set contains a wildcard-like pattern. For SMART apps
      // we pass through standard OIDC scopes if the registered scope includes them.
      continue;
    }
    // FHIR data scope — must be subset of registered
    let matched = false;
    for (const reg of registeredParsed) {
      if (reg.kind !== 'fhir') continue;
      if (reg.level !== req.level) continue;
      if (reg.resource !== '*' && reg.resource !== req.resource) continue;
      // Ops must be subset
      const constrainedOps = new Set([...req.ops].filter(o => reg.ops.has(o)));
      if (constrainedOps.size === 0) continue;
      // Build constrained scope token
      const opsStr = [...constrainedOps].sort().join('');
      const resource = req.resource;
      const token = `${req.level}/${resource}.${opsStr}`;
      allowed.push(token);
      matched = true;
      break;
    }
    if (!matched) {
      throw new Error(`Scope not permitted by client registration: ${rebuildScopeToken(req)}`);
    }
  }
  if (allowed.length === 0) {
    throw new Error('No valid scopes after constraining to registration');
  }
  return normalizeScopeString(allowed.join(' '));
}

function rebuildScopeToken(parsed) {
  if (parsed.kind === 'launch') return parsed.value;
  if (parsed.kind === 'fhir') {
    return `${parsed.level}/${parsed.resource}.${[...parsed.ops].sort().join('')}`;
  }
  return parsed.value;
}

/**
 * Require PKCE for public clients. Only S256 is accepted.
 */
function requirePkceForPublic(smartClient, codeChallenge, method) {
  if (smartClient.client_type !== 'public') return;
  if (!codeChallenge) {
    throw new Error('PKCE code_challenge is required for public clients');
  }
  if (method !== 'S256') {
    throw new Error('Only S256 code_challenge_method is supported for public clients');
  }
}

void ACCESS_LEVELS;

module.exports = {
  parseScope, parseScopes, isAllowed, summary,
  normalizeScopeString, assertRegisteredRedirect, constrainScopes, requirePkceForPublic,
};
