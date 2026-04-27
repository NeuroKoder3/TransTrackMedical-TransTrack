#!/usr/bin/env node
// Minimal token-only test: tries multiple scope variants to figure out
// what Epic accepts. Stops at the first one that works.
//
// Required env:
//   EPIC_SANDBOX_CLIENT_ID
//
// Usage:
//   $env:EPIC_SANDBOX_CLIENT_ID = "<id>"
//   node scripts/epic-token-only.mjs

import { createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT_ID = process.env.EPIC_SANDBOX_CLIENT_ID;
const TOKEN_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const PRIVATE_KEY = readFileSync(
  resolve('epic-keys/transtrack-epic-private.pem'),
  'utf8',
);

if (!CLIENT_ID) {
  console.error('Set EPIC_SANDBOX_CLIENT_ID first.');
  process.exit(1);
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function buildAssertion() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS384', typ: 'JWT', kid: 'transtrack-epic-1' };
  const payload = {
    iss: CLIENT_ID,
    sub: CLIENT_ID,
    aud: TOKEN_URL,
    jti: randomUUID(),
    iat: now,
    exp: now + 240,
  };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA384');
  signer.update(`${h}.${p}`);
  signer.end();
  const sig = b64url(signer.sign(PRIVATE_KEY));
  return `${h}.${p}.${sig}`;
}

async function tryScope(scopeLabel, scopeValue) {
  const params = {
    grant_type: 'client_credentials',
    client_assertion_type:
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: buildAssertion(),
  };
  if (scopeValue !== null) params.scope = scopeValue;

  const body = new URLSearchParams(params);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  console.log(`\n--- scope: ${scopeLabel} ---`);
  console.log(`HTTP ${res.status}`);
  console.log(text);
  return res.ok;
}

const variants = [
  ['<no scope>', null],
  ['system/*.read', 'system/*.read'],
  ['system/*.*', 'system/*.*'],
  ['system/Patient.read', 'system/Patient.read'],
  ['system/Condition.read', 'system/Condition.read'],
  [
    'system/Condition.read system/AllergyIntolerance.read',
    'system/Condition.read system/AllergyIntolerance.read',
  ],
  ['Patient.read', 'Patient.read'],
  ['openid fhirUser', 'openid fhirUser'],
];

(async () => {
  for (const [label, scope] of variants) {
    const ok = await tryScope(label, scope);
    if (ok) {
      console.log('\n*** SUCCESS with scope: ' + label + ' ***');
      process.exit(0);
    }
  }
  console.log('\nAll scope variants rejected. Issue is not scope-related.');
})();
