#!/usr/bin/env node
/**
 * TransTrack — Issue a signed customer license.
 *
 * Usage:
 *   node scripts/issue-license.mjs \
 *     --private-key keys/license/license-private.pem \
 *     --customer-name "Cleveland Clinic" \
 *     --customer-email "it.admin@ccf.org" \
 *     --org-id "ccf" \
 *     --tier enterprise \
 *     --expires 2027-12-31 \
 *     --max-patients 5000 \
 *     --max-users 100 \
 *     --max-installations 5 \
 *     --features all \
 *     --machines mid1,mid2 \
 *     --out licenses/ccf-2027.lic
 *
 * The `--machines` flag is a comma-separated list of *raw* machine
 * fingerprints (the hex string the app shows in Settings → License).
 * If omitted, the license is unbound and works on any machine — suitable
 * for site licenses, NOT for normal customer sales.
 *
 * `--features all` is a shortcut; otherwise pass a comma-separated
 * feature flag list from electron/license/tiers.cjs FEATURES.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { signLicense } = require('../electron/license/issuance.cjs');
const { hashForBinding } = require('../electron/license/machineId.cjs');
const { LICENSE_PROTOCOL_VERSION } = require('../electron/license/publisherPublicKey.cjs');
const tiers = require('../electron/license/tiers.cjs');

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return def;
}
function need(name) {
  const v = arg(name);
  if (!v) { console.error(`ERROR: --${name} is required`); process.exit(2); }
  return v;
}

const privKeyPath = need('private-key');
const out = need('out');

if (!fs.existsSync(privKeyPath)) {
  console.error(`ERROR: private key file not found: ${privKeyPath}`);
  process.exit(2);
}
const privateKeyPem = fs.readFileSync(privKeyPath, 'utf8');

const tier = need('tier');
if (!tiers.LICENSE_TIER || !Object.values(tiers.LICENSE_TIER).includes(tier)) {
  // tiers stub maps everything to 'enterprise', but the issuance contract
  // accepts any of the canonical tier strings:
  if (!['evaluation', 'starter', 'professional', 'enterprise'].includes(tier)) {
    console.error('ERROR: --tier must be one of: evaluation, starter, professional, enterprise');
    process.exit(2);
  }
}

const featuresFlag = arg('features', 'all');
let features;
if (featuresFlag === 'all') {
  features = Object.values(tiers.FEATURES);
} else {
  features = featuresFlag.split(',').map((f) => f.trim()).filter(Boolean);
}

const expires = need('expires');
const issuedAt = new Date().toISOString();
const expiresAt = new Date(expires + (expires.length === 10 ? 'T23:59:59Z' : '')).toISOString();

const maintenanceExpires = arg('maintenance-expires');
const maintenanceExpiresAt = maintenanceExpires
  ? new Date(maintenanceExpires + (maintenanceExpires.length === 10 ? 'T23:59:59Z' : '')).toISOString()
  : expiresAt;

const machinesArg = arg('machines', '');
const machineBindings = machinesArg
  ? machinesArg.split(',').map((m) => m.trim()).filter(Boolean).map((m) => hashForBinding(m))
  : [];

const payload = {
  licenseId: 'lic_' + crypto.randomBytes(8).toString('hex'),
  protocolVersion: LICENSE_PROTOCOL_VERSION,
  customer: {
    name: need('customer-name'),
    email: need('customer-email'),
    orgId: need('org-id'),
  },
  tier,
  issuedAt,
  expiresAt,
  maintenanceExpiresAt,
  limits: {
    maxPatients: parseInt(need('max-patients'), 10),
    maxUsers: parseInt(need('max-users'), 10),
    maxInstallations: parseInt(need('max-installations'), 10),
  },
  features,
  machineBindings,
  metadata: {
    issuedBy: 'TransTrack Sales',
    issuerHost: require('node:os').hostname(),
  },
};

const wire = signLicense(payload, privateKeyPem);

const outDir = path.dirname(out);
if (outDir && !fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, wire, { mode: 0o600 });

console.log(`License signed and written to ${out}`);
console.log('');
console.log('  licenseId:    ' + payload.licenseId);
console.log('  customer:     ' + payload.customer.name + ' <' + payload.customer.email + '>');
console.log('  orgId:        ' + payload.customer.orgId);
console.log('  tier:         ' + payload.tier);
console.log('  expiresAt:    ' + payload.expiresAt);
console.log('  maint expires:' + payload.maintenanceExpiresAt);
console.log('  patients:     ' + payload.limits.maxPatients);
console.log('  users:        ' + payload.limits.maxUsers);
console.log('  installs:     ' + payload.limits.maxInstallations);
console.log('  features:     ' + payload.features.length + ' feature flags');
console.log('  machines:     ' + (payload.machineBindings.length || 'unbound (site license)'));
console.log('');
console.log('Send the file at ' + out + ' to the customer.');
