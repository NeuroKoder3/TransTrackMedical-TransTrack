'use strict';

/**
 * Multi-tenant Epic configuration registry.
 *
 * The optional server tier serves more than one customer. Each customer
 * has its own Epic Connection Hub registration and therefore its own:
 *
 *   - Production / Non-Production Client ID
 *   - Token URL (Epic non-prod vs Epic prod, or a customer-specific
 *     interconnect endpoint)
 *   - FHIR base URL
 *   - JWKS / private-key file path (one keypair per customer registration)
 *   - kid (key id used in the JWT header)
 *   - granted scopes
 *
 * This registry resolves an `(orgId, environment)` pair to a fully-formed
 * client config without baking any customer credentials into source code.
 *
 * Two configuration sources are supported, in priority order:
 *
 *   1. JSON file pointed to by EPIC_CUSTOMERS_CONFIG (absolute path).
 *      Recommended for production; the file lives outside the source
 *      tree and is mounted as a secret in the container/deployment.
 *
 *   2. Per-customer environment variables:
 *
 *        EPIC_CLIENT_ID__<ORG_ID>__<ENV>
 *        EPIC_TOKEN_URL__<ORG_ID>__<ENV>
 *        EPIC_FHIR_BASE__<ORG_ID>__<ENV>
 *        EPIC_PRIVATE_KEY_FILE__<ORG_ID>__<ENV>
 *        EPIC_KID__<ORG_ID>__<ENV>
 *        EPIC_SCOPE__<ORG_ID>__<ENV>
 *
 *      `<ORG_ID>` is uppercased; non-[A-Z0-9_] characters are mapped to `_`.
 *      `<ENV>` is one of PROD or SANDBOX (default: SANDBOX).
 *
 * The default-envvar shape (no <ORG_ID> suffix) still works for single-
 * tenant deployments — it acts as the fallback when no per-customer entry
 * is found.
 *
 * The file format is:
 *   {
 *     "customers": {
 *       "<orgId>": {
 *         "prod":    { clientId, tokenUrl, fhirBase, privateKeyFile, kid?, scope? },
 *         "sandbox": { ... }
 *       },
 *       ...
 *     }
 *   }
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TOKEN_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const DEFAULT_FHIR_BASE =
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';

let _fileCache = null;
let _fileCachePath = null;
let _fileCacheMtimeMs = 0;

/**
 * Reset internal cache. Test-only.
 */
function resetCache() {
  _fileCache = null;
  _fileCachePath = null;
  _fileCacheMtimeMs = 0;
}

function _loadFile(filePath) {
  if (!filePath) return null;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      if (
        _fileCache &&
        _fileCachePath === filePath &&
        _fileCacheMtimeMs === stat.mtimeMs
      ) {
        fs.closeSync(fd);
        return _fileCache;
      }
      const raw = fs.readFileSync(fd, 'utf8');
      fs.closeSync(fd);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('config file did not parse to an object');
      }
      _fileCache = parsed;
      _fileCachePath = filePath;
      _fileCacheMtimeMs = stat.mtimeMs;
      return parsed;
    } catch (innerErr) {
      fs.closeSync(fd);
      throw innerErr;
    }
  } catch (e) {
    throw new Error(`Epic registry: failed to load ${filePath}: ${e.message}`);
  }
}

function _normaliseOrgId(orgId) {
  return String(orgId || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function _envFor(environment) {
  const e = String(environment || 'sandbox').toLowerCase();
  if (e !== 'prod' && e !== 'sandbox') {
    throw new Error(`Epic registry: environment must be 'prod' or 'sandbox', got '${environment}'`);
  }
  return e;
}

function _readEnv(orgId, environment, env) {
  const eUp = environment.toUpperCase();
  const orgUp = _normaliseOrgId(orgId);
  const k = (suffix) =>
    process.env[`EPIC_${suffix}__${orgUp}__${eUp}`] ??
    process.env[`EPIC_${suffix}`];
  return {
    clientId:        k('CLIENT_ID')        || env.clientId,
    tokenUrl:        k('TOKEN_URL')        || env.tokenUrl        || DEFAULT_TOKEN_URL,
    fhirBase:        k('FHIR_BASE')        || env.fhirBase        || DEFAULT_FHIR_BASE,
    privateKeyFile:  k('PRIVATE_KEY_FILE') || env.privateKeyFile,
    kid:             k('KID')              || env.kid             || 'transtrack-epic-1',
    scope:           k('SCOPE')            || env.scope           || null,
  };
}

/**
 * Resolve a config for (orgId, environment).
 *
 * Resolution order:
 *   1. file["customers"][orgId][environment]
 *   2. EPIC_*__<ORG_ID>__<ENV> env vars
 *   3. EPIC_* generic env vars (single-tenant fallback)
 *
 * @param {Object} args
 * @param {string} args.orgId
 * @param {string} [args.environment='sandbox']  'prod' or 'sandbox'
 * @returns {Object} normalised config
 * @throws if no clientId or no privateKeyFile resolved
 */
function getCustomerConfig(args) {
  if (!args || !args.orgId) {
    throw new Error('getCustomerConfig: orgId is required');
  }
  const environment = _envFor(args.environment);

  const filePath = process.env.EPIC_CUSTOMERS_CONFIG || null;
  let fileEntry = {};
  if (filePath) {
    const file = _loadFile(filePath);
    const customers = (file && file.customers) || {};
    const customer = customers[args.orgId] || {};
    fileEntry = customer[environment] || {};
  }

  const merged = _readEnv(args.orgId, environment, fileEntry);

  if (!merged.clientId) {
    throw new Error(
      `Epic registry: no clientId resolved for orgId='${args.orgId}' environment='${environment}'. ` +
      `Set EPIC_CLIENT_ID__${_normaliseOrgId(args.orgId)}__${environment.toUpperCase()} or add an entry ` +
      `to EPIC_CUSTOMERS_CONFIG.`
    );
  }
  if (!merged.privateKeyFile) {
    throw new Error(
      `Epic registry: no privateKeyFile resolved for orgId='${args.orgId}' environment='${environment}'. ` +
      `Set EPIC_PRIVATE_KEY_FILE__${_normaliseOrgId(args.orgId)}__${environment.toUpperCase()} or add an ` +
      `entry to EPIC_CUSTOMERS_CONFIG.`
    );
  }

  return {
    orgId: args.orgId,
    environment,
    clientId: merged.clientId,
    tokenUrl: merged.tokenUrl,
    fhirBase: merged.fhirBase,
    privateKeyFile: path.resolve(merged.privateKeyFile),
    kid: merged.kid,
    scope: merged.scope,
  };
}

/**
 * List all configured customers across both environments. Used for the
 * admin UI / health check.
 */
function listConfiguredCustomers() {
  const out = [];
  const filePath = process.env.EPIC_CUSTOMERS_CONFIG || null;
  if (filePath) {
    const file = _loadFile(filePath);
    const customers = (file && file.customers) || {};
    for (const orgId of Object.keys(customers)) {
      for (const environment of ['sandbox', 'prod']) {
        const entry = customers[orgId][environment];
        if (entry && entry.clientId) {
          out.push({ orgId, environment, source: 'file' });
        }
      }
    }
  }
  // Env-var detected customers (deduplicated against file)
  const envOrgIds = new Set();
  for (const k of Object.keys(process.env)) {
    const m = /^EPIC_CLIENT_ID__([A-Z0-9_]+)__(PROD|SANDBOX)$/.exec(k);
    if (m) envOrgIds.add(`${m[1]}|${m[2]}`);
  }
  for (const item of envOrgIds) {
    const [normOrg, envUp] = item.split('|');
    const environment = envUp.toLowerCase();
    if (!out.find((o) => _normaliseOrgId(o.orgId) === normOrg && o.environment === environment)) {
      out.push({ orgId: normOrg, environment, source: 'env' });
    }
  }
  return out;
}

module.exports = {
  DEFAULT_TOKEN_URL,
  DEFAULT_FHIR_BASE,
  getCustomerConfig,
  listConfiguredCustomers,
  resetCache,
};
