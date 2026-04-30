'use strict';

const client = require('./client');
const importPatient = require('./importPatient');
const registry = require('./registry');

/**
 * Multi-tenant convenience: build an Epic client for a specific
 * customer/environment by resolving the config from the registry.
 *
 * @param {Object} args
 * @param {string} args.orgId
 * @param {string} [args.environment='sandbox']
 * @param {Object} [args.opts]   any extra options forwarded to createEpicClientFromKeyFile
 */
function createEpicClientForCustomer(args) {
  const cfg = registry.getCustomerConfig({
    orgId: args.orgId,
    environment: args.environment,
  });
  return client.createEpicClientFromKeyFile({
    clientId: cfg.clientId,
    tokenUrl: cfg.tokenUrl,
    fhirBase: cfg.fhirBase,
    privateKeyFile: cfg.privateKeyFile,
    kid: cfg.kid,
    scope: cfg.scope || undefined,
    ...(args.opts || {}),
  });
}

module.exports = {
  ...client,
  ...importPatient,
  registry,
  createEpicClientForCustomer,
};
