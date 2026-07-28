/**
 * Epic PRODUCTION connectivity verification.
 *
 * Runs the same token → scope → metadata → patient-pull sequence as the
 * sandbox diagnostic, but against a customer's production (or TST)
 * Interconnect endpoints, and writes a timestamped evidence file to
 * demo-evidence/ suitable for due-diligence packets.
 *
 * All configuration comes from environment variables so no production
 * endpoint, client ID, or key path is ever committed to the repository:
 *
 *   EPIC_PROD_CLIENT_ID         (required) production client ID from Epic
 *                               Connection Hub / customer's App Market record
 *   EPIC_PROD_PRIVATE_KEY_FILE  (required) path to the RS384 private key PEM
 *   EPIC_PROD_TOKEN_URL         (required) customer Interconnect token URL,
 *                               e.g. https://ic.example-health.org/interconnect-prd-fhir/oauth2/token
 *   EPIC_PROD_FHIR_BASE         (required) customer FHIR R4 base,
 *                               e.g. https://ic.example-health.org/interconnect-prd-fhir/api/FHIR/R4
 *   EPIC_PROD_TEST_PATIENT      (optional) FHIR Patient id to pull; when unset,
 *                               the run stops after the metadata check (no PHI touched)
 *   EPIC_PROD_KID               (optional) JWKS key id, default transtrack-epic-1
 *
 * Usage: node scripts/epic-production-check.mjs
 *
 * NOTE ON PHI: when EPIC_PROD_TEST_PATIENT is set, the evidence file records
 * pass/fail status only — no names, DOBs, MRNs, values, or raw HTTP response
 * bodies are written to disk. Network-derived detail is printed to stdout
 * only so it never reaches the filesystem (CodeQL js/http-to-file-access).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { createEpicClientFromKeyFile, DEFAULT_SCOPES } = require('../server/src/integrations/epic/client.js');

const CLIENT_ID   = process.env.EPIC_PROD_CLIENT_ID;
const KEY_FILE    = process.env.EPIC_PROD_PRIVATE_KEY_FILE;
const TOKEN_URL   = process.env.EPIC_PROD_TOKEN_URL;
const FHIR_BASE   = process.env.EPIC_PROD_FHIR_BASE;
const TEST_PATIENT = process.env.EPIC_PROD_TEST_PATIENT || null;
const KID         = process.env.EPIC_PROD_KID || 'transtrack-epic-1';

function tick(label) { process.stdout.write(`\n  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label) { process.stdout.write(`\n  \x1b[31m✗\x1b[0m ${label}`); }
function info(label) { process.stdout.write(`\n  \x1b[36m·\x1b[0m ${label}`); }
function section(title) { console.log(`\n\x1b[1m\x1b[34m── ${title} ──\x1b[0m`); }

/**
 * Evidence statuses are closed enums of string literals only.
 * Never assign err.message, response bodies, or other network-derived
 * strings into this object — that is what CodeQL flags as http-to-file.
 */
const evidenceStatus = {
  tokenExchange: 'NOT_RUN',
  scopes: 'NOT_RUN',
  metadata: 'NOT_RUN',
  patientPull: 'NOT_RUN',
};

function redactHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid URL)';
  }
}

/**
 * Build the evidence file from local timestamps, env-derived host, and the
 * closed-enum status object. No network-derived strings are included.
 */
function buildEvidenceBody(exitCode) {
  const lines = [
    'TransTrack Epic production verification',
    `Run at (UTC): ${new Date().toISOString()}`,
    `Endpoint host: ${redactHost(FHIR_BASE)}`,
    `Client ID: ${String(CLIENT_ID).slice(0, 8)}... (truncated)`,
    '',
    `Token exchange: ${evidenceStatus.tokenExchange}`,
    `Scopes: ${evidenceStatus.scopes}`,
    `Metadata: ${evidenceStatus.metadata}`,
    `Patient pull: ${evidenceStatus.patientPull}`,
    '',
    `Exit code: ${Number(exitCode) || 0}`,
  ];
  return lines.join('\n') + '\n';
}

function writeEvidence(exitCode) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const dir = path.join(__dirname, '..', 'demo-evidence');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `epic-production-${stamp}.txt`);
  fs.writeFileSync(file, buildEvidenceBody(exitCode), 'utf8');
  console.log(`\n\n  Evidence written to ${file}`);
}

async function run() {
  console.log('\n\x1b[1mTransTrack × Epic PRODUCTION Verification\x1b[0m');

  const missingEnv = [];
  if (!CLIENT_ID) missingEnv.push('EPIC_PROD_CLIENT_ID');
  if (!KEY_FILE) missingEnv.push('EPIC_PROD_PRIVATE_KEY_FILE');
  if (!TOKEN_URL) missingEnv.push('EPIC_PROD_TOKEN_URL');
  if (!FHIR_BASE) missingEnv.push('EPIC_PROD_FHIR_BASE');
  if (missingEnv.length) {
    fail(`Missing required environment variables: ${missingEnv.join(', ')}`);
    console.log('\n\nSee the header of this script for configuration details.\n');
    process.exit(2);
  }

  // 1. Token exchange
  section('1 · Token Exchange (SMART Backend Services)');
  let client;
  let tok;
  try {
    client = createEpicClientFromKeyFile({
      clientId: CLIENT_ID,
      privateKeyFile: KEY_FILE,
      tokenUrl: TOKEN_URL,
      fhirBase: FHIR_BASE,
      kid: KID,
    });
    tok = await client.getAccessToken();
    tick(`Access token obtained (expires in ~${Math.round((tok.expiresAt - Date.now()) / 1000)}s)`);
    evidenceStatus.tokenExchange = 'OK';
  } catch (err) {
    // Network error detail stays on stdout only — never in the evidence file.
    fail(`Token exchange FAILED: ${err.message}`);
    evidenceStatus.tokenExchange = 'FAILED';
    writeEvidence(1);
    process.exit(1);
  }

  // 2. Scope check
  section('2 · Scope Check');
  const grantedScopes = (tok.scope || '').split(/\s+/).filter(Boolean);
  const requested = DEFAULT_SCOPES.split(' ');
  const missing = requested.filter((s) => !grantedScopes.includes(s));
  info(`Granted: ${grantedScopes.length} scope(s); requested: ${requested.length}`);
  if (missing.length === 0) {
    tick('All requested scopes granted');
    evidenceStatus.scopes = 'OK';
  } else {
    fail(`${missing.length} scope(s) NOT granted: ${missing.join(', ')}`);
    evidenceStatus.scopes = 'MISSING';
  }

  // 3. FHIR metadata
  section('3 · FHIR Server Metadata');
  try {
    const meta = await client.fhirGet('metadata');
    // Print network fields to stdout; do not persist them.
    tick(`FHIR version: ${meta.fhirVersion}`);
    tick(`Software: ${meta.software?.name || 'unknown'} ${meta.software?.version || ''}`);
    evidenceStatus.metadata = 'OK';
  } catch (err) {
    fail(`Metadata fetch failed: ${err.message}`);
    evidenceStatus.metadata = 'FAILED';
  }

  // 4. Optional patient pull (counts only — printed, not persisted)
  if (TEST_PATIENT) {
    section('4 · Patient Bundle Fetch (counts only)');
    try {
      const bundle = await client.fetchPatientBundle(TEST_PATIENT);
      tick('Patient resource fetched (id supplied via env; details not persisted)');
      info(`Observations: ${bundle.observations.length}`);
      info(`Conditions: ${bundle.conditions.length}`);
      info(`MedicationRequests: ${bundle.medicationRequests.length}`);
      info(`AllergyIntolerances: ${bundle.allergies.length}`);
      evidenceStatus.patientPull = 'OK';
    } catch (err) {
      fail(`Patient bundle fetch FAILED: ${err.message}`);
      evidenceStatus.patientPull = 'FAILED';
      writeEvidence(1);
      process.exit(1);
    }
  } else {
    section('4 · Patient Bundle Fetch');
    info('Skipped (EPIC_PROD_TEST_PATIENT not set — connectivity verified without touching PHI)');
    evidenceStatus.patientPull = 'SKIPPED';
  }

  section('Summary');
  tick('Production verification complete');
  writeEvidence(0);
  console.log('\n');
}

run().catch((err) => {
  console.error('\nFatal:', err.message);
  writeEvidence(1);
  process.exit(1);
});
