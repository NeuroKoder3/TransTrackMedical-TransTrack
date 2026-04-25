/**
 * FHIR R4 integration test. Boots the API in-memory and exercises
 * CapabilityStatement, Patient create/read/search, and Observation create
 * (which materialises into the native lab_results table).
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { build } = require('../../src/index');
const { withTransaction, query } = require('../../src/db/pool');
const password = require('../../src/auth/password');

let app, orgId, access;
const PW = 'fhir-pw-AAAAAAAAAAAAAA';
const email = `fhir-${Date.now()}@itest.local`;

beforeAll(async () => {
  process.env.MFA_REQUIRED_FOR_ROLES = '';
  process.env.FHIR_REQUIRE_AUTH = 'true';
  const built = await build();
  app = built.app;
  await withTransaction({}, async (client) => {
    const o = await client.query(`INSERT INTO organizations (name) VALUES ('FHIR Test') RETURNING id`);
    orgId = o.rows[0].id;
    const hash = await password.hash(PW);
    await client.query(
      `INSERT INTO users (org_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'FHIR Admin', 'admin')`,
      [orgId, email, hash]
    );
  });
  const login = await app.inject({ method: 'POST', url: '/auth/login',
    payload: { email, password: PW } });
  const body = JSON.parse(login.payload);
  if (body.kind !== 'session') throw new Error('expected session, got ' + body.kind);
  access = body.access;
});

afterAll(async () => {
  if (orgId) await query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  await app.close();
});

const auth = () => ({ authorization: `Bearer ${access}` });

describe('FHIR R4', () => {
  it('GET /fhir/metadata returns a CapabilityStatement', async () => {
    const r = await app.inject({ method: 'GET', url: '/fhir/metadata', headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.payload);
    expect(body.resourceType).toBe('CapabilityStatement');
    expect(body.fhirVersion).toBe('4.0.1');
    const types = body.rest[0].resource.map(r => r.type);
    expect(types).toContain('Patient');
    expect(types).toContain('Observation');
  });

  it('creates a Patient and reads it back', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/fhir/Patient',
      headers: { ...auth(), 'content-type': 'application/fhir+json' },
      payload: JSON.stringify({
        resourceType: 'Patient',
        identifier: [{ system: 'urn:hospital:mrn', value: 'FHIR-MRN-1' }],
        name: [{ family: 'Doe', given: ['Jane'] }],
        gender: 'female',
        birthDate: '1985-04-12',
      }),
    });
    expect(create.statusCode).toBe(201);
    const created = JSON.parse(create.payload);
    expect(created.id).toBeTruthy();
    const read = await app.inject({
      method: 'GET',
      url: `/fhir/Patient/${created.id}`,
      headers: auth(),
    });
    expect(read.statusCode).toBe(200);
    const got = JSON.parse(read.payload);
    expect(got.name[0].family).toBe('Doe');
    // Materialised into native patients table
    const pat = await query(
      `SELECT * FROM patients WHERE org_id = $1 AND mrn = $2`,
      [orgId, 'FHIR-MRN-1']
    );
    expect(pat.rows.length).toBe(1);
  });

  it('creates an Observation and persists to lab_results', async () => {
    const obs = {
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }] },
      subject: { reference: 'Patient/' }, // filled below
      effectiveDateTime: '2026-01-02T10:15:00Z',
      valueQuantity: { value: 1.2, unit: 'mg/dL' },
    };
    const findPatient = await query(
      `SELECT id FROM fhir_resources WHERE org_id = $1 AND resource_type = 'Patient' LIMIT 1`,
      [orgId]
    );
    obs.subject.reference = `Patient/${findPatient.rows[0].id}`;
    const r = await app.inject({
      method: 'POST',
      url: '/fhir/Observation',
      headers: { ...auth(), 'content-type': 'application/fhir+json' },
      payload: JSON.stringify(obs),
    });
    expect(r.statusCode).toBe(201);
    const labs = await query(
      `SELECT * FROM lab_results WHERE org_id = $1 AND test_code = '2160-0'`,
      [orgId]
    );
    expect(labs.rows.length).toBeGreaterThan(0);
  });
});
