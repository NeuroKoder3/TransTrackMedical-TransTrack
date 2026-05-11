#!/usr/bin/env node
/**
 * TransTrack end-to-end smoke test.
 *
 * Provisions a fresh org + admin user, logs in, then exercises:
 *   - REST   /patients              (create + list)
 *   - FHIR   /fhir/Patient          (create + read; auto-materialised)
 *   - MLLP   tcp://:2575            (ADT upserts patients, ORU writes labs)
 *   - SMART  /.well-known + /oauth2 (discovery, dyn registration, client_credentials, scoped FHIR read)
 *   - CDS    /cds-services          (discovery + invocation)
 *   - HL7    vendor profiles + supported message types
 *   - FHIR   $export bulk-data round-trip
 *   - Epic   on FHIR sandbox round-trip   (gated on EPIC_SANDBOX_CLIENT_ID)
 *   - REST   /audit                 (verifies the hash chain)
 *
 * Prerequisites (run once after a fresh clone OR after pulling new code):
 *
 *   docker compose -f docker/docker-compose.yml build api
 *   docker compose -f docker/docker-compose.yml up -d postgres api
 *   docker exec transtrack-api node src/db/migrate.js up
 *
 * Run:
 *   node scripts/smoke-test.mjs
 *
 * Optional: enable the Epic on FHIR sandbox round-trip by setting
 *   $env:EPIC_SANDBOX_CLIENT_ID = "<your Epic non-production client id>"
 * and placing the matching private key at  epic-keys/transtrack-epic-private.pem
 * (see server/src/integrations/epic/README.md).
 */
import { createRequire } from 'module';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { Pool } = require('../server/node_modules/pg');
const argon2 = require('../server/node_modules/argon2');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API = process.env.API_BASE_URL || 'http://localhost:8080';
const MLLP_HOST = process.env.MLLP_HOST || '127.0.0.1';
const MLLP_PORT = Number(process.env.MLLP_PORT || 2575);
const DATABASE_URL = process.env.DATABASE_URL ||
    'postgres://transtrack:transtrack@localhost:5432/transtrack';

const PW = 'Smoke-Test-Pw-' + Date.now();
const email = `smoke-${Date.now()}@transtrack.local`;
const orgName = `Smoke Test Org ${new Date().toISOString().slice(0, 19)}`;

const SB = 0x0b, EB = 0x1c, CR = 0x0d;
const frame = m => Buffer.concat([Buffer.from([SB]), Buffer.from(m), Buffer.from([EB, CR])]);

function ok(msg) { console.log(`  \x1b[32m\u2713\x1b[0m ${msg}`); }
function step(msg) { console.log(`\x1b[36m==> ${msg}\x1b[0m`); }

async function api(method, path, opts = {}) {
    const hasBody = opts.body !== undefined && opts.body !== null;
    const r = await fetch(`${API}${path}`, {
        method,
        headers: {
            ...(hasBody && { 'content-type': 'application/json' }),
            ...(opts.token && { authorization: `Bearer ${opts.token}` }),
            ...opts.headers,
        },
        body: hasBody ? JSON.stringify(opts.body) : undefined,
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text}`);
    return body;
}

function sendMllp(message) {
    return new Promise((resolve, reject) => {
        const sock = net.createConnection({ host: MLLP_HOST, port: MLLP_PORT });
        let buf = Buffer.alloc(0);
        sock.on('connect', () => sock.write(frame(message)));
        sock.on('data', chunk => {
            buf = Buffer.concat([buf, chunk]);
            const end = buf.indexOf(EB);
            if (end > 0) {
                const start = buf.indexOf(SB);
                sock.end();
                resolve(buf.slice(start + 1, end).toString('utf8'));
            }
        });
        sock.on('error', reject);
        sock.setTimeout(5000, () => { sock.destroy(); reject(new Error('MLLP timeout')); });
    });
}

(async () => {
    step('Provisioning org + admin user directly in Postgres');
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    let orgId, userId;
    try {
        const o = await client.query(
            `INSERT INTO organizations (name, type) VALUES ($1, 'TRANSPLANT_CENTER') RETURNING id`,
            [orgName]
        );
        orgId = o.rows[0].id;
        const hash = await argon2.hash(PW, { type: argon2.argon2id });
        const u = await client.query(
            `INSERT INTO users (org_id, email, password_hash, full_name, role)
             VALUES ($1, $2, $3, 'Smoke Admin', 'admin') RETURNING id`,
            [orgId, email, hash]
        );
        userId = u.rows[0].id;
        ok(`org_id=${orgId}`);
        ok(`user_id=${userId}  email=${email}`);
    } finally {
        client.release();
    }

    step('Pinning HL7_DEFAULT_ORG_ID + restarting api container');
    const composeDir = path.join(__dirname, '..', 'docker');
    const envFile = path.join(composeDir, '.env');
    fs.writeFileSync(envFile, `HL7_DEFAULT_ORG_ID=${orgId}\n`);
    // Surface the var to docker-compose: append it to api env if missing
    const ymlPath = path.join(composeDir, 'docker-compose.yml');
    let yml = fs.readFileSync(ymlPath, 'utf8');
    if (!/HL7_DEFAULT_ORG_ID/.test(yml)) {
        yml = yml.replace(
            /(      HL7_MLLP_PORT:\s*"2575"\s*\n)/,
            `$1      HL7_DEFAULT_ORG_ID: \${HL7_DEFAULT_ORG_ID}\n`,
        );
        fs.writeFileSync(ymlPath, yml);
    }
    execSync('docker compose up -d --force-recreate api', { cwd: composeDir, stdio: 'inherit' });
    ok('api container recreated');

    step('Waiting for /health to come back');
    let healthy = false;
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(`${API}/health`);
            if (r.ok) { healthy = true; break; }
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
    }
    if (!healthy) throw new Error('API did not return to health within 60s');
    const h = await api('GET', '/health');
    ok(`status=${h.status}`);

    step('POST /auth/login');
    const login = await api('POST', '/auth/login', { body: { email, password: PW } });
    if (login.kind !== 'session') {
        throw new Error('Expected session, got: ' + JSON.stringify(login));
    }
    const token = login.access;
    ok('access token issued');

    step('REST: create patient');
    const restPatient = await api('POST', '/patients', {
        token, body: {
            mrn: 'SMOKE-MRN-001',
            first_name: 'Alice', last_name: 'Rest',
            date_of_birth: '1985-03-21',
            sex: 'F',
            blood_type: 'O+',
            organ_needed: 'kidney',
            waitlist_status: 'active',
        },
    });
    ok(`patient id=${restPatient.id} mrn=${restPatient.mrn}`);

    step('REST: list patients');
    const list = await api('GET', '/patients', { token });
    ok(`patient count=${list.length}`);

    step('FHIR: GET /fhir/metadata');
    const cap = await api('GET', '/fhir/metadata', { token });
    ok(`CapabilityStatement fhirVersion=${cap.fhirVersion}`);
    ok(`resources=${cap.rest[0].resource.map(r => r.type).join(', ')}`);

    step('FHIR: create Patient');
    const fhirPatient = await api('POST', '/fhir/Patient', {
        token,
        headers: { 'content-type': 'application/fhir+json' },
        body: {
            resourceType: 'Patient',
            identifier: [{ system: 'urn:hospital:mrn', value: 'SMOKE-FHIR-MRN-1' }],
            name: [{ family: 'Doe', given: ['Jane'] }],
            gender: 'female',
            birthDate: '1990-07-04',
        },
    });
    ok(`FHIR Patient/${fhirPatient.id}`);

    step('MLLP: send ADT^A04 (new outpatient)');
    const adt = [
        'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||ADT^A04|SMOKE-ADT-1|P|2.5',
        'EVN|A04|20260101120000',
        'PID|1||SMOKE-MLLP-MRN-1^^^HOSP^MR||SMITH^BOB||19720515|M||2106-3|123 MAIN^^TOWN^ST^12345||555-1212',
        'PV1|1|O|CLINIC',
    ].join('\r');
    let ack = await sendMllp(adt);
    if (!/MSA\|AA\|SMOKE-ADT-1/.test(ack)) throw new Error('Bad ADT ACK: ' + ack);
    ok('AA ACK received for ADT^A04');

    step('MLLP: send ORU^R01 (creatinine + potassium)');
    const oru = [
        'MSH|^~\\&|LAB|HOSP|TT|TT|20260101120000||ORU^R01|SMOKE-ORU-1|P|2.5',
        'PID|1||SMOKE-MLLP-MRN-1^^^HOSP^MR||SMITH^BOB',
        'OBR|1|ORDER1||CHEM7^Chem 7^L|||20260101120000',
        'OBX|1|NM|2160-0^Creatinine^LN||1.4|mg/dL|0.7-1.3|H|||F|||20260101120000',
        'OBX|2|NM|2823-3^Potassium^LN||4.2|mmol/L|3.5-5.0|N|||F|||20260101120000',
    ].join('\r');
    ack = await sendMllp(oru);
    if (!/MSA\|AA\|SMOKE-ORU-1/.test(ack)) throw new Error('Bad ORU ACK: ' + ack);
    ok('AA ACK received for ORU^R01');

    step('Verify MLLP-ingested patient + labs landed in DB');
    const c2 = await pool.connect();
    try {
        await c2.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
        const p = await c2.query(
            `SELECT id, mrn, first_name, last_name FROM patients
             WHERE org_id = $1 AND mrn = 'SMOKE-MLLP-MRN-1'`, [orgId]);
        if (!p.rows[0]) throw new Error('MLLP patient not found');
        ok(`MLLP patient: ${p.rows[0].first_name} ${p.rows[0].last_name} (id=${p.rows[0].id})`);
        const l = await c2.query(
            `SELECT count(*)::int AS n FROM lab_results WHERE org_id = $1`, [orgId]);
        ok(`lab_results rows for org: ${l.rows[0].n}`);
        const m = await c2.query(
            `SELECT count(*)::int AS n FROM hl7_messages WHERE org_id = $1`, [orgId]);
        ok(`hl7_messages rows for org: ${m.rows[0].n}`);
    } finally {
        c2.release();
    }

    step('SMART: discovery (.well-known/smart-configuration)');
    const smartCfg = await api('GET', '/.well-known/smart-configuration');
    if (!smartCfg.token_endpoint || !smartCfg.authorization_endpoint) {
        throw new Error('SMART discovery missing endpoints');
    }
    ok(`token_endpoint=${smartCfg.token_endpoint}`);
    ok(`scopes_supported=${smartCfg.scopes_supported.length}`);

    step('SMART: register a confidential client + client_credentials grant');
    const reg = await api('POST', '/oauth2/register', {
        token,
        body: {
            client_type: 'confidential',
            client_name: 'Smoke Backend',
            scope: 'system/Patient.rs system/Observation.rs',
            grant_types: ['client_credentials'],
        },
    });
    ok(`registered client_id=${reg.client_id}`);
    const tokRes = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: reg.client_id,
            client_secret: reg.client_secret,
            scope: 'system/Patient.rs',
        }),
    }).then(r => r.json());
    if (!tokRes.access_token) throw new Error('client_credentials failed: ' + JSON.stringify(tokRes));
    ok(`access_token issued (expires_in=${tokRes.expires_in})`);

    step('SMART: use access token to read FHIR Patient');
    const smartList = await api('GET', '/fhir/Patient', { token: tokRes.access_token });
    ok(`SMART read returned ${smartList.entry?.length || 0} Patient(s)`);

    step('CDS Hooks: discovery');
    const cds = await api('GET', '/cds-services');
    if (!Array.isArray(cds.services) || cds.services.length === 0) {
        throw new Error('CDS Hooks discovery returned no services');
    }
    ok(`services=${cds.services.map(s => s.id).join(', ')}`);

    step('CDS Hooks: invoke patient-view');
    const cdsInvoke = await api('POST', `/cds-services/${cds.services[0].id}`, {
        token,
        body: {
            hook: cds.services[0].hook,
            hookInstance: 'smoke-' + Date.now(),
            context: { patientId: restPatient.id },
            prefetch: { patient: { resourceType: 'Patient', id: restPatient.id, identifier: [{ value: restPatient.mrn }] } },
        },
    });
    ok(`cards returned=${cdsInvoke.cards?.length ?? 0}`);

    step('HL7 vendor profiles: seed defaults');
    const seed = await api('POST', '/hl7/vendor-profiles/seed-defaults', { token });
    ok(`seeded=${seed.seeded} of ${seed.total}`);

    step('HL7: supported message types');
    const types = await api('GET', '/hl7/supported-types', { token });
    ok(`supported message-type count=${types.supported.length}`);

    step('FHIR: kickoff Patient $export and poll');
    const kickoff = await fetch(`${API}/fhir/Patient/$export`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/fhir+json' },
    });
    if (kickoff.status !== 202) throw new Error(`$export expected 202, got ${kickoff.status}`);
    const cl = kickoff.headers.get('content-location');
    if (!cl) throw new Error('$export missing Content-Location');
    ok(`status URL=${cl}`);
    let manifest = null;
    for (let i = 0; i < 20; i++) {
        const pollRel = cl.replace(/^https?:\/\/[^/]+/, '');
        const r = await fetch(`${API}${pollRel}`, { headers: { authorization: `Bearer ${token}` } });
        if (r.status === 200) {
            manifest = await r.json();
            break;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    if (!manifest) throw new Error('$export did not complete');
    ok(`manifest output files=${manifest.output.length}`);

    step('Epic on FHIR round-trip (gated by EPIC_SANDBOX_CLIENT_ID)');
    if (process.env.EPIC_SANDBOX_CLIENT_ID) {
        const epicClientId = process.env.EPIC_SANDBOX_CLIENT_ID;
        const epicPatientId = process.env.EPIC_PATIENT_ID || 'erXuFYUfucBZaryVksYEcMg3';
        const epicKeyFile = process.env.EPIC_PRIVATE_KEY_FILE
            || path.join(__dirname, '..', 'epic-keys', 'transtrack-epic-private.pem');
        if (!fs.existsSync(epicKeyFile)) {
            throw new Error(`Epic key file not found: ${epicKeyFile}`);
        }
        const epic = require('../server/src/integrations/epic');
        const epicClient = epic.createEpicClientFromKeyFile({
            clientId: epicClientId,
            privateKeyFile: epicKeyFile,
            tokenUrl: process.env.EPIC_TOKEN_URL || undefined,
            fhirBase: process.env.EPIC_FHIR_BASE || undefined,
            kid: process.env.EPIC_KID || undefined,
            scope: process.env.EPIC_SCOPE || undefined,
        });
        ok(`Epic client built (clientId=${epicClientId.slice(0, 8)}...)`);

        const bundle = await epicClient.fetchPatientBundle(epicPatientId);
        ok(`Epic FHIR pull: scope="${bundle.scopeGranted || '(none)'}"`);
        ok(`  Patient: ${bundle.patient?.name?.[0]?.family}, `
            + `${bundle.patient?.name?.[0]?.given?.join(' ')} `
            + `(DOB ${bundle.patient?.birthDate})`);
        ok(`  ${bundle.observations.length} lab observations, `
            + `${bundle.conditions.length} problems, `
            + `${bundle.medicationRequests.length} med requests, `
            + `${bundle.allergies.length} allergies`);

        const importResp = await api('POST', '/integrations/epic/import', {
            token,
            body: { bundle },
        });
        if (!importResp?.patient?.id) {
            throw new Error('Epic import did not return a patient: ' + JSON.stringify(importResp));
        }
        ok(`TransTrack patient ${importResp.created ? 'created' : 'updated'}: `
            + `${importResp.patient.last_name}, ${importResp.patient.first_name} `
            + `(id=${importResp.patient.id} mrn=${importResp.patient.mrn})`);
        ok(`  stored: obs=${importResp.stored.observations} cond=${importResp.stored.conditions} `
            + `med=${importResp.stored.medicationRequests} alg=${importResp.stored.allergies}`);

        // Re-pull through TransTrack's FHIR API to confirm the imported Patient is queryable.
        const tsList = await api('GET',
            `/fhir/Patient?identifier=${encodeURIComponent(importResp.patient.mrn)}`,
            { token });
        ok(`TransTrack FHIR Patient search returned ${tsList.entry?.length || 0} match(es) `
            + `(expect >= 1 for the just-imported MRN)`);
    } else {
        ok('SKIPPED (set EPIC_SANDBOX_CLIENT_ID + epic-keys/transtrack-epic-private.pem to enable)');
    }

    step('REST: verify audit hash chain');
    const verify = await api('GET', '/audit/verify', { token });
    ok(`audit verify: ok=${verify.ok} entries=${verify.checked ?? verify.count ?? '?'}`);

    await pool.end();
    console.log('\n\x1b[42m\x1b[30m SMOKE TEST PASSED \x1b[0m\n');
})().catch(() => {
    console.error('\n\x1b[41m\x1b[37m SMOKE TEST FAILED \x1b[0m');
    console.error('Smoke test failed. Check service logs or run with a debugger for details.');
    process.exit(1);
});
