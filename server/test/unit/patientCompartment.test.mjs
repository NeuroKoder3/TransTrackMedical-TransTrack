/**
 * C-1 / H-4 regression suite — SMART patient-compartment isolation.
 *
 * Every test in this file fails against the pre-remediation code, where a
 * patient-level SMART grant could read, search, write and export resources
 * belonging to any patient in the same organisation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const compartment = require('../../src/fhir/compartment.js');
const scopes = require('../../src/smart/scopes.js');
const storage = require('../../src/fhir/storage.js');
const { requireSmartScope } = require('../../src/middleware/auth.js');

const PATIENT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PATIENT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

function obsFor(patientId, id = 'obs-1') {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
    subject: { reference: `Patient/${patientId}` },
  };
}

/** Minimal pg client double that records queries and replays canned rows. */
function fakeClient(rows = []) {
  return {
    queries: [],
    async query(text, values) {
      this.queries.push({ text, values });
      return { rows: typeof rows === 'function' ? rows(text, values) : rows };
    },
  };
}

// ---------------------------------------------------------------------------
// Compartment membership
// ---------------------------------------------------------------------------

describe('FHIR R4 patient compartment membership', () => {
  it('places a Patient inside its own compartment and no other', () => {
    const body = { resourceType: 'Patient', id: PATIENT_A };
    expect(compartment.resourceBelongsToPatient('Patient', body, PATIENT_A)).toBe(true);
    expect(compartment.resourceBelongsToPatient('Patient', body, PATIENT_B)).toBe(false);
  });

  it('resolves subject-linked clinical resources to the right patient', () => {
    expect(
      compartment.resourceBelongsToPatient('Observation', obsFor(PATIENT_A), PATIENT_A)
    ).toBe(true);
    expect(
      compartment.resourceBelongsToPatient('Observation', obsFor(PATIENT_A), PATIENT_B)
    ).toBe(false);
  });

  it('resolves the patient-element forms as well as subject', () => {
    const allergy = {
      resourceType: 'AllergyIntolerance',
      patient: { reference: `Patient/${PATIENT_A}` },
    };
    expect(
      compartment.resourceBelongsToPatient('AllergyIntolerance', allergy, PATIENT_A)
    ).toBe(true);
  });

  it('traverses array paths such as Observation.performer[*].reference', () => {
    const obs = {
      resourceType: 'Observation',
      subject: { reference: `Patient/${PATIENT_B}` },
      performer: [{ reference: 'Practitioner/x' }, { reference: `Patient/${PATIENT_A}` }],
    };
    expect(compartment.resourceBelongsToPatient('Observation', obs, PATIENT_A)).toBe(true);
  });

  it('accepts bare-id and urn:uuid reference forms', () => {
    for (const ref of [PATIENT_A, `urn:uuid:${PATIENT_A}`]) {
      const obs = { resourceType: 'Observation', subject: { reference: ref } };
      expect(compartment.resourceBelongsToPatient('Observation', obs, PATIENT_A)).toBe(true);
    }
  });

  it('fails closed for resource types outside every patient compartment', () => {
    for (const type of compartment.NON_COMPARTMENT_TYPES) {
      expect(compartment.isPatientCompartmentType(type)).toBe(false);
      expect(
        compartment.resourceBelongsToPatient(type, { id: 'x', resourceType: type }, PATIENT_A)
      ).toBe(false);
      expect(compartment.searchPredicate(type, PATIENT_A, 1)).toBeNull();
    }
  });

  it('fails closed for an unknown resource type', () => {
    expect(compartment.resourceBelongsToPatient('Nonsense', { id: 'x' }, PATIENT_A)).toBe(false);
  });

  it('fails closed when no patient id is supplied', () => {
    expect(compartment.resourceBelongsToPatient('Observation', obsFor(PATIENT_A), null)).toBe(false);
  });

  it('builds a parameterised search predicate that binds the patient id', () => {
    const pred = compartment.searchPredicate('Observation', PATIENT_A, 3);
    expect(pred).not.toBeNull();
    expect(pred.sql).toContain('jsonb_path_exists');
    expect(pred.sql).toContain('$3::jsonb');
    // The patient id must travel as a bound value, never inlined into SQL text.
    expect(pred.sql).not.toContain(PATIENT_A);
    expect(JSON.parse(pred.values[0])).toEqual({
      p: `Patient/${PATIENT_A}`,
      b: PATIENT_A,
      u: `urn:uuid:${PATIENT_A}`,
    });
  });
});

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

describe('SMART scope resolution reports the granting access level', () => {
  it('reports patient level for a patient/ scope with launch context', () => {
    const granted = scopes.parseScopes('patient/Observation.rs');
    const r = scopes.resolveAccess(granted, 'Observation', 'r', { launchPatient: PATIENT_A });
    expect(r).toEqual({ allowed: true, level: 'patient' });
  });

  it('denies a patient/ scope for a type outside the patient compartment', () => {
    const granted = scopes.parseScopes('patient/*.rs');
    const r = scopes.resolveAccess(granted, 'Organization', 'r', { launchPatient: PATIENT_A });
    expect(r.allowed).toBe(false);
  });

  it('no longer blanket-allows search for non-Patient types on subject mismatch', () => {
    const granted = scopes.parseScopes('patient/Observation.rs');
    const r = scopes.resolveAccess(granted, 'Observation', 's', {
      launchPatient: PATIENT_A,
      subject: `Patient/${PATIENT_B}`,
    });
    expect(r.allowed).toBe(false);
  });

  it('prefers user/system level over patient level so tokens are not over-narrowed', () => {
    const granted = scopes.parseScopes('patient/Observation.rs user/Observation.rs');
    const r = scopes.resolveAccess(granted, 'Observation', 'r', { launchPatient: PATIENT_A });
    expect(r.level).toBe('user');
  });

  it('still requires launch context for a patient/ scope', () => {
    const granted = scopes.parseScopes('patient/Patient.r');
    expect(scopes.resolveAccess(granted, 'Patient', 'r').allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Middleware pins the compartment
// ---------------------------------------------------------------------------

describe('requireSmartScope pins the compartment for patient-level grants', () => {
  function smartReq(scopeString, launchPatient) {
    return {
      auth: {
        tokenType: 'smart',
        orgId: 'org-1',
        role: 'smart_user',
        smart: {
          parsedScopes: scopes.parseScopes(scopeString),
          launchContext: launchPatient ? { patient: launchPatient } : {},
        },
      },
    };
  }

  it('sets auth.compartment.patient on a patient-level grant', async () => {
    const req = smartReq('patient/Observation.rs', PATIENT_A);
    await requireSmartScope('Observation', 'r')(req);
    expect(req.auth.compartment).toEqual({ patient: PATIENT_A });
  });

  it('leaves the compartment unset for a user-level grant', async () => {
    const req = smartReq('user/Observation.rs', PATIENT_A);
    await requireSmartScope('Observation', 'r')(req);
    expect(req.auth.compartment).toBeUndefined();
  });

  it('rejects a patient-level grant on a non-compartment type', async () => {
    const req = smartReq('patient/*.rs', PATIENT_A);
    await expect(requireSmartScope('Organization', 'r')(req)).rejects.toThrow(/scope does not permit/);
  });

  it('enforces the native-JWT role matrix instead of allowing everything (M-9)', async () => {
    const viewer = { auth: { tokenType: 'jwt', role: 'viewer', orgId: 'org-1' } };
    await expect(requireSmartScope('Observation', 'r')(viewer)).resolves.toBeUndefined();
    await expect(requireSmartScope('Observation', 'c')(viewer)).rejects.toThrow(/may not create/);
    await expect(requireSmartScope('Observation', 'd')(viewer)).rejects.toThrow(/may not delete/);

    const coordinator = { auth: { tokenType: 'jwt', role: 'coordinator', orgId: 'org-1' } };
    await expect(requireSmartScope('Observation', 'c')(coordinator)).resolves.toBeUndefined();
    await expect(requireSmartScope('Observation', 'd')(coordinator)).rejects.toThrow(/may not delete/);

    const admin = { auth: { tokenType: 'jwt', role: 'admin', orgId: 'org-1' } };
    await expect(requireSmartScope('Observation', 'd')(admin)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Storage enforcement — the boundary that actually releases data
// ---------------------------------------------------------------------------

describe('storage refuses to release resources outside the compartment', () => {
  let ctxA;

  beforeEach(() => {
    ctxA = { orgId: 'org-1', compartment: { patient: PATIENT_A } };
  });

  it('returns the resource when it belongs to the launch patient', async () => {
    const client = fakeClient([{ body: obsFor(PATIENT_A), version_id: 1, deleted: false }]);
    const row = await storage.read(client, ctxA, 'Observation', 'obs-1');
    expect(row).not.toBeNull();
  });

  it('returns null for another patient resource even though the row exists', async () => {
    const client = fakeClient([{ body: obsFor(PATIENT_B), version_id: 1, deleted: false }]);
    const row = await storage.read(client, ctxA, 'Observation', 'obs-1');
    expect(row).toBeNull();
  });

  it('does not restrict reads when no compartment is pinned', async () => {
    const client = fakeClient([{ body: obsFor(PATIENT_B), version_id: 1, deleted: false }]);
    const row = await storage.read(client, { orgId: 'org-1' }, 'Observation', 'obs-1');
    expect(row).not.toBeNull();
  });

  it('injects the compartment predicate into search SQL', async () => {
    const client = fakeClient([]);
    await storage.search(client, ctxA, 'Observation', {});
    expect(client.queries[0].text).toContain('jsonb_path_exists');
  });

  it('returns no rows when searching a non-compartment type under a patient grant', async () => {
    const client = fakeClient([{ body: { resourceType: 'Organization', id: 'o1' } }]);
    const rows = await storage.search(client, ctxA, 'Organization', {});
    expect(rows).toEqual([]);
    expect(client.queries).toHaveLength(0);
  });

  it('refuses to create a resource for another patient', async () => {
    const client = fakeClient([]);
    await expect(
      storage.create(client, ctxA, 'Observation', obsFor(PATIENT_B))
    ).rejects.toThrow(/outside the launch patient compartment/);
  });

  it('allows creating a resource for the launch patient', async () => {
    const client = fakeClient([{ body: obsFor(PATIENT_A), version_id: 1, deleted: false }]);
    await expect(
      storage.create(client, ctxA, 'Observation', obsFor(PATIENT_A))
    ).resolves.toBeTruthy();
  });

  it('refuses to update a stored resource belonging to another patient', async () => {
    const client = fakeClient([{ body: obsFor(PATIENT_B), version_id: 1, deleted: false }]);
    await expect(
      storage.update(client, ctxA, 'Observation', 'obs-1', obsFor(PATIENT_A))
    ).rejects.toThrow(/outside the launch patient compartment/);
  });

  it('refuses to re-point a compartment resource at another patient', async () => {
    const client = fakeClient([{ body: obsFor(PATIENT_A), version_id: 1, deleted: false }]);
    await expect(
      storage.update(client, ctxA, 'Observation', 'obs-1', obsFor(PATIENT_B))
    ).rejects.toThrow(/outside the launch patient compartment/);
  });

  it('refuses to delete another patient resource', async () => {
    const client = fakeClient([{ body: obsFor(PATIENT_B), version_id: 1, deleted: false }]);
    await expect(
      storage.softDelete(client, ctxA, 'Observation', 'obs-1')
    ).rejects.toThrow(/outside the launch patient compartment/);
  });

  it('hides another patient resource from history', async () => {
    const client = fakeClient([{ body: obsFor(PATIENT_B), version_id: 1, deleted: false }]);
    expect(await storage.history(client, ctxA, 'Observation', 'obs-1')).toBeNull();
  });
});
