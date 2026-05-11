'use strict';

/**
 * Verify a SMART Backend Services JWT assertion (client_assertion_type=
 * urn:ietf:params:oauth:client-assertion-type:jwt-bearer).
 *
 * Per HL7 SMART Backend Services Authorization, the JWT is signed by the
 * client using a private key whose public counterpart is published as a
 * JWK Set at smart_clients.jwks_uri (or stored inline in smart_clients.jwks).
 *
 * Signature algorithms supported: RS256, RS384, ES256, ES384.
 *
 * This is a minimal, standards-conformant verifier — it covers the JWT
 * header / payload checks and dispatches to Node's built-in crypto for
 * signature verification. JWKS fetching is over plain HTTPS (no caching
 * in this minimal implementation; production should add a 5-minute LRU).
 */

const { createPublicKey, createVerify, verify: cryptoVerify } = require('crypto');
const https = require('https');

const ALG_TO_HASH = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
  ES256: 'sha256',
  ES384: 'sha384',
  ES512: 'sha512',
};

function b64urlDecode(s) {
  return Buffer.from(s, 'base64url').toString('utf8');
}

async function fetchJwks(uri) {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'https:') {
    throw new Error('jwks_uri must use HTTPS');
  }
  return new Promise((resolve, reject) => {
    const req = https.get(uri, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`jwks_uri returned ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('jwks fetch timeout')));
  });
}

function findKey(jwks, kid, alg) {
  if (!jwks?.keys) return null;
  for (const k of jwks.keys) {
    if (kid && k.kid && k.kid !== kid) continue;
    if (alg && k.alg && k.alg !== alg) continue;
    if (k.use && k.use !== 'sig') continue;
    return k;
  }
  return null;
}

function jwkToPublicKey(jwk) {
  return createPublicKey({ key: jwk, format: 'jwk' });
}

/**
 * Verify a client_assertion JWT. Resolves with the parsed payload on success.
 *
 *   smartClient: row from smart_clients
 *   assertion:   the JWT string
 *   tokenUrl:    our /token endpoint (must equal the JWT aud)
 */
async function verifyAssertion(smartClient, assertion, tokenUrl) {
  if (typeof assertion !== 'string' || assertion.split('.').length !== 3) {
    throw new Error('invalid_request: malformed assertion');
  }
  const [headB64, payloadB64, sigB64] = assertion.split('.');
  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(headB64));
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    throw new Error('invalid_request: bad base64');
  }
  if (!header.alg || !ALG_TO_HASH[header.alg]) {
    throw new Error('invalid_request: unsupported alg ' + header.alg);
  }
  // Issuer & subject MUST be the client_id
  if (payload.iss !== smartClient.client_id || payload.sub !== smartClient.client_id) {
    throw new Error('invalid_grant: iss/sub mismatch');
  }
  if (!payload.aud || (Array.isArray(payload.aud)
        ? !payload.aud.includes(tokenUrl)
        : payload.aud !== tokenUrl)) {
    throw new Error('invalid_grant: aud mismatch');
  }
  if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error('invalid_grant: assertion expired');
  }
  if (!payload.jti) throw new Error('invalid_request: jti required');

  // Resolve JWKS
  let jwks = smartClient.jwks;
  if (!jwks && smartClient.jwks_uri) jwks = await fetchJwks(smartClient.jwks_uri);
  if (!jwks) throw new Error('invalid_client: no JWKS configured for client');
  const jwk = findKey(jwks, header.kid, header.alg);
  if (!jwk) throw new Error('invalid_client: no matching key (kid=' + header.kid + ')');

  // Verify signature
  const signingInput = Buffer.from(`${headB64}.${payloadB64}`);
  const signature = Buffer.from(sigB64, 'base64url');
  const pubKey = jwkToPublicKey(jwk);

  let verified;
  if (header.alg.startsWith('RS')) {
    const verifier = createVerify(ALG_TO_HASH[header.alg]);
    verifier.update(signingInput);
    verifier.end();
    verified = verifier.verify(pubKey, signature);
  } else if (header.alg.startsWith('ES')) {
    verified = cryptoVerify(ALG_TO_HASH[header.alg], signingInput,
      { key: pubKey, dsaEncoding: 'ieee-p1363' }, signature);
  } else {
    throw new Error('invalid_request: alg not supported');
  }
  if (!verified) throw new Error('invalid_grant: signature verification failed');
  return payload;
}

module.exports = { verifyAssertion, fetchJwks };
