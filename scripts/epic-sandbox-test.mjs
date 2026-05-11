#!/usr/bin/env node
// End-to-end Epic sandbox smoke test.
//
// Uses SMART Backend Services: signs a JWT with our private key, exchanges
// it for an access token, then pulls a sandbox patient + their labs +
// problems + medications + allergies and prints a short summary.
//
// Required env:
//   EPIC_SANDBOX_CLIENT_ID    Non-Production Client ID from fhir.epic.com
//
// Optional env:
//   EPIC_TOKEN_URL            override (defaults to Epic R4 sandbox)
//   EPIC_FHIR_BASE            override (defaults to Epic R4 sandbox)
//   EPIC_PATIENT_ID           override (defaults to Camila Maria Lopez)
//   EPIC_PRIVATE_KEY_FILE     override (defaults to epic-keys/transtrack-epic-private.pem)
//
// Usage:
//   $env:EPIC_SANDBOX_CLIENT_ID = "<client-id>"
//   node scripts/epic-sandbox-test.mjs

import { createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOKEN_URL =
  process.env.EPIC_TOKEN_URL ||
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const FHIR_BASE =
  process.env.EPIC_FHIR_BASE ||
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';
const CLIENT_ID = process.env.EPIC_SANDBOX_CLIENT_ID;
const PATIENT_ID = process.env.EPIC_PATIENT_ID || 'erXuFYUfucBZaryVksYEcMg3'; // Camila Maria Lopez
const PRIVATE_KEY_FILE =
  process.env.EPIC_PRIVATE_KEY_FILE || 'epic-keys/transtrack-epic-private.pem';

if (!CLIENT_ID) {
  console.error('Set EPIC_SANDBOX_CLIENT_ID before running this script.');
  process.exit(1);
}

const PRIVATE_KEY = readFileSync(resolve(PRIVATE_KEY_FILE), 'utf8');

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

function buildAssertion() {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { alg: 'RS384', typ: 'JWT', kid: 'transtrack-epic-1' },
    {
      iss: CLIENT_ID,
      sub: CLIENT_ID,
      aud: TOKEN_URL,
      jti: randomUUID(),
      iat: now,
      exp: now + 240,
    },
    PRIVATE_KEY,
  );
}

async function getToken() {
  const assertion = buildAssertion();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type:
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    scope:
      process.env.EPIC_SCOPE ||
      'system/Patient.read system/Patient.search',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}):\n${text}`);
  }
  return JSON.parse(text);
}

async function fhirGet(token, path) {
  const url = path.startsWith('http') ? path : `${FHIR_BASE}/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`FHIR ${path} failed (${res.status}):\n${text}`);
  }
  return JSON.parse(text);
}

(async () => {
  function redact(val) {
    if (!val || val.length <= 6) return '***';
    return val.slice(0, 3) + '***' + val.slice(-3);
  }

  console.log('--- Epic sandbox SMART Backend Services test ---');
  console.log('Token URL :', TOKEN_URL.replace(/\/\/[^/]+/, '//<host>'));
  console.log('FHIR base :', FHIR_BASE.replace(/\/\/[^/]+/, '//<host>'));
  console.log('Patient   :', redact(PATIENT_ID));
  console.log('');

  console.log('Step 1 - request access token (JWT bearer)...');
  const tok = await getToken();
  console.log(
    `  granted ${tok.token_type} for ${tok.expires_in}s, scope="${tok.scope || '(none)'}"`,
  );
  console.log('');

  console.log('Step 2 - GET Patient/' + redact(PATIENT_ID));
  const patient = await fhirGet(tok.access_token, `Patient/${PATIENT_ID}`);
  const name = patient.name?.[0];
  console.log(
    `  ${name?.family ? name.family[0] + '***' : '?'}, ${name?.given?.[0]?.[0] || '?'}***  | DOB ****-**-${patient.birthDate?.slice(-2) || '**'}  | gender ${patient.gender}`,
  );
  console.log('');

  console.log('Step 3 - GET Observation?patient=...&category=laboratory');
  const labs = await fhirGet(
    tok.access_token,
    `Observation?patient=${PATIENT_ID}&category=laboratory&_count=10`,
  );
  console.log(`  ${labs.entry?.length || 0} lab observations`);
  console.log('');

  console.log('Step 4 - GET Condition?patient=...&category=problem-list-item');
  const probs = await fhirGet(
    tok.access_token,
    `Condition?patient=${PATIENT_ID}&category=problem-list-item&_count=10`,
  );
  console.log(`  ${probs.entry?.length || 0} active problems`);
  console.log('');

  console.log('Step 5 - GET MedicationRequest?patient=...');
  const meds = await fhirGet(
    tok.access_token,
    `MedicationRequest?patient=${PATIENT_ID}&_count=10`,
  );
  console.log(`  ${meds.entry?.length || 0} medication requests`);
  console.log('');

  console.log('Step 6 - GET AllergyIntolerance?patient=...');
  const alg = await fhirGet(
    tok.access_token,
    `AllergyIntolerance?patient=${PATIENT_ID}&_count=10`,
  );
  console.log(`  ${alg.entry?.length || 0} allergies`);
  console.log('');

  console.log('SUCCESS - Epic sandbox round-trip complete.');
})().catch(() => {
  console.error('FAILED: request failed. Check configuration and endpoint availability.');
  process.exitCode = 1;
});
