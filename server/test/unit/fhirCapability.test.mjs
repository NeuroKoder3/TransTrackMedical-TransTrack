import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cap = require('../../src/fhir/capabilityStatement.js');

describe('FHIR CapabilityStatement', () => {
  const built = cap.build({
    baseUrl: 'https://api.example.com/fhir',
    requireAuth: true,
    smartIssuer: 'https://api.example.com',
  });

  it('declares R4 with US Core profiles', () => {
    expect(built.resourceType).toBe('CapabilityStatement');
    expect(built.fhirVersion).toBe('4.0.1');
    const patient = built.rest[0].resource.find(r => r.type === 'Patient');
    expect(patient.profile).toContain('us-core');
  });

  it('advertises USCDI v3 resources', () => {
    const types = built.rest[0].resource.map(r => r.type);
    for (const t of [
      'Patient','Observation','Encounter','MedicationRequest','AllergyIntolerance',
      'CarePlan','CareTeam','Condition','Coverage','Device','DiagnosticReport',
      'DocumentReference','Goal','Immunization','Location','Medication',
      'MedicationDispense','MedicationStatement','Organization','Practitioner',
      'PractitionerRole','Procedure','Provenance','RelatedPerson','ServiceRequest',
      'Specimen','Group','Subscription',
    ]) {
      expect(types).toContain(t);
    }
  });

  it('declares Bulk Data $export operations', () => {
    const ops = built.rest[0].operation.map(o => o.name);
    expect(ops).toContain('export');
    expect(ops).toContain('patient-export');
    expect(ops).toContain('group-export');
  });

  it('publishes SMART oauth-uris extension when auth required', () => {
    const ext = built.rest[0].security.extension[0].extension;
    const urls = ext.reduce((m, e) => ({ ...m, [e.url]: e.valueUri }), {});
    expect(urls.authorize).toBe('https://api.example.com/oauth2/authorize');
    expect(urls.token).toBe('https://api.example.com/oauth2/token');
    expect(urls.register).toBe('https://api.example.com/oauth2/register');
  });

  it('lists HL7 v2 messaging surface', () => {
    expect(built.messaging[0].supportedMessage.length).toBeGreaterThan(20);
  });
});
