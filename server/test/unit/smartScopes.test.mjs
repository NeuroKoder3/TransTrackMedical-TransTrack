import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const scopes = require('../../src/smart/scopes.js');

describe('SMART scope parsing', () => {
  it('parses v1 read/write/* scopes into operation sets', () => {
    const [s1] = scopes.parseScopes('patient/Observation.read');
    expect(s1.kind).toBe('fhir');
    expect(s1.level).toBe('patient');
    expect(s1.resource).toBe('Observation');
    expect([...s1.ops].sort().join('')).toBe('rs');

    const [s2] = scopes.parseScopes('user/Encounter.write');
    expect([...s2.ops].sort().join('')).toBe('cdu');

    const [s3] = scopes.parseScopes('system/*.*');
    expect([...s3.ops].sort().join('')).toBe('cdrsu');
  });

  it('parses v2 cruds-style scopes', () => {
    const [s] = scopes.parseScopes('patient/Patient.rs');
    expect([...s.ops].sort().join('')).toBe('rs');

    const [s2] = scopes.parseScopes('system/*.cruds');
    expect([...s2.ops].sort().join('')).toBe('cdrsu');
  });

  it('recognises launch / openid scopes', () => {
    const list = scopes.parseScopes('openid fhirUser launch/patient offline_access');
    expect(list.every(s => s.kind === 'launch')).toBe(true);
    expect(list.map(s => s.value)).toContain('launch/patient');
  });

  it('isAllowed returns true for matching system scope', () => {
    const granted = scopes.parseScopes('system/Patient.rs system/Observation.cruds');
    expect(scopes.isAllowed(granted, 'Patient', 'r')).toBe(true);
    expect(scopes.isAllowed(granted, 'Patient', 's')).toBe(true);
    expect(scopes.isAllowed(granted, 'Observation', 'c')).toBe(true);
    expect(scopes.isAllowed(granted, 'Observation', 'd')).toBe(true);
  });

  it('isAllowed denies on resource mismatch', () => {
    const granted = scopes.parseScopes('user/Patient.r');
    expect(scopes.isAllowed(granted, 'Observation', 'r')).toBe(false);
  });

  it('isAllowed denies on op mismatch', () => {
    const granted = scopes.parseScopes('user/Observation.r');
    expect(scopes.isAllowed(granted, 'Observation', 'c')).toBe(false);
  });

  it('isAllowed for patient/* scope requires launch context', () => {
    const granted = scopes.parseScopes('patient/Patient.r');
    expect(scopes.isAllowed(granted, 'Patient', 'r')).toBe(false);
    expect(scopes.isAllowed(granted, 'Patient', 'r', { launchPatient: 'p1' })).toBe(true);
  });
});
