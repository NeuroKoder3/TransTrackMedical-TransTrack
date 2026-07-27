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

const JWT_BEARER_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/**
 * Authenticate an OAuth client for introspection/revocation (RFC 7662 / RFC 7009).
 *
 * Exactly one verification path exists per registered client type — the
 * caller cannot select a weaker path by shaping the request:
 *   confidential -> client secret (Basic or client_secret_post), always verified
 *   backend      -> private_key_jwt assertion, always verified
 *   anything else (public/unknown) -> rejected; public clients cannot
 *                   authenticate and are not permitted on these endpoints
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
    if (!tokenUrl || clientAssertionType !== JWT_BEARER_ASSERTION_TYPE || !clientAssertion) {
      throw errors.unauthorized('client authentication required');
    }
    await backendJwt.verifyAssertion(smartClient, clientAssertion, tokenUrl);
  } else {
    throw errors.unauthorized('invalid_client');
  }

  return { clientId, smartClient };
}

module.exports = { parseClientCredentials, authenticateOAuthClient };
