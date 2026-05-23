import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { generateKeyPairSync, createPublicKey, createVerify } from 'node:crypto';

const require = createRequire(import.meta.url);
const epic = require('../../src/integrations/epic');
const importer = require('../../src/integrations/epic/importPatient.js');

let TEST_PRIVATE_PEM;
let TEST_PUBLIC_PEM;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  TEST_PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
  TEST_PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' });
});

function decodeJwt(token) {
  const [h, p, s] = token.split('.');
  const fromB64u = (x) =>
    Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return {
    header: JSON.parse(fromB64u(h).toString('utf8')),
    payload: JSON.parse(fromB64u(p).toString('utf8')),
    signature: fromB64u(s),
    signingInput: `${h}.${p}`,
  };
}

describe('Epic SMART Backend Services client', () => {
  it('signs an RS384 JWT assertion that verifies against the public key', () => {
    const tok = epic.buildAssertion({
      clientId: 'test-client-123',
      tokenUrl: 'https://example.com/token',
      privateKeyPem: TEST_PRIVATE_PEM,
      kid: 'unit-test-kid',
      ttlSeconds: 60,
    });
    const decoded = decodeJwt(tok);
    expect(decoded.header.alg).toBe('RS384');
    expect(decoded.header.typ).toBe('JWT');
    expect(decoded.header.kid).toBe('unit-test-kid');
    expect(decoded.payload.iss).toBe('test-client-123');
    expect(decoded.payload.sub).toBe('test-client-123');
    expect(decoded.payload.aud).toBe('https://example.com/token');
    expect(decoded.payload.exp - decoded.payload.iat).toBeLessThanOrEqual(60);
    expect(typeof decoded.payload.jti).toBe('string');

    const v = createVerify('RSA-SHA384');
    v.update(decoded.signingInput);
    v.end();
    const ok = v.verify(createPublicKey(TEST_PUBLIC_PEM), decoded.signature);
    expect(ok).toBe(true);
  });

  it('throws if clientId or privateKey is missing', () => {
    expect(() => epic.createEpicClient({ privateKeyPem: 'x' })).toThrow(/clientId/);
    expect(() => epic.createEpicClient({ clientId: 'x' })).toThrow(/privateKeyPem/);
  });

  it('caches access tokens between calls and only re-fetches near expiry', async () => {
    let tokenCalls = 0;
    const mockFetch = async (url, opts) => {
      if (url.endsWith('/token')) {
        tokenCalls += 1;
        const params = new URLSearchParams(opts.body.toString());
        expect(params.get('grant_type')).toBe('client_credentials');
        expect(params.get('client_assertion_type')).toBe(
          'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        );
        expect(params.get('client_assertion')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              access_token: 'opaque-test-' + tokenCalls,
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'system/Patient.read',
            }),
        };
      }
      throw new Error('unexpected url ' + url);
    };
    const client = epic.createEpicClient({
      clientId: 'unit-client',
      privateKeyPem: TEST_PRIVATE_PEM,
      tokenUrl: 'https://example.com/token',
      fhirBase: 'https://example.com/fhir',
      fetchImpl: mockFetch,
    });
    const a = await client.getAccessToken();
    const b = await client.getAccessToken();
    expect(a.accessToken).toBe(b.accessToken);
    expect(tokenCalls).toBe(1);
  });
});

describe('Epic FHIR client (FHIR fetch)', () => {
  it('attaches Bearer token to FHIR GETs and parses JSON', async () => {
    const calls = [];
    const mockFetch = async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith('/token')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              access_token: 'token-xyz',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'system/Patient.read',
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ resourceType: 'Patient', id: 'epic-pt-1' }),
      };
    };
    const client = epic.createEpicClient({
      clientId: 'c',
      privateKeyPem: TEST_PRIVATE_PEM,
      tokenUrl: 'https://example.com/token',
      fhirBase: 'https://example.com/fhir',
      fetchImpl: mockFetch,
    });
    const r = await client.fhirGet('Patient/epic-pt-1');
    expect(r.id).toBe('epic-pt-1');
    const fhirCall = calls[1];
    expect(fhirCall.url).toBe('https://example.com/fhir/Patient/epic-pt-1');
    expect(fhirCall.opts.headers.authorization).toBe('Bearer token-xyz');
    expect(fhirCall.opts.headers.accept).toBe('application/fhir+json');
  });

  it('throws on non-2xx FHIR responses', async () => {
    const mockFetch = async (url) => {
      if (url.endsWith('/token')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ access_token: 't', token_type: 'Bearer', expires_in: 3600 }),
        };
      }
      return { ok: false, status: 403, text: async () => 'forbidden' };
    };
    const client = epic.createEpicClient({
      clientId: 'c',
      privateKeyPem: TEST_PRIVATE_PEM,
      tokenUrl: 'https://example.com/token',
      fhirBase: 'https://example.com/fhir',
      fetchImpl: mockFetch,
    });
    await expect(client.fhirGet('Patient/x')).rejects.toThrow(/403/);
  });
});

// ---------------------------------------------------------------------------
// Clinical data materialisation
// ---------------------------------------------------------------------------

describe('Epic clinical data materialisation', () => {
  const importer = (() => {
    const req = createRequire(import.meta.url);
    return req('../../src/integrations/epic/importPatient.js');
  })();

  function makeMockClient(insertedRows = {}) {
    const queries = [];
    const client = {
      _queries: queries,
      query: async (sql, params) => {
        queries.push({ sql, params });
        // simulate fhir_resources Patient lookup returning nothing by default
        if (sql.includes('fhir_resources')) return { rows: [] };
        const table = sql.match(/INSERT INTO (\w+)/)?.[1];
        const defaultRow = insertedRows[table] || { id: 'generated-uuid', ...Object.fromEntries((params || []).map((v, i) => [`col${i}`, v])) };
        return { rows: [defaultRow] };
      },
    };
    return client;
  }

  const ctx = { orgId: 'org-1', userId: 'user-1' };
  const patientId = 'native-patient-uuid';

  it('persistObservations: stores to fhir_resources and creates lab_results for valued obs', async () => {
    const observations = [
      {
        resourceType: 'Observation',
        id: 'obs-1',
        status: 'final',
        code: { coding: [{ code: '2160-0', display: 'Creatinine [Mass/volume] in Serum or Plasma' }] },
        subject: { reference: 'Patient/epic-pt-1' },
        valueQuantity: { value: 1.2, unit: 'mg/dL' },
        effectiveDateTime: '2026-05-01T10:00:00Z',
        issued: '2026-05-01T12:00:00Z',
        referenceRange: [{ text: '0.7-1.3' }],
      },
      {
        resourceType: 'Observation',
        id: 'obs-2',
        status: 'final',
        code: { coding: [{ code: 'panel' }] },
        subject: { reference: 'Patient/epic-pt-1' },
        // No value — should store to FHIR but not create lab_result
      },
    ];
    const client = makeMockClient({ lab_results: { id: 'lr-1', test_code: '2160-0', source: 'FHIR_R4' } });
    const result = await importer.persistObservations(client, ctx, patientId, observations);
    expect(result.fhirStored).toBe(2);
    expect(result.nativeMaterialised).toBe(1);
    const labInserts = client._queries.filter(q => q.sql.includes('INSERT INTO lab_results'));
    expect(labInserts).toHaveLength(1);
    expect(labInserts[0].params).toContain('2160-0');
    expect(labInserts[0].params).toContain('FHIR_R4');
  });

  it('persistConditions: stores to fhir_resources and creates patient_conditions', async () => {
    const conditions = [
      {
        resourceType: 'Condition',
        id: 'cond-1',
        subject: { reference: 'Patient/epic-pt-1' },
        code: {
          coding: [{ code: 'N18.5', system: 'http://hl7.org/fhir/sid/icd-10-cm', display: 'Chronic kidney disease, stage 5' }],
        },
        clinicalStatus: { coding: [{ code: 'active' }] },
        verificationStatus: { coding: [{ code: 'confirmed' }] },
        category: [{ coding: [{ code: 'problem-list-item' }] }],
        onsetDateTime: '2022-03-15T00:00:00Z',
      },
    ];
    const client = makeMockClient({
      patient_conditions: { id: 'cond-uuid', code: 'N18.5', source: 'FHIR_R4' },
    });
    const result = await importer.persistConditions(client, ctx, patientId, conditions);
    expect(result.fhirStored).toBe(1);
    expect(result.nativeMaterialised).toBe(1);
    const condInserts = client._queries.filter(q => q.sql.includes('INSERT INTO patient_conditions'));
    expect(condInserts).toHaveLength(1);
    expect(condInserts[0].params).toContain('N18.5');
    expect(condInserts[0].params).toContain('active');
    expect(condInserts[0].params).toContain('FHIR_R4');
    expect(condInserts[0].params).toContain('2022-03-15');
  });

  it('persistMedicationRequests: stores to fhir_resources and creates patient_medications', async () => {
    const medicationRequests = [
      {
        resourceType: 'MedicationRequest',
        id: 'med-1',
        status: 'active',
        intent: 'order',
        subject: { reference: 'Patient/epic-pt-1' },
        medicationCodeableConcept: {
          coding: [{ code: '197361', system: 'http://www.nlm.nih.gov/research/umls/rxnorm', display: 'Tacrolimus 1 MG Oral Capsule' }],
        },
        authoredOn: '2026-04-01',
        requester: { display: 'Dr. Smith' },
        dosageInstruction: [{ text: '1 mg twice daily', route: { coding: [{ display: 'Oral' }] } }],
      },
    ];
    const client = makeMockClient({
      patient_medications: { id: 'med-uuid', medication_name: 'Tacrolimus 1 MG Oral Capsule', source: 'FHIR_R4' },
    });
    const result = await importer.persistMedicationRequests(client, ctx, patientId, medicationRequests);
    expect(result.fhirStored).toBe(1);
    expect(result.nativeMaterialised).toBe(1);
    const medInserts = client._queries.filter(q => q.sql.includes('INSERT INTO patient_medications'));
    expect(medInserts).toHaveLength(1);
    expect(medInserts[0].params).toContain('Tacrolimus 1 MG Oral Capsule');
    expect(medInserts[0].params).toContain('active');
    expect(medInserts[0].params).toContain('Dr. Smith');
    expect(medInserts[0].params).toContain('FHIR_R4');
  });

  it('persistAllergies: stores to fhir_resources and creates patient_allergies', async () => {
    const allergies = [
      {
        resourceType: 'AllergyIntolerance',
        id: 'allergy-1',
        type: 'allergy',
        category: ['medication'],
        criticality: 'high',
        patient: { reference: 'Patient/epic-pt-1' },
        code: {
          coding: [{ code: '7980', system: 'http://www.nlm.nih.gov/research/umls/rxnorm', display: 'Penicillin' }],
        },
        clinicalStatus: { coding: [{ code: 'active' }] },
        verificationStatus: { coding: [{ code: 'confirmed' }] },
        reaction: [{ description: 'Anaphylaxis' }],
        onsetDateTime: '2010-06-01T00:00:00Z',
      },
    ];
    const client = makeMockClient({
      patient_allergies: { id: 'allergy-uuid', display: 'Penicillin', source: 'FHIR_R4' },
    });
    const result = await importer.persistAllergies(client, ctx, patientId, allergies);
    expect(result.fhirStored).toBe(1);
    expect(result.nativeMaterialised).toBe(1);
    const allergyInserts = client._queries.filter(q => q.sql.includes('INSERT INTO patient_allergies'));
    expect(allergyInserts).toHaveLength(1);
    expect(allergyInserts[0].params).toContain('Penicillin');
    expect(allergyInserts[0].params).toContain('high');
    expect(allergyInserts[0].params).toContain('medication');
    expect(allergyInserts[0].params).toContain('Anaphylaxis');
    expect(allergyInserts[0].params).toContain('FHIR_R4');
  });

  it('skips resources with wrong resourceType without throwing', async () => {
    const client = makeMockClient();
    const r1 = await importer.persistConditions(client, ctx, patientId, [{ resourceType: 'Observation' }]);
    const r2 = await importer.persistMedicationRequests(client, ctx, patientId, [null, undefined]);
    const r3 = await importer.persistAllergies(client, ctx, patientId, []);
    expect(r1.fhirStored).toBe(0);
    expect(r2.fhirStored).toBe(0);
    expect(r3.fhirStored).toBe(0);
  });

  it('persistConditions: uses code.text when coding array is absent', async () => {
    const conditions = [
      {
        resourceType: 'Condition',
        id: 'cond-text',
        subject: { reference: 'Patient/p' },
        code: { text: 'End-stage renal disease' },
      },
    ];
    const client = makeMockClient({
      patient_conditions: { id: 'c-uuid', code: 'End-stage renal disease', source: 'FHIR_R4' },
    });
    const result = await importer.persistConditions(client, ctx, patientId, conditions);
    expect(result.nativeMaterialised).toBe(1);
    const condInserts = client._queries.filter(q => q.sql.includes('INSERT INTO patient_conditions'));
    expect(condInserts[0].params).toContain('End-stage renal disease');
  });
});

describe('Epic patient normalization', () => {
  it('extracts MRN from a typed identifier and maps gender to TransTrack codes', () => {
    const patient = {
      resourceType: 'Patient',
      id: 'erXuFYUfucBZaryVksYEcMg3',
      identifier: [
        {
          system: 'urn:oid:1.2.840.114350.1.13.0.1.7.5.737384.0',
          type: { coding: [{ code: 'MR' }] },
          value: 'E2002',
        },
      ],
      name: [
        { use: 'official', family: 'Lopez', given: ['Camila', 'Maria'] },
      ],
      gender: 'female',
      birthDate: '1987-09-12',
      telecom: [
        { system: 'phone', use: 'home', value: '555-867-5309' },
        { system: 'email', value: 'camila@example.com' },
      ],
    };
    const native = importer.normalizePatient(patient);
    expect(native.mrn).toBe('E2002');
    expect(native.first_name).toBe('Camila');
    expect(native.middle_name).toBe('Maria');
    expect(native.last_name).toBe('Lopez');
    expect(native.sex).toBe('F');
    expect(native.date_of_birth).toBe('1987-09-12');
    expect(native.phone).toBe('555-867-5309');
    expect(native.email).toBe('camila@example.com');
    expect(native.notes).toMatch(/Imported from Epic/);
  });

  it('falls back to Epic Patient.id as MRN when no identifier is present', () => {
    const patient = {
      resourceType: 'Patient',
      id: 'erXuFYUfucBZaryVksYEcMg3',
      name: [{ family: 'Lopez', given: ['Camila'] }],
      gender: 'unknown',
    };
    const native = importer.normalizePatient(patient);
    expect(native.mrn).toBe('epic-erXuFYUfucBZaryVksYEcMg3');
    expect(native.sex).toBe('U');
  });

  it('extracts MRN from system URI when type coding is absent', () => {
    const patient = {
      resourceType: 'Patient',
      id: 'p',
      identifier: [
        { system: 'urn:hospital:medicalRecordNumber', value: 'MRN-42' },
      ],
      name: [{ family: 'X' }],
    };
    expect(importer.pickMrn(patient)).toBe('MRN-42');
  });

  it('rejects non-Patient resources', () => {
    expect(() =>
      importer.normalizePatient({ resourceType: 'Observation' }),
    ).toThrow(/not a FHIR Patient/);
  });
});
