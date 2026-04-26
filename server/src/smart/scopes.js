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

void ACCESS_LEVELS;

module.exports = { parseScope, parseScopes, isAllowed, summary };
