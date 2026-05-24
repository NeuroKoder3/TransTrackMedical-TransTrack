/**
 * Epic sandbox diagnostic script.
 * Checks: token auth, granted scopes, and a live patient bundle fetch.
 * Usage: node scripts/epic-sandbox-check.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { createEpicClientFromKeyFile, DEFAULT_SCOPES } = require('../server/src/integrations/epic/client.js');

const CLIENT_ID    = 'a8634931-c997-4516-90cd-21ec3a27813e';
const KEY_FILE     = path.join(__dirname, '..', 'epic-keys', 'transtrack-epic-private.pem');
const TEST_PATIENT = 'erXuFYUfucBZaryVksYEcMg3'; // Epic sandbox: Camila Maria Lopez

const REQUESTED_SCOPES = DEFAULT_SCOPES.split(' ');

function tick(label) { process.stdout.write(`\n  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label) { process.stdout.write(`\n  \x1b[31m✗\x1b[0m ${label}`); }
function info(label) { process.stdout.write(`\n  \x1b[36m·\x1b[0m ${label}`); }
function section(title) { console.log(`\n\x1b[1m\x1b[34m── ${title} ──\x1b[0m`); }

async function run() {
  console.log('\n\x1b[1mTransTrack × Epic Sandbox Diagnostic\x1b[0m');
  console.log(`  Client ID : ${CLIENT_ID}`);
  console.log(`  Key file  : ${KEY_FILE}`);

  // ── 1. TOKEN EXCHANGE ──────────────────────────────────────────────────────
  section('1 · Token Exchange (SMART Backend Services)');
  let client;
  let tok;
  try {
    client = createEpicClientFromKeyFile({
      clientId: CLIENT_ID,
      privateKeyFile: KEY_FILE,
    });
    tok = await client.getAccessToken();
    tick(`Access token obtained  (expires in ~${Math.round((tok.expiresAt - Date.now()) / 1000)}s)`);
    tick(`Token type: ${tok.tokenType}`);
  } catch (err) {
    fail(`Token exchange FAILED: ${err.message}`);
    process.exit(1);
  }

  // ── 2. SCOPE CHECK ─────────────────────────────────────────────────────────
  section('2 · Scope Check');
  const grantedScopes = (tok.scope || '').split(/\s+/).filter(Boolean);
  info(`Scopes granted by Epic (${grantedScopes.length}):`);
  for (const s of grantedScopes) {
    process.stdout.write(`\n      \x1b[32m${s}\x1b[0m`);
  }

  console.log('\n');
  info(`Scopes requested by TransTrack code (${REQUESTED_SCOPES.length}):`);
  const missing = [];
  for (const s of REQUESTED_SCOPES) {
    if (grantedScopes.includes(s)) {
      process.stdout.write(`\n      \x1b[32m✓ ${s}\x1b[0m`);
    } else {
      process.stdout.write(`\n      \x1b[31m✗ ${s}  ← NOT GRANTED\x1b[0m`);
      missing.push(s);
    }
  }
  console.log('\n');
  if (missing.length === 0) {
    tick('All requested scopes are granted');
  } else {
    fail(`${missing.length} requested scope(s) NOT granted — these resources will fail at import`);
  }

  // ── 3. FHIR METADATA ───────────────────────────────────────────────────────
  section('3 · FHIR Server Metadata');
  try {
    const meta = await client.fhirGet('metadata');
    tick(`FHIR version : ${meta.fhirVersion}`);
    tick(`Software     : ${meta.software?.name || 'unknown'} ${meta.software?.version || ''}`);
    const supportedResources = (meta.rest?.[0]?.resource || []).map(r => r.type);
    tick(`Resources supported: ${supportedResources.length}`);
    const ourResources = ['Patient','Observation','Condition','MedicationRequest','AllergyIntolerance'];
    for (const r of ourResources) {
      if (supportedResources.includes(r)) {
        process.stdout.write(`\n      \x1b[32m✓ ${r}\x1b[0m`);
      } else {
        process.stdout.write(`\n      \x1b[31m✗ ${r}  ← not in CapabilityStatement\x1b[0m`);
      }
    }
    console.log('');
  } catch (err) {
    fail(`Metadata fetch failed: ${err.message}`);
  }

  // ── 4. LIVE PATIENT BUNDLE FETCH ───────────────────────────────────────────
  section(`4 · Patient Bundle Fetch  (Camila Lopez · ${TEST_PATIENT})`);
  let bundle;
  try {
    bundle = await client.fetchPatientBundle(TEST_PATIENT);
    tick(`Patient      : ${bundle.patient?.name?.[0]?.given?.join(' ')} ${bundle.patient?.name?.[0]?.family}`);
    tick(`DOB          : ${bundle.patient?.birthDate}`);
    tick(`Gender       : ${bundle.patient?.gender}`);
    tick(`MRN          : ${bundle.patient?.identifier?.find(i => i.type?.coding?.[0]?.code === 'MR')?.value || bundle.patient?.identifier?.[0]?.value || 'none'}`);
    console.log('');
    info(`Observations (labs)        : ${bundle.observations.length}`);
    info(`Conditions (problem list)  : ${bundle.conditions.length}`);
    info(`Medication requests        : ${bundle.medicationRequests.length}`);
    info(`Allergy intolerances       : ${bundle.allergies.length}`);
    info(`Scope granted              : ${bundle.scopeGranted}`);
  } catch (err) {
    fail(`Patient bundle fetch FAILED: ${err.message}`);
    process.exit(1);
  }

  // ── 5. NATIVE TABLE PREVIEW ────────────────────────────────────────────────
  section('5 · Native Table Materialisation Preview (dry run — no DB)');

  // Observations → lab_results
  console.log('\n  \x1b[1mObservations → lab_results\x1b[0m');
  let labCount = 0;
  for (const obs of bundle.observations.slice(0, 5)) {
    const coding = obs.code?.coding?.[0];
    const value = obs.valueQuantity
      ? `${obs.valueQuantity.value} ${obs.valueQuantity.unit || ''}`.trim()
      : obs.valueString ?? obs.valueCodeableConcept?.text ?? null;
    if (coding && value != null) {
      info(`${coding.display || coding.code}  →  ${value}  (${obs.effectiveDateTime?.substring(0,10) || '?'})`);
      labCount++;
    }
  }
  if (bundle.observations.length > 5) info(`… and ${bundle.observations.length - 5} more`);

  // Conditions → patient_conditions
  console.log('\n  \x1b[1mConditions → patient_conditions\x1b[0m');
  for (const c of bundle.conditions.slice(0, 5)) {
    const display = c.code?.coding?.[0]?.display || c.code?.text || 'unknown';
    const status  = c.clinicalStatus?.coding?.[0]?.code || '?';
    info(`${display}  [${status}]`);
  }
  if (bundle.conditions.length > 5) info(`… and ${bundle.conditions.length - 5} more`);

  // MedicationRequests → patient_medications
  console.log('\n  \x1b[1mMedicationRequests → patient_medications\x1b[0m');
  for (const m of bundle.medicationRequests.slice(0, 5)) {
    const name   = m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || 'unknown';
    const status = m.status || '?';
    info(`${name}  [${status}]`);
  }
  if (bundle.medicationRequests.length > 5) info(`… and ${bundle.medicationRequests.length - 5} more`);

  // Allergies → patient_allergies
  console.log('\n  \x1b[1mAllergyIntolerances → patient_allergies\x1b[0m');
  for (const a of bundle.allergies.slice(0, 5)) {
    const display     = a.code?.coding?.[0]?.display || a.code?.text || 'unknown';
    const criticality = a.criticality || '?';
    info(`${display}  [criticality: ${criticality}]`);
  }
  if (bundle.allergies.length > 5) info(`… and ${bundle.allergies.length - 5} more`);

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  section('Summary');
  tick('Token exchange             OK');
  missing.length === 0 ? tick('All scopes granted         OK') : fail(`Scopes missing: ${missing.join(', ')}`);
  tick(`Patient fetch              OK  (${bundle.observations.length} obs, ${bundle.conditions.length} cond, ${bundle.medicationRequests.length} meds, ${bundle.allergies.length} allergies)`);
  tick('Native table mapping       Ready (run importPatientFromEpic to write to DB)');
  console.log('\n');
}

run().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
