#!/usr/bin/env node
// Diagnose Epic Backend Services 'invalid_client' issues.
//
// Required env:
//   EPIC_SANDBOX_CLIENT_ID    Non-Production Client ID
//   EPIC_JWKS_URL             The exact URL you pasted into Epic's JWK Set URL
//                             field (https://gist.githubusercontent.com/.../raw/.../jwks.json)
//
// Optional env:
//   EPIC_PRIVATE_KEY_FILE     defaults to epic-keys/transtrack-epic-private.pem
//
// Usage:
//   $env:EPIC_SANDBOX_CLIENT_ID = "<id>"
//   $env:EPIC_JWKS_URL         = "<raw gist url>"
//   node scripts/epic-diagnose.mjs

import { createPrivateKey, createPublicKey, createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT_ID = process.env.EPIC_SANDBOX_CLIENT_ID;
const JWKS_URL = process.env.EPIC_JWKS_URL;
const PRIVATE_KEY_FILE =
  process.env.EPIC_PRIVATE_KEY_FILE || 'epic-keys/transtrack-epic-private.pem';
const TOKEN_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';

function fail(msg) {
  console.error('\n[FAIL]', msg);
  process.exitCode = 1;
}
function ok(msg) {
  console.log('[ OK ]', msg);
}
function info(msg) {
  console.log('       ' + msg);
}

console.log('=== Epic SMART Backend Services diagnostic ===\n');

// 1. ENV
if (!CLIENT_ID) {
  fail('EPIC_SANDBOX_CLIENT_ID not set');
  process.exit(1);
}
ok(`Client ID set (${CLIENT_ID.slice(0, 8)}...${CLIENT_ID.slice(-4)})`);
if (!JWKS_URL) {
  fail(
    'EPIC_JWKS_URL not set — paste the exact value you put in Epic\'s JWK Set URL field',
  );
  process.exit(1);
}
ok(`JWKS URL set: ${JWKS_URL}`);
console.log();

// 2. Local private key + derived JWK
let localJwk;
try {
  const pem = readFileSync(resolve(PRIVATE_KEY_FILE), 'utf8');
  const priv = createPrivateKey(pem);
  const pub = createPublicKey(priv);
  localJwk = pub.export({ format: 'jwk' });
  ok(
    `Local private key loaded: ${PRIVATE_KEY_FILE} (kty=${localJwk.kty}, n length=${localJwk.n?.length})`,
  );
} catch (e) {
  fail(`Could not read private key: ${e.message}`);
  process.exit(1);
}
console.log();

// 3. Fetch the JWKS
let remoteJwks;
try {
  const res = await fetch(JWKS_URL, { redirect: 'follow' });
  if (!res.ok) {
    fail(`JWKS URL returned HTTP ${res.status}`);
    info('Open it in an incognito browser window. If you see a login page,');
    info('the gist is secret, not public. Re-create as a public gist.');
    process.exit(1);
  }
  const text = await res.text();
  ok(`JWKS URL reachable (${text.length} bytes)`);
  try {
    remoteJwks = JSON.parse(text);
  } catch (e) {
    fail('JWKS URL did not return valid JSON');
    info('First 200 chars: ' + text.slice(0, 200));
    process.exit(1);
  }
} catch (e) {
  fail(`Could not fetch JWKS URL: ${e.message}`);
  process.exit(1);
}
console.log();

// 4. JWKS structure
if (!remoteJwks.keys || !Array.isArray(remoteJwks.keys) || remoteJwks.keys.length === 0) {
  fail('JWKS does not contain a non-empty "keys" array');
  info('Got: ' + JSON.stringify(remoteJwks).slice(0, 200));
  process.exit(1);
}
ok(`JWKS contains ${remoteJwks.keys.length} key(s)`);
const remoteJwk = remoteJwks.keys[0];
info(`First key: kty=${remoteJwk.kty}, alg=${remoteJwk.alg || '(none)'}, kid=${remoteJwk.kid || '(none)'}, use=${remoteJwk.use || '(none)'}`);
console.log();

// 5. Compare local pubkey with remote JWK
if (remoteJwk.n !== localJwk.n) {
  fail('Public key in JWKS does NOT match local private key');
  info('This means: the JWKS you hosted was generated from a DIFFERENT key');
  info('than the one in epic-keys/transtrack-epic-private.pem.');
  info('');
  info('Fix:');
  info('  1) cd C:\\TransTrack');
  info('  2) node scripts/epic-make-jwks.mjs  (regenerates jwks.json from CURRENT pem)');
  info('  3) Edit your gist with the new contents (or create a new one)');
  info('  4) Re-save Epic app with the new raw URL');
  process.exit(1);
}
ok('Public key in JWKS matches local private key');

if (remoteJwk.alg && remoteJwk.alg !== 'RS384') {
  fail(`JWKS key alg is "${remoteJwk.alg}" but our JWT signs with RS384`);
  info('Edit jwks.json so "alg" is "RS384" (or change the script to match).');
  process.exit(1);
}
ok('Algorithm matches (RS384)');

if (remoteJwk.kid && remoteJwk.kid !== 'transtrack-epic-1') {
  fail(
    `JWKS key kid is "${remoteJwk.kid}" but our JWT header uses kid="transtrack-epic-1"`,
  );
  info('Either:');
  info('  - Edit jwks.json so "kid" is "transtrack-epic-1", or');
  info('  - Change the kid in scripts/epic-sandbox-test.mjs to match');
  process.exit(1);
}
ok('kid matches (transtrack-epic-1)');
console.log();

// 6. Build + display the assertion (so we can see what Epic sees)
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
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
const pem = readFileSync(resolve(PRIVATE_KEY_FILE), 'utf8');
const sig = b64url(signer.sign(pem));
const jwt = `${h}.${p}.${sig}`;
ok('JWT assertion built locally');
info('header  : ' + JSON.stringify(header));
info('payload : ' + JSON.stringify(payload));
info('full jwt: ' + jwt);
console.log();

// 7. Hit Epic
console.log('Submitting to Epic token endpoint...');
const body = new URLSearchParams({
  grant_type: 'client_credentials',
  client_assertion_type:
    'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  client_assertion: jwt,
});
const res = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
});
const text = await res.text();
console.log(`Epic returned HTTP ${res.status}:`);
console.log(text);
console.log();

if (res.ok) {
  ok('Epic accepted the assertion. Token issued.');
  ok('You can now run:  node scripts/epic-sandbox-test.mjs');
} else if (text.includes('invalid_client')) {
  fail('Epic still says invalid_client even though local checks pass.');
  info('Most likely causes at this point:');
  info('  1) You did not actually paste the JWKS URL into the Non-Production');
  info('     JWK Set URL field on the Epic app, or you forgot to click Save.');
  info('  2) The Epic app is still in Draft state. Look for a "Ready for Sandbox"');
  info('     button on the app detail page.');
  info('  3) Epic has not yet fetched/cached your JWKS. Wait 60s and retry.');
  info('  4) The Client ID belongs to a DIFFERENT app from the one with the');
  info('     JWKS URL configured. Open the app in Epic and verify the Client');
  info('     ID at the top matches what you set in EPIC_SANDBOX_CLIENT_ID.');
}
