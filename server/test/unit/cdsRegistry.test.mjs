import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const registry = require('../../src/cds/registry.js');

describe('CDS Hooks registry', () => {
  beforeEach(() => registry.clear());

  it('registers and lists services', () => {
    registry.register({
      id: 'foo', hook: 'patient-view', title: 'foo', description: 'x',
      handler: async () => ({ cards: [] }),
    });
    registry.register({
      id: 'bar', hook: 'order-select', title: 'bar', description: 'y',
      prefetch: { p: 'Patient/{{context.patientId}}' },
      handler: async () => ({ cards: [] }),
    });
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'foo', hook: 'patient-view' });
    expect(list[1].prefetch).toEqual({ p: 'Patient/{{context.patientId}}' });
  });

  it('rejects malformed registrations', () => {
    expect(() => registry.register({ id: 'x', handler: 'not a function' })).toThrow();
    expect(() => registry.register({ hook: 'patient-view', handler: () => null })).toThrow();
  });

  it('builds a card with required fields', () => {
    const c = registry.card({ summary: 'hello', indicator: 'warning', detail: 'long' });
    expect(c).toMatchObject({ summary: 'hello', indicator: 'warning', detail: 'long' });
    expect(c.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.source.label).toBe('TransTrack');
  });
});
