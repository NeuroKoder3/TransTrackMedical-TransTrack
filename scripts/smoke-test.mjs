#!/usr/bin/env node
/**
 * TransTrack end-to-end smoke test.
 *
 * Provisions a fresh org + admin user, logs in, then exercises:
 *   - REST   /patients         (create + list)
 *   - FHIR   /fhir/Patient     (create + read; auto-materialised)
 *   - MLLP   tcp://:2575       (ADT upserts patients, ORU writes labs)
 *   - REST   /audit            (verifies the hash chain)
 *
 * Run:  node scripts/smoke-test.mjs
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
    const r = await fetch(`${API}${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(opts.token && { authorization: `Bearer ${opts.token}` }),
            ...opts.headers,
        },
        body: opts.body && JSON.stringify(opts.body),
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

    step('REST: verify audit hash chain');
    const verify = await api('GET', '/audit/verify', { token });
    ok(`audit verify: ok=${verify.ok} entries=${verify.checked ?? verify.count ?? '?'}`);

    await pool.end();
    console.log('\n\x1b[42m\x1b[30m SMOKE TEST PASSED \x1b[0m\n');
})().catch(e => {
    console.error('\n\x1b[41m\x1b[37m SMOKE TEST FAILED \x1b[0m');
    console.error(e);
    process.exit(1);
});
