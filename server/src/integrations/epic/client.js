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
 * Patient, Observation, Condition, MedicationRequest, AllergyIntolerance,
 * Encounter, Immunization, Procedure, and Organization.
 */

const { createSign, randomUUID } = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_TOKEN_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const DEFAULT_FHIR_BASE =
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';

/**
 * Minimal default scope set known to be granted by the Epic non-production
 * sandbox for a "Backend Systems" application with all USCDI-core read
 * APIs enabled.
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
  if (typeof httpFetch !== 'function') {
    throw new Error('createEpicClient: no fetch implementation available');
  }

  let cached = null;

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
    const res = await httpFetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Epic token request failed (${res.status}): ${text}`);
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
    const res = await httpFetch(url, {
      headers: {
        authorization: `${tok.tokenType} ${tok.accessToken}`,
        accept: 'application/fhir+json',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Epic FHIR GET ${resourcePath} failed (${res.status}): ${text}`,
      );
    }
    return JSON.parse(text);
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
  buildAssertion,
  createEpicClient,
  createEpicClientFromKeyFile,
};
