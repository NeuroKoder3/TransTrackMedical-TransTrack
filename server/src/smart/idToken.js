'use strict';

/**
 * SMART on FHIR / OIDC ID token signing (M-26).
 *
 * ID tokens used to be HS256-signed with JWT_SECRET — the same key that
 * signs TransTrack's own API access tokens. That is wrong twice over: an ID
 * token is meant to be verified by the relying party, so every SMART client
 * would need the server's API signing secret to check one, and any client
 * holding it could mint API access tokens for any user in any organisation.
 *
 * ID tokens are therefore signed asymmetrically with a dedicated key whose
 * public half is published at /.well-known/jwks.json. Relying parties verify
 * against the JWKS and never hold a secret.
 *
 * Key material:
 *   SMART_ID_TOKEN_KEY_FILE  PEM private key (RSA for RS256, EC P-256 for ES256)
 *   SMART_ID_TOKEN_ALG       RS256 (default) or ES256
 *   SMART_ID_TOKEN_KID       key id published in the JWKS and the JWT header
 *
 * Production refuses to sign without a configured key: an ephemeral key is
 * regenerated on restart and differs per replica, so tokens would verify
 * only by luck. Development and test fall back to an ephemeral key pair.
 */

const fs = require('fs');
const {
  createPrivateKey, createPublicKey, createSign,
  generateKeyPairSync, sign: cryptoSign,
} = require('crypto');

const ALGS = Object.freeze({
  RS256: { keyType: 'rsa', hash: 'RSA-SHA256' },
  ES256: { keyType: 'ec', hash: 'sha256' },
});

let cached = null;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function generateEphemeral(alg) {
  if (alg === 'ES256') {
    return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  }
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
}

/**
 * Resolve (and memoise) the signing key. Throws when production has no key
 * configured — failing the token request is the only safe outcome, because
 * the alternative is issuing identity assertions nobody can verify.
 */
function getSigningKey(config) {
  const alg = config.SMART_ID_TOKEN_ALG || 'RS256';
  const spec = ALGS[alg];
  if (!spec) throw new Error(`Unsupported SMART_ID_TOKEN_ALG: ${alg}`);
  const kid = config.SMART_ID_TOKEN_KID || 'transtrack-id-token-1';
  const keyFile = config.SMART_ID_TOKEN_KEY_FILE || '';

  if (cached && cached.alg === alg && cached.kid === kid && cached.keyFile === keyFile) {
    return cached;
  }

  let privateKey;
  if (keyFile) {
    privateKey = createPrivateKey(fs.readFileSync(keyFile, 'utf8'));
    if (privateKey.asymmetricKeyType !== spec.keyType) {
      throw new Error(
        `SMART_ID_TOKEN_KEY_FILE holds a ${privateKey.asymmetricKeyType} key but ` +
        `SMART_ID_TOKEN_ALG=${alg} requires ${spec.keyType}`
      );
    }
  } else if (config.NODE_ENV === 'production') {
    throw new Error(
      'SMART_ID_TOKEN_KEY_FILE is required in production to sign OIDC ID tokens. ' +
      'Generate one with: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 ' +
      '-out id-token.pem'
    );
  } else {
    privateKey = generateEphemeral(alg);
  }

  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  cached = { alg, kid, keyFile, privateKey, publicJwk, ephemeral: !keyFile };
  return cached;
}

function signWith(key, alg, signingInput) {
  if (alg === 'ES256') {
    return cryptoSign('sha256', Buffer.from(signingInput),
      { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  }
  const signer = createSign(ALGS[alg].hash);
  signer.update(signingInput);
  signer.end();
  return signer.sign(key).toString('base64url');
}

/**
 * Mint an OIDC ID token. `aud` is the SMART client, `iss` is this server;
 * both are bound into the token rather than left to the relying party.
 */
function signIdToken(config, { issuer, clientId, userId, nonce, fhirUser }) {
  if (!issuer) throw new Error('ID token requires an issuer');
  if (!clientId) throw new Error('ID token requires an audience (client_id)');
  const { alg, kid, privateKey } = getSigningKey(config);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg, typ: 'JWT', kid };
  const payload = {
    iss: issuer,
    sub: String(userId),
    aud: clientId,
    iat: now,
    exp: now + (config.SMART_ID_TOKEN_TTL_SECONDS || 3600),
    fhirUser: fhirUser || `Practitioner/${userId}`,
  };
  if (nonce) payload.nonce = nonce;
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${signingInput}.${signWith(privateKey, alg, signingInput)}`;
}

/** Public JWK Set served at /.well-known/jwks.json. */
function publicJwks(config) {
  const { alg, kid, publicJwk } = getSigningKey(config);
  return { keys: [{ ...publicJwk, kid, alg, use: 'sig' }] };
}

/** Test seam: drop the memoised key so a new config takes effect. */
function resetSigningKey() {
  cached = null;
}

module.exports = {
  signIdToken, publicJwks, getSigningKey, resetSigningKey,
  SUPPORTED_ALGS: Object.keys(ALGS),
};
