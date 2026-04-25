'use strict';

const { SAML } = require('@node-saml/node-saml');

/**
 * SAML 2.0 Service-Provider helper. Uses the standalone @node-saml/node-saml
 * package — no Express/Passport coupling, so it slots into Fastify cleanly.
 *
 * Hospital IdP attribute mapping:
 *   - email   ← SAML_EMAIL_ATTRIBUTE  (default: eduPerson email OID)
 *   - name    ← SAML_NAME_ATTRIBUTE
 *   - role    ← SAML_ROLE_ATTRIBUTE   (eduPersonEntitlement-style)
 *
 * The SAML assertion is verified, then the API exchanges it for a TransTrack
 * JWT access token via the standard issueLocalSession() helper.
 */

let samlClient = null;

function init(config) {
  if (!config.SAML_ENABLED) return null;
  samlClient = new SAML({
    entryPoint: config.SAML_ENTRY_POINT,
    issuer: config.SAML_ISSUER,
    callbackUrl: config.SAML_CALLBACK_URL,
    idpCert: config.SAML_IDP_CERT,
    wantAssertionsSigned: true,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    acceptedClockSkewMs: 5000,
    disableRequestedAuthnContext: true,
  });
  return samlClient;
}

function get() {
  if (!samlClient) throw new Error('SAML is not enabled');
  return samlClient;
}

/**
 * Build a redirect URL the browser should follow to begin SAML SSO.
 */
async function buildLoginUrl(relayState) {
  return get().getAuthorizeUrlAsync(relayState || '/');
}

/**
 * Validate a POSTed SAMLResponse and return the asserted profile.
 */
async function validatePostResponse(samlResponseB64, requestBody) {
  const { profile } = await get().validatePostResponseAsync({
    SAMLResponse: samlResponseB64,
    RelayState: requestBody?.RelayState,
  });
  return profile;
}

function extractAttributes(profile, config) {
  const a = profile?.attributes || profile || {};
  const get = (k) => {
    const v = a[k] || a[k?.toLowerCase?.()] || profile?.[k];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  return {
    email: get(config.SAML_EMAIL_ATTRIBUTE) || profile?.nameID,
    name: get(config.SAML_NAME_ATTRIBUTE),
    role: get(config.SAML_ROLE_ATTRIBUTE),
    nameId: profile?.nameID,
    rawAttributes: a,
  };
}

module.exports = { init, buildLoginUrl, validatePostResponse, extractAttributes };
