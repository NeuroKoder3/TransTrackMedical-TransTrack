/**
 * M-12 regression suite — request-body validation.
 *
 * Six of the seven calculator routes passed req.body straight to the scoring
 * function with no schema, and PATCH /patients/:id used
 * z.object({}).passthrough(), which let any writer set any allowlisted
 * patient column by naming it in the body.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { loadWithStubs, restoreModules, fakeApp, fakeClient, fakePool } from './helpers/routeHarness.mjs';

const require = createRequire(import.meta.url);
const { schemas } = require('../../src/routes/calculators.js');

const ORG = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PATIENT_ID = 'cccccccc-5555-4555-8555-cccccccccccc';

afterEach(() => restoreModules());

const VALID_BODIES = {
  meld: { creatinine_mg_dl: 1.4, bilirubin_mg_dl: 2.1, inr: 1.3 },
  'meld-na': { creatinine_mg_dl: 1.4, bilirubin_mg_dl: 2.1, inr: 1.3, sodium_meq_l: 133 },
  'meld-3': {
    creatinine_mg_dl: 1.4, bilirubin_mg_dl: 2.1, inr: 1.3,
    sodium_meq_l: 133, albumin_g_dl: 3.1, sex: 'female',
  },
  peld: {
    bilirubin_mg_dl: 2.1, inr: 1.3, albumin_g_dl: 3.1,
    age_years: 4, growth_failure: false,
  },
  las: {
    diagnosis_group: 'D', age_years: 61, bmi: 24.5,
    functional_status: 'some_assistance', six_minute_walk_ft: 900,
    continuous_o2_l_min: 3, pco2_mmHg: 46,
    on_mechanical_ventilation: false, creatinine_mg_dl: 1.1, bilirubin_mg_dl: 0.8,
  },
  kdpi: {
    age_years: 45, height_cm: 175, weight_kg: 82, african_american: false,
    hypertension: true, diabetes: false, cause_of_death: 'CVA',
    creatinine_mg_dl: 1.2, hcv_positive: false, dcd: false,
  },
  epts: {
    age_years: 55, diabetes: true,
    prior_solid_organ_transplant: false, years_on_dialysis: 3.5,
  },
};

describe('every calculator route validates its body', () => {
  it('covers all seven calculators', () => {
    expect(Object.keys(schemas).sort()).toEqual(
      ['epts', 'kdpi', 'las', 'meld', 'meld-3', 'meld-na', 'peld']
    );
  });

  for (const [name, body] of Object.entries(VALID_BODIES)) {
    it(`accepts a well-formed ${name} body`, () => {
      expect(() => schemas[name].parse(body)).not.toThrow();
    });

    it(`rejects an empty ${name} body`, () => {
      expect(() => schemas[name].parse({})).toThrow();
    });

    it(`rejects a string where ${name} expects a number`, () => {
      const numericField = Object.entries(body).find(([, v]) => typeof v === 'number')?.[0];
      expect(() => schemas[name].parse({ ...body, [numericField]: 'not-a-number' })).toThrow();
    });

    it(`strips unknown keys from the ${name} body`, () => {
      const parsed = schemas[name].parse({ ...body, __proto_pollution: 'x', score: 40 });
      expect(parsed).not.toHaveProperty('__proto_pollution');
      expect(parsed).not.toHaveProperty('score');
    });
  }

  it('rejects an out-of-range enum instead of silently scoring it', () => {
    expect(() => schemas.las.parse({ ...VALID_BODIES.las, diagnosis_group: 'Z' })).toThrow();
    expect(() => schemas.kdpi.parse({ ...VALID_BODIES.kdpi, cause_of_death: 'UNKNOWN' })).toThrow();
    expect(() => schemas['meld-3'].parse({ ...VALID_BODIES['meld-3'], sex: 'other' })).toThrow();
  });

  it('rejects NaN and Infinity', () => {
    expect(() => schemas.meld.parse({ ...VALID_BODIES.meld, inr: NaN })).toThrow();
    expect(() => schemas.meld.parse({ ...VALID_BODIES.meld, inr: Infinity })).toThrow();
  });
});

describe('PATCH /patients/:id no longer accepts arbitrary columns', () => {
  async function patientRoutes() {
    const client = fakeClient(() => [{ id: PATIENT_ID, first_name: 'Jane', last_name: 'Doe' }]);
    const updates = [];
    const routes = loadWithStubs('src/routes/patients.js', {
      'src/db/pool.js': fakePool(client),
      'src/services/patientService.js': {
        list: async () => [],
        get: async () => ({ id: PATIENT_ID }),
        update: async (_c, _ctx, id, input) => { updates.push({ id, input }); return { id }; },
        create: async (_c, _ctx, input) => { updates.push({ create: input }); return { id: PATIENT_ID }; },
      },
    });
    const app = fakeApp();
    await routes(app);
    return { app, updates };
  }

  const auth = { orgId: ORG, role: 'coordinator', tokenType: 'jwt' };

  it('forwards declared fields', async () => {
    const { app, updates } = await patientRoutes();
    await app.call('PATCH /patients/:id', {
      params: { id: PATIENT_ID },
      body: { waitlist_status: 'inactive', notes: 'moved to another centre' },
      auth,
    });
    expect(updates[0].input).toEqual({
      waitlist_status: 'inactive', notes: 'moved to another centre',
    });
  });

  it('drops columns the caller has no business naming', async () => {
    const { app, updates } = await patientRoutes();
    await app.call('PATCH /patients/:id', {
      params: { id: PATIENT_ID },
      body: {
        notes: 'ok',
        id: 'some-other-patient',
        org_id: 'another-org',
        created_by: 'someone-else',
        created_at: '1999-01-01',
        updated_by: 'someone-else',
      },
      auth,
    });
    expect(updates[0].input).toEqual({ notes: 'ok' });
  });

  it('rejects a body with nothing writable in it', async () => {
    const { app } = await patientRoutes();
    await expect(app.call('PATCH /patients/:id', {
      params: { id: PATIENT_ID },
      body: { org_id: 'another-org' },
      auth,
    })).rejects.toMatchObject({ status: 400 });
  });

  it('type-checks the fields it does accept', async () => {
    const { app } = await patientRoutes();
    await expect(app.call('PATCH /patients/:id', {
      params: { id: PATIENT_ID },
      body: { meld_score: 'forty' },
      auth,
    })).rejects.toThrow();
    await expect(app.call('PATCH /patients/:id', {
      params: { id: PATIENT_ID },
      body: { email: 'not-an-email' },
      auth,
    })).rejects.toThrow();
  });

  it('applies the same allowlist to POST /patients', async () => {
    const { app, updates } = await patientRoutes();
    await app.call('POST /patients', {
      body: { first_name: 'Jane', last_name: 'Doe', org_id: 'another-org', id: 'chosen-id' },
      auth,
    });
    expect(updates[0].create).toEqual({ first_name: 'Jane', last_name: 'Doe' });
  });
});
