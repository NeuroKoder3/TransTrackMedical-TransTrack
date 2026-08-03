/**
 * H-14 — Offline (localClient) and thin-client (remoteClient) API contracts.
 *
 * Divergent silent no-ops between the two clients caused priority scores and
 * other clinical side-effects to go stale without a user-visible error. This
 * suite locks the shared surface and asserts remote mode fails loudly for
 * desktop-only operations.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/localClient', async (importOriginal) => {
  // Keep the real module; we only need the export shape.
  return importOriginal();
});

describe('API client parity (H-14)', () => {
  beforeEach(() => {
    window.transtrackConfig = { apiBaseUrl: 'https://api.example.test' };
    window.electronAPI = undefined;
  });

  it('remote and local clients expose the same top-level namespaces', async () => {
    const { default: localClient } = await import('@/api/localClient');
    const { createRemoteClient } = await import('@/api/remoteClient');
    const remote = createRemoteClient();

    // localClient is a Proxy resolved at access time — Object.keys is empty.
    // Shared clinical / auth surface that both deployment modes must expose.
    // (Remote-only helpers such as `patients` / `audit` HTTP facades are
    // intentionally not required on the offline client.)
    for (const key of [
      'auth',
      'entities',
      'functions',
      'calculators',
      'hl7',
      'integrations',
    ]) {
      expect(localClient[key], `localClient missing ${key}`).toBeTruthy();
      expect(remote[key], `remoteClient missing ${key}`).toBeTruthy();
    }
  });

  it('remote functions.invoke fails loudly for desktop-only names', async () => {
    const { createRemoteClient } = await import('@/api/remoteClient');
    const remote = createRemoteClient();
    await expect(
      remote.functions.invoke('calculatePriorityAdvanced', { patient_id: 'p1' })
    ).rejects.toThrow(/not available in remote API mode/);
  });

  it('remote entities refuse unsupported types on read (no empty silent set)', async () => {
    const { createRemoteClient } = await import('@/api/remoteClient');
    const remote = createRemoteClient();
    await expect(remote.entities.ReadinessBarrier.list()).rejects.toThrow(
      /not available in remote API mode/
    );
  });

  it('Patient entity remains available on both clients', async () => {
    const { default: localClient } = await import('@/api/localClient');
    const { createRemoteClient } = await import('@/api/remoteClient');
    const remote = createRemoteClient();

    expect(typeof localClient.entities.Patient.list).toBe('function');
    expect(typeof remote.entities.Patient.list).toBe('function');
    expect(typeof localClient.entities.Patient.create).toBe('function');
    expect(typeof remote.entities.Patient.create).toBe('function');
  });
});
