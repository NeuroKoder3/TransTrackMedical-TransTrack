'use strict';

const { errors } = require('../util/errors');
const clients = require('./clients');
const backendJwt = require('./backendJwt');

/**
 * Parse OAuth client credentials from Authorization: Basic or request body.
 */
function parseClientCredentials(req, body = {}) {
  let basicClientId = null;
  let basicSecret = null;
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('basic ')) {
    const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon > 0) {
      basicClientId = decoded.slice(0, colon);
      basicSecret = decoded.slice(colon + 1);
    }
  }
  return {
    clientId: body.client_id || basicClientId,
    clientSecret: body.client_secret || basicSecret,
    clientAssertion: body.client_assertion,
    clientAssertionType: body.client_assertion_type,
  };
}

/**
 * Authenticate an OAuth client for introspection/revocation (RFC 7662 / RFC 7009).
 */
async function authenticateOAuthClient(req, body, { tokenUrl } = {}) {
  const { clientId, clientSecret, clientAssertion, clientAssertionType } =
    parseClientCredentials(req, body);
  if (!clientId) throw errors.unauthorized('client authentication required');

  const smartClient = await clients.getUnscoped(clientId);
  if (!smartClient) throw errors.unauthorized('invalid_client');

  if (smartClient.client_type === 'confidential') {
    const ok = await clients.verifySecret(smartClient, clientSecret);
    if (!ok) throw errors.unauthorized('invalid_client');
  } else if (smartClient.client_type === 'backend') {
    if (
      clientAssertion
      && clientAssertionType === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
      && tokenUrl
    ) {
      await backendJwt.verifyAssertion(smartClient, clientAssertion, tokenUrl);
    } else if (clientSecret) {
      const ok = await clients.verifySecret(smartClient, clientSecret);
      if (!ok) throw errors.unauthorized('invalid_client');
    } else {
      // Backend services must present a private_key_jwt assertion or a secret;
      // a bare client_id is not authentication.
      throw errors.unauthorized('client authentication required');
    }
  }

  return { clientId, smartClient };
}

module.exports = { parseClientCredentials, authenticateOAuthClient };
