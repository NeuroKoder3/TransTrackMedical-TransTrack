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

describe('normalizeScopeString', () => {
  it('deduplicates and sorts scope tokens', () => {
    const result = scopes.normalizeScopeString('openid patient/Patient.rs openid launch/patient');
    expect(result).toBe('launch/patient openid patient/Patient.rs');
  });

  it('returns empty string for empty/null input', () => {
    expect(scopes.normalizeScopeString('')).toBe('');
    expect(scopes.normalizeScopeString(null)).toBe('');
    expect(scopes.normalizeScopeString(undefined)).toBe('');
  });

  it('trims extra whitespace', () => {
    expect(scopes.normalizeScopeString('  openid   profile  ')).toBe('openid profile');
  });
});

describe('assertRegisteredRedirect', () => {
  it('throws when redirect_uris is empty', () => {
    const client = { redirect_uris: [] };
    expect(() => scopes.assertRegisteredRedirect(client, 'http://localhost/cb'))
      .toThrow('Client has no registered redirect_uris');
  });

  it('throws when redirect_uris is missing/null', () => {
    const client = { redirect_uris: null };
    expect(() => scopes.assertRegisteredRedirect(client, 'http://localhost/cb'))
      .toThrow('Client has no registered redirect_uris');
  });

  it('throws when URI is not in the registered list', () => {
    const client = { redirect_uris: ['https://app.example/callback'] };
    expect(() => scopes.assertRegisteredRedirect(client, 'https://evil.example/steal'))
      .toThrow('redirect_uri is not registered for this client');
  });

  it('passes when URI matches exactly', () => {
    const client = { redirect_uris: ['https://app.example/callback'] };
    expect(() => scopes.assertRegisteredRedirect(client, 'https://app.example/callback'))
      .not.toThrow();
  });
});

describe('constrainScopes', () => {
  it('constrains requested to registered subset', () => {
    const result = scopes.constrainScopes(
      'patient/Patient.rs patient/Observation.cruds',
      'patient/Patient.rs patient/Observation.rs'
    );
    expect(result).toContain('patient/Patient.rs');
    expect(result).toContain('patient/Observation.rs');
    expect(result).not.toContain('cruds');
  });

  it('throws on unknown/malformed FHIR scope', () => {
    expect(() => scopes.constrainScopes(
      'patient/Patient.rs garbage_scope',
      'patient/Patient.rs'
    )).toThrow(/Unknown or malformed scope/);
  });

  it('throws when registered scope is empty', () => {
    expect(() => scopes.constrainScopes('patient/Patient.rs', ''))
      .toThrow('Client has no registered scopes');
  });

  it('throws when requested scope exceeds registration', () => {
    expect(() => scopes.constrainScopes(
      'system/Patient.cruds',
      'patient/Patient.rs'
    )).toThrow(/Scope not permitted/);
  });

  it('wildcard resource in registration permits specific resource', () => {
    const result = scopes.constrainScopes(
      'patient/Patient.rs',
      'patient/*.cruds'
    );
    expect(result).toContain('patient/Patient.rs');
  });

  it('never defaults to system/*.rs when registered is empty', () => {
    expect(() => scopes.constrainScopes('system/*.rs', ''))
      .toThrow('Client has no registered scopes');
  });
});

describe('requirePkceForPublic', () => {
  it('throws when public client has no code_challenge', () => {
    const client = { client_type: 'public' };
    expect(() => scopes.requirePkceForPublic(client, undefined, undefined))
      .toThrow('PKCE code_challenge is required');
  });

  it('throws when public client uses plain method', () => {
    const client = { client_type: 'public' };
    expect(() => scopes.requirePkceForPublic(client, 'abc123', 'plain'))
      .toThrow('Only S256');
  });

  it('passes for public client with S256', () => {
    const client = { client_type: 'public' };
    expect(() => scopes.requirePkceForPublic(client, 'abc123', 'S256'))
      .not.toThrow();
  });

  it('does not enforce for confidential clients', () => {
    const client = { client_type: 'confidential' };
    expect(() => scopes.requirePkceForPublic(client, undefined, undefined))
      .not.toThrow();
  });
});
