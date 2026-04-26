import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const subs = require('../../src/fhir/subscriptions.js');

describe('FHIR Subscription criteria matcher', () => {
  const obs = {
    resourceType: 'Observation',
    id: 'obs-1',
    status: 'final',
    subject: { reference: 'Patient/p-1' },
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  };

  it('matches resource type with no params', () => {
    expect(subs.matches('Observation', obs)).toBe(true);
    expect(subs.matches('Patient', obs)).toBe(false);
  });

  it('matches by patient reference', () => {
    expect(subs.matches('Observation?patient=Patient/p-1', obs)).toBe(true);
    expect(subs.matches('Observation?patient=p-1', obs)).toBe(true);
    expect(subs.matches('Observation?patient=other', obs)).toBe(false);
  });

  it('matches by status', () => {
    expect(subs.matches('Observation?status=final', obs)).toBe(true);
    expect(subs.matches('Observation?status=draft', obs)).toBe(false);
  });

  it('matches by code (token)', () => {
    expect(subs.matches('Observation?code=2160-0', obs)).toBe(true);
    expect(subs.matches('Observation?code=http://loinc.org|2160-0', obs)).toBe(true);
    expect(subs.matches('Observation?code=99999', obs)).toBe(false);
  });

  it('matches by category', () => {
    expect(subs.matches('Observation?category=laboratory', obs)).toBe(true);
    expect(subs.matches('Observation?category=imaging', obs)).toBe(false);
  });

  it('requires all params to match (AND semantics)', () => {
    expect(subs.matches('Observation?patient=p-1&status=final', obs)).toBe(true);
    expect(subs.matches('Observation?patient=p-1&status=draft', obs)).toBe(false);
  });
});
