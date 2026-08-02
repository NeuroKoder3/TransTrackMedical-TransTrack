/**
 * H-12 / L-15 regression suite — CDS Hooks invocation audit.
 *
 * The audit row used to carry the complete request and response bodies, so
 * cds_service_invocations became a second unredacted copy of the patient
 * context and every prefetched FHIR resource. The route was also open to any
 * authenticated token, and the feedback endpoint claimed success while
 * storing nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { loadWithStubs, restoreModules, fakeApp, fakeReply, fakeClient, fakePool } from './helpers/routeHarness.mjs';

const require = createRequire(import.meta.url);
const { summariseRequest, summariseResponse } = require('../../src/cds/auditSummary.js');
const smartScopes = require('../../src/smart/scopes.js');

const ORG = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PATIENT_MRN = '900001';
const PATIENT_NAME = 'Doe';

const CDS_REQUEST = {
  hook: 'patient-view',
  hookInstance: 'ffffffff-0000-4000-8000-ffffffffffff',
  fhirServer: 'https://ehr.example.org/fhir',
  user: 'Practitioner/123',
  context: { patientId: 'patient-1', userId: 'Practitioner/123' },
  prefetch: {
    patient: {
      resourceType: 'Patient',
      id: 'patient-1',
      name: [{ family: PATIENT_NAME, given: ['Jane'] }],
      identifier: [{ value: PATIENT_MRN }],
      birthDate: '1980-01-01',
    },
    medications: {
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'MedicationRequest', id: 'm1' } },
        { resource: { resourceType: 'MedicationRequest', id: 'm2' } },
      ],
    },
  },
};

const CDS_RESPONSE = {
  cards: [{
    summary: `Transplant candidate ${PATIENT_NAME} MRN ${PATIENT_MRN}`,
    detail: `**MELD:** 22 for ${PATIENT_NAME}`,
    indicator: 'warning',
    source: { label: 'TransTrack' },
    suggestions: [{ label: 'Refer' }],
    uuid: 'card-1',
  }],
};

describe('CDS audit summaries carry no PHI', () => {
  it('describes the request by shape, not by value', () => {
    const summary = summariseRequest(CDS_REQUEST);
    expect(summary).toEqual({
      hook: 'patient-view',
      contextKeys: ['patientId', 'userId'],
      prefetchKeys: ['medications', 'patient'],
      prefetchResourceTypes: { Patient: 1, MedicationRequest: 2 },
      draftOrderCount: 0,
      hasFhirAuthorization: false,
      requestBytes: expect.any(Number),
    });
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain(PATIENT_NAME);
    expect(serialised).not.toContain(PATIENT_MRN);
    expect(serialised).not.toContain('1980-01-01');
  });

  it('counts draft orders without copying them', () => {
    const summary = summariseRequest({
      hook: 'order-sign',
      context: { patientId: 'p', draftOrders: { entry: [{ resource: {} }, { resource: {} }] } },
    });
    expect(summary.draftOrderCount).toBe(2);
    expect(JSON.stringify(summary)).not.toContain('resource');
  });

  it('describes the response by counts and indicators, never card prose', () => {
    const summary = summariseResponse(CDS_RESPONSE);
    expect(summary.cardCount).toBe(1);
    expect(summary.cardIndicators).toEqual({ warning: 1 });
    expect(summary.cardSources).toEqual(['TransTrack']);
    expect(summary.suggestionCount).toBe(1);
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain(PATIENT_NAME);
    expect(serialised).not.toContain(PATIENT_MRN);
    expect(serialised).not.toContain('MELD');
  });

  it('tolerates a malformed response without throwing', () => {
    expect(summariseResponse(undefined).cardCount).toBe(0);
    expect(summariseRequest(undefined).contextKeys).toEqual([]);
  });
});

describe('CDS invocation audit stores no raw payload by default', () => {
  let app;
  let client;

  async function buildRoutes(config) {
    client = fakeClient(() => []);
    const routes = loadWithStubs('src/routes/cds.js', {
      'src/db/pool.js': fakePool(client),
    });
    app = fakeApp();
    await routes(app, { config });
    return routes;
  }

  afterEach(() => restoreModules());

  function invocationRequest() {
    return {
      params: { id: 'transplant-candidate-summary' },
      body: CDS_REQUEST,
      auth: { orgId: ORG, role: 'physician', tokenType: 'jwt' },
      log: { warn: () => {}, info: () => {}, error: () => {} },
    };
  }

  it('writes summaries and leaves the raw payload columns null', async () => {
    await buildRoutes({ CDS_CAPTURE_RAW_PAYLOADS: false, CDS_RAW_PAYLOAD_RETENTION_DAYS: 7 });
    await app.call('POST /cds-services/:id', invocationRequest(), fakeReply());

    const insert = client.queries.find((q) => /INSERT INTO cds_service_invocations/.test(q.text));
    expect(insert).toBeDefined();
    // $11 request_body, $12 response_body, $13 raw_payload_captured
    expect(insert.values[10]).toBeNull();
    expect(insert.values[11]).toBeNull();
    expect(insert.values[12]).toBe(false);
    expect(JSON.parse(insert.values[8]).hook).toBe('patient-view');
    expect(JSON.parse(insert.values[9])).toHaveProperty('cardCount');
    expect(JSON.stringify(insert.values)).not.toContain(PATIENT_NAME);
  });

  it('captures and dates raw payloads only when explicitly enabled', async () => {
    await buildRoutes({ CDS_CAPTURE_RAW_PAYLOADS: true, CDS_RAW_PAYLOAD_RETENTION_DAYS: 3 });
    await app.call('POST /cds-services/:id', invocationRequest(), fakeReply());

    const insert = client.queries.find((q) => /INSERT INTO cds_service_invocations/.test(q.text));
    expect(insert.values[12]).toBe(true);
    expect(insert.values[13]).toBe(3);
    expect(insert.text).toContain('raw_payload_expires_at');
    expect(JSON.parse(insert.values[10]).hook).toBe('patient-view');
  });
});

describe('CDS invocation is authorised, not merely authenticated', () => {
  let requireCdsInvoke;

  beforeEach(() => {
    const routes = loadWithStubs('src/routes/cds.js', {
      'src/db/pool.js': fakePool(fakeClient(() => [])),
    });
    requireCdsInvoke = routes.requireCdsInvoke;
  });

  afterEach(() => restoreModules());

  function smartReq(scope) {
    return {
      auth: {
        tokenType: 'smart', orgId: ORG, role: 'smart_system',
        smart: { parsedScopes: smartScopes.parseScopes(scope) },
      },
    };
  }

  it('rejects an unauthenticated request', async () => {
    await expect(requireCdsInvoke({})).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a SMART token with no read or search scope', async () => {
    await expect(requireCdsInvoke(smartReq('system/Patient.c')))
      .rejects.toMatchObject({ status: 403 });
    await expect(requireCdsInvoke(smartReq('launch openid')))
      .rejects.toMatchObject({ status: 403 });
  });

  it('accepts a SMART token granted read access', async () => {
    await expect(requireCdsInvoke(smartReq('system/Patient.rs'))).resolves.toBeUndefined();
    await expect(requireCdsInvoke(smartReq('user/*.read'))).resolves.toBeUndefined();
  });

  it('rejects a native role that may not read patient data', async () => {
    await expect(requireCdsInvoke({ auth: { tokenType: 'jwt', role: 'regulator', orgId: ORG } }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('accepts the native clinical roles', async () => {
    for (const role of ['admin', 'physician', 'coordinator', 'viewer']) {
      await expect(requireCdsInvoke({ auth: { tokenType: 'jwt', role, orgId: ORG } }))
        .resolves.toBeUndefined();
    }
  });
});

describe('CDS feedback is persisted rather than merely acknowledged (L-15)', () => {
  let app;
  let client;
  let stored;

  beforeEach(async () => {
    stored = [];
    client = fakeClient((text, values) => {
      if (/INSERT INTO cds_service_feedback/.test(text)) stored.push(values);
      return [];
    });
    const routes = loadWithStubs('src/routes/cds.js', {
      'src/db/pool.js': fakePool(client),
    });
    app = fakeApp();
    await routes(app, { CDS_CAPTURE_RAW_PAYLOADS: false });
  });

  afterEach(() => restoreModules());

  it('stores every outcome it acknowledges', async () => {
    const result = await app.call('POST /cds-services/:id/feedback', {
      params: { id: 'transplant-candidate-summary' },
      body: {
        feedback: [
          { card: 'card-1', outcome: 'accepted', acceptedSuggestions: [{ id: 's1' }] },
          {
            card: 'card-2',
            outcome: 'overridden',
            overrideReason: { code: 'patient-preference', system: 'http://example.org' },
          },
        ],
      },
      auth: { orgId: ORG, role: 'physician', tokenType: 'jwt' },
      log: { info: () => {}, warn: () => {} },
    });
    expect(result).toEqual({ acknowledged: true, recorded: 2 });
    expect(stored).toHaveLength(2);
    expect(stored[0][0]).toBe(ORG);
    expect(stored[0][3]).toBe('accepted');
    expect(stored[1][6]).toBe('patient-preference');
  });

  it('does not copy the clinician free-text override reason', async () => {
    await app.call('POST /cds-services/:id/feedback', {
      params: { id: 'transplant-candidate-summary' },
      body: {
        feedback: [{
          card: 'card-1',
          outcome: 'overridden',
          overrideReason: { code: 'other', reason: `${PATIENT_NAME} declined; MRN ${PATIENT_MRN}` },
        }],
      },
      auth: { orgId: ORG, role: 'physician', tokenType: 'jwt' },
      log: { info: () => {}, warn: () => {} },
    });
    expect(JSON.stringify(stored)).not.toContain(PATIENT_NAME);
    expect(JSON.stringify(stored)).not.toContain(PATIENT_MRN);
  });

  it('rejects malformed feedback instead of acknowledging it', async () => {
    await expect(app.call('POST /cds-services/:id/feedback', {
      params: { id: 'transplant-candidate-summary' },
      body: { feedback: [{ card: 'card-1', outcome: 'ignored' }] },
      auth: { orgId: ORG, role: 'physician', tokenType: 'jwt' },
      log: { info: () => {}, warn: () => {} },
    })).rejects.toThrow();
    expect(stored).toHaveLength(0);
  });

  it('does not acknowledge feedback for a service that does not exist', async () => {
    await expect(app.call('POST /cds-services/:id/feedback', {
      params: { id: 'no-such-service' },
      body: { feedback: [{ card: 'card-1', outcome: 'accepted' }] },
      auth: { orgId: ORG, role: 'physician', tokenType: 'jwt' },
      log: { info: () => {}, warn: () => {} },
    })).rejects.toMatchObject({ status: 404 });
  });
});
