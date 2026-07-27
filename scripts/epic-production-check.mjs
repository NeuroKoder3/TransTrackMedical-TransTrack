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
 * resource COUNTS only — no names, DOBs, MRNs, or values are written to disk.
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

const evidence = [];
function record(line) { evidence.push(line); }

function redactHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid URL)';
  }
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

  record(`TransTrack Epic production verification`);
  record(`Run at (UTC): ${new Date().toISOString()}`);
  record(`Endpoint host: ${redactHost(FHIR_BASE)}`);
  record(`Client ID: ${CLIENT_ID.slice(0, 8)}… (truncated)`);
  record('');

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
    record('Token exchange: OK');
  } catch (err) {
    fail(`Token exchange FAILED: ${err.message}`);
    record(`Token exchange: FAILED — ${err.message}`);
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
    record(`Scopes: all ${requested.length} requested scopes granted`);
  } else {
    fail(`${missing.length} scope(s) NOT granted: ${missing.join(', ')}`);
    record(`Scopes: MISSING — ${missing.join(', ')}`);
  }

  // 3. FHIR metadata
  section('3 · FHIR Server Metadata');
  try {
    const meta = await client.fhirGet('metadata');
    tick(`FHIR version: ${meta.fhirVersion}`);
    tick(`Software: ${meta.software?.name || 'unknown'} ${meta.software?.version || ''}`);
    record(`Metadata: OK — FHIR ${meta.fhirVersion}, ${meta.software?.name || 'unknown'} ${meta.software?.version || ''}`);
  } catch (err) {
    fail(`Metadata fetch failed: ${err.message}`);
    record(`Metadata: FAILED — ${err.message}`);
  }

  // 4. Optional patient pull (counts only — no PHI persisted)
  if (TEST_PATIENT) {
    section('4 · Patient Bundle Fetch (counts only)');
    try {
      const bundle = await client.fetchPatientBundle(TEST_PATIENT);
      tick(`Patient resource fetched (id supplied via env; details not persisted)`);
      info(`Observations: ${bundle.observations.length}`);
      info(`Conditions: ${bundle.conditions.length}`);
      info(`MedicationRequests: ${bundle.medicationRequests.length}`);
      info(`AllergyIntolerances: ${bundle.allergies.length}`);
      record(
        `Patient pull: OK — obs=${bundle.observations.length} cond=${bundle.conditions.length} ` +
        `meds=${bundle.medicationRequests.length} allergies=${bundle.allergies.length}`
      );
    } catch (err) {
      fail(`Patient bundle fetch FAILED: ${err.message}`);
      record(`Patient pull: FAILED — ${err.message}`);
      writeEvidence(1);
      process.exit(1);
    }
  } else {
    section('4 · Patient Bundle Fetch');
    info('Skipped (EPIC_PROD_TEST_PATIENT not set — connectivity verified without touching PHI)');
    record('Patient pull: skipped (no test patient configured)');
  }

  section('Summary');
  tick('Production verification complete');
  writeEvidence(0);
  console.log('\n');
}

function writeEvidence(exitCode) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const dir = path.join(__dirname, '..', 'demo-evidence');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `epic-production-${stamp}.txt`);
  record('');
  record(`Exit code: ${exitCode}`);
  fs.writeFileSync(file, evidence.join('\n') + '\n', 'utf8');
  console.log(`\n\n  Evidence written to ${file}`);
}

run().catch((err) => {
  console.error('\nFatal:', err.message);
  record(`Fatal: ${err.message}`);
  writeEvidence(1);
  process.exit(1);
});
