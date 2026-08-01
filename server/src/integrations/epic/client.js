'use strict';

/**
 * Epic on FHIR client (SMART Backend Services).
 *
 * Implements the Epic-flavoured client_credentials + JWT-bearer assertion
 * token exchange and a small set of FHIR R4 read helpers. The client is
 * intentionally pure (no DB / no Fastify dependencies) so it can be reused
 * from HTTP routes, smoke tests, CLIs, or unit tests.
 *
 * Verified end-to-end against the Epic on FHIR Developer Sandbox
 * (https://fhir.epic.com) using the test patient "Camila Maria Lopez"
 * (Patient ID erXuFYUfucBZaryVksYEcMg3) with system-level scopes for
 * Patient, Observation, Condition, MedicationRequest, and AllergyIntolerance.
 *
 * Sandbox app (Non-Production Client ID): a8634931-c997-4516-90cd-21ec3a27813e
 * JWKS URI: https://gist.githubusercontent.com/NeuroKoder3/a2f2b23b69e49dd284b8147d6817bcaa/raw/jwks.json
 * Verified: Epic May 2026 — token exchange confirmed, all 5 core scopes granted.
 */

const { createSign, randomUUID } = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_TOKEN_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const DEFAULT_FHIR_BASE =
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';

/**
 * Full system-level scope set for the TransTrack Backend Services app.
 * All 9 scopes are registered in the Epic non-production sandbox app
 * (Client ID a8634931-c997-4516-90cd-21ec3a27813e).
 */
const DEFAULT_SCOPES = [
  'system/AllergyIntolerance.read',
  'system/Condition.read',
  'system/Encounter.read',
  'system/Immunization.read',
  'system/MedicationRequest.read',
  'system/Observation.read',
  'system/Organization.read',
  'system/Patient.read',
  'system/Procedure.read',
].join(' ');

/**
 * Write scope required to file a document into a patient's chart.
 *
 * Deliberately NOT part of DEFAULT_SCOPES. Requesting a write scope changes
 * what a customer's Epic administrator is approving, and an app that asks for
 * write access it does not use will fail security review. A caller that
 * intends to file documents must opt in explicitly:
 *
 *   createEpicClient({ ..., scope: `${DEFAULT_SCOPES} ${DOCUMENT_WRITE_SCOPE}` })
 *
 * Epic additionally gates DocumentReference.Create per customer: the scope
 * being granted in the sandbox does not mean a production organisation has
 * enabled it. See ./README.md for the enablement conversation.
 */
const DOCUMENT_WRITE_SCOPE = 'system/DocumentReference.write';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(header, payload, privateKeyPem) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const signer = createSign('RSA-SHA384');
  signer.update(signingInput);
  signer.end();
  const sig = b64url(signer.sign(privateKeyPem));
  return `${signingInput}.${sig}`;
}

function buildAssertion({ clientId, tokenUrl, privateKeyPem, kid, ttlSeconds }) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { alg: 'RS384', typ: 'JWT', kid: kid || 'transtrack-epic-1' },
    {
      iss: clientId,
      sub: clientId,
      aud: tokenUrl,
      jti: randomUUID(),
      iat: now,
      exp: now + (ttlSeconds || 240),
    },
    privateKeyPem,
  );
}

// --- Circuit breaker state ---
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 60_000;

/**
 * Build an Epic FHIR client.
 *
 * Required:
 *   clientId      - Epic Non-Production / Production Client ID
 *   privateKeyPem - PEM-encoded RSA private key (public half registered as JWKS in Epic)
 *
 * Optional:
 *   tokenUrl   - default https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token
 *   fhirBase   - default https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
 *   kid        - key id, default "transtrack-epic-1"
 *   scope      - granted scope string, default DEFAULT_SCOPES
 *   fetchImpl  - inject a custom fetch (for tests). Defaults to globalThis.fetch.
 *   timeoutMs  - HTTP request timeout in ms (default 30000)
 *   logger     - optional logger instance
 */
function createEpicClient(opts) {
  const clientId = opts?.clientId;
  const privateKeyPem = opts?.privateKeyPem;
  if (!clientId) {
    throw new Error('createEpicClient: clientId is required');
  }
  if (!privateKeyPem) {
    throw new Error('createEpicClient: privateKeyPem is required');
  }
  const tokenUrl = opts.tokenUrl || DEFAULT_TOKEN_URL;
  const fhirBase = (opts.fhirBase || DEFAULT_FHIR_BASE).replace(/\/+$/, '');
  const kid = opts.kid || 'transtrack-epic-1';
  const scope = opts.scope || DEFAULT_SCOPES;
  const httpFetch = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || 30_000;
  const logger = opts.logger || null;
  if (typeof httpFetch !== 'function') {
    throw new Error('createEpicClient: no fetch implementation available');
  }

  let cached = null;

  // Circuit breaker
  let circuitFailures = 0;
  let circuitOpenedAt = 0;

  function checkCircuit() {
    if (circuitFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      if (Date.now() - circuitOpenedAt < CIRCUIT_RESET_MS) {
        throw new Error('Epic circuit breaker OPEN — too many consecutive failures');
      }
      circuitFailures = 0;
    }
  }

  function recordSuccess() { circuitFailures = 0; }
  function recordFailure() {
    circuitFailures++;
    if (circuitFailures >= CIRCUIT_FAILURE_THRESHOLD) circuitOpenedAt = Date.now();
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await httpFetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchWithRetry(url, options, { maxRetries = 3 } = {}) {
    checkCircuit();
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchWithTimeout(url, options);
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = res.headers?.get?.('Retry-After');
          const waitMs = retryAfter
            ? Math.min(parseInt(retryAfter, 10) * 1000 || 5000, 60_000)
            : Math.min(1000 * Math.pow(2, attempt), 30_000);
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          recordFailure();
          throw new Error(`Epic request failed with status ${res.status} after ${maxRetries + 1} attempts`);
        }
        recordSuccess();
        return res;
      } catch (e) {
        lastError = e;
        if (e.name === 'AbortError') {
          lastError = new Error('Epic request timed out');
        }
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        recordFailure();
      }
    }
    throw lastError;
  }

  async function getAccessToken() {
    const skewMs = 30_000;
    if (cached && cached.expiresAt - Date.now() > skewMs) {
      return cached;
    }
    const assertion = buildAssertion({
      clientId,
      tokenUrl,
      privateKeyPem,
      kid,
    });
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type:
        'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope,
    });
    const res = await fetchWithRetry(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      if (logger) logger.error({ status: res.status }, 'Epic token request failed');
      throw new Error(`Epic token request failed (${res.status})`);
    }
    const parsed = JSON.parse(text);
    cached = {
      accessToken: parsed.access_token,
      tokenType: parsed.token_type || 'Bearer',
      scope: parsed.scope,
      expiresAt: Date.now() + (parsed.expires_in || 3600) * 1000,
    };
    return cached;
  }

  async function fhirGet(resourcePath) {
    const tok = await getAccessToken();
    const url = resourcePath.startsWith('http')
      ? resourcePath
      : `${fhirBase}/${resourcePath.replace(/^\/+/, '')}`;
    const res = await fetchWithRetry(url, {
      headers: {
        authorization: `${tok.tokenType} ${tok.accessToken}`,
        accept: 'application/fhir+json',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      if (logger) logger.error({ status: res.status, path: resourcePath }, 'Epic FHIR GET failed');
      throw new Error(`Epic FHIR request failed (${res.status})`);
    }
    return JSON.parse(text);
  }

  /**
   * POST a FHIR resource.
   *
   * Two behaviours differ deliberately from fhirGet:
   *
   *   • No automatic retry. fetchWithRetry replays 5xx and 429 responses, which
   *     is correct for an idempotent read and dangerous for a create: Epic may
   *     have persisted the resource before the response failed, so a replay can
   *     file a second copy of a clinical document. Callers that need
   *     at-most-once semantics must supply an idempotency guard of their own.
   *   • The Location / resource id is returned, because a caller filing a
   *     document needs the identifier to record what it created.
   */
  async function fhirPost(resourcePath, resource, { headers = {} } = {}) {
    const tok = await getAccessToken();
    const url = resourcePath.startsWith('http')
      ? resourcePath
      : `${fhirBase}/${resourcePath.replace(/^\/+/, '')}`;

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        authorization: `${tok.tokenType} ${tok.accessToken}`,
        'content-type': 'application/fhir+json',
        accept: 'application/fhir+json',
        ...headers,
      },
      body: JSON.stringify(resource),
    });

    const text = await res.text();
    if (!res.ok) {
      if (logger) logger.error({ status: res.status, path: resourcePath }, 'Epic FHIR POST failed');
      // OperationOutcome carries the reason Epic rejected the write; surfacing
      // it verbatim is what makes a per-site enablement problem diagnosable
      // rather than an opaque 400.
      const err = new Error(`Epic FHIR create failed (${res.status})`);
      err.status = res.status;
      try { err.operationOutcome = JSON.parse(text); } catch { err.body = text; }
      throw err;
    }

    const location = res.headers?.get?.('location') || res.headers?.get?.('content-location') || null;
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* Epic may return an empty 201 */ }

    return {
      status: res.status,
      location,
      id: body?.id || (location ? location.split('/').filter(Boolean).slice(-3, -2)[0] : null),
      resource: body,
    };
  }

  /**
   * File a document into a patient's chart.
   *
   * The DocumentReference is supplied fully formed by the caller rather than
   * assembled here, because the document type coding is negotiated per
   * customer with their Epic team — there is no correct default, and guessing
   * one produces documents that land in the wrong place in the chart.
   */
  async function createDocumentReference(documentReference) {
    if (!documentReference || documentReference.resourceType !== 'DocumentReference') {
      throw new Error('createDocumentReference: a DocumentReference resource is required');
    }
    return fhirPost('DocumentReference', documentReference);
  }

  /**
   * Paginate a FHIR search by following Bundle.link[relation=next] until
   * exhausted or maxPages reached.
   */
  async function fhirSearchAll(resourcePath, { maxPages = 10 } = {}) {
    const allEntries = [];
    let nextUrl = resourcePath;
    for (let page = 0; page < maxPages && nextUrl; page++) {
      const bundle = await fhirGet(nextUrl);
      const entries = (bundle.entry || []).map((e) => e.resource).filter(Boolean);
      allEntries.push(...entries);
      const nextLink = (bundle.link || []).find((l) => l.relation === 'next');
      nextUrl = nextLink?.url || null;
    }
    return allEntries;
  }

  /**
   * Pull a USCDI-core bundle for a single patient. Returns:
   *   {
   *     patient, observations[], conditions[], medicationRequests[],
   *     allergies[], scopeGranted
   *   }
   */
  async function fetchPatientBundle(epicPatientId, fetchOpts = {}) {
    if (!epicPatientId) {
      throw new Error('fetchPatientBundle: epicPatientId is required');
    }
    const count = fetchOpts.count || 25;
    const tok = await getAccessToken();
    const [patient, labs, problems, meds, allergies] = await Promise.all([
      fhirGet(`Patient/${epicPatientId}`),
      fhirGet(
        `Observation?patient=${epicPatientId}&category=laboratory&_count=${count}`,
      ),
      fhirGet(
        `Condition?patient=${epicPatientId}&category=problem-list-item&_count=${count}`,
      ),
      fhirGet(`MedicationRequest?patient=${epicPatientId}&_count=${count}`),
      fhirGet(`AllergyIntolerance?patient=${epicPatientId}&_count=${count}`),
    ]);
    const entries = (b) => (b.entry || []).map((e) => e.resource).filter(Boolean);
    return {
      patient,
      observations: entries(labs),
      conditions: entries(problems),
      medicationRequests: entries(meds),
      allergies: entries(allergies),
      scopeGranted: tok.scope,
    };
  }

  return {
    getAccessToken,
    fhirGet,
    fhirPost,
    createDocumentReference,
    fhirSearchAll,
    fetchPatientBundle,
    config: { tokenUrl, fhirBase, clientId, kid, scope },
  };
}

/**
 * Convenience: build a client from a PEM file path on disk.
 */
function createEpicClientFromKeyFile(opts) {
  const path = opts?.privateKeyFile;
  if (!path) {
    throw new Error('createEpicClientFromKeyFile: privateKeyFile is required');
  }
  const pem = fs.readFileSync(path, 'utf8');
  return createEpicClient({ ...opts, privateKeyPem: pem });
}

module.exports = {
  DEFAULT_TOKEN_URL,
  DEFAULT_FHIR_BASE,
  DEFAULT_SCOPES,
  DOCUMENT_WRITE_SCOPE,
  buildAssertion,
  createEpicClient,
  createEpicClientFromKeyFile,
};
