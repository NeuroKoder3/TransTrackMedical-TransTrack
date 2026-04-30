/**
 * Multi-tenant Epic registry — unit tests.
 *
 * Validates resolution from the JSON config file, env vars, and the
 * generic single-tenant fallback. Does NOT exercise the network layer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const registry = require('../../src/integrations/epic/registry');

// Snapshot/strip ALL Epic-related env vars between tests so tests cannot
// pollute each other regardless of the orgId-suffix variants they create.
let SAVED_ENV = {};
function snapshotAllEpicEnv() {
  SAVED_ENV = {};
  for (const k of Object.keys(process.env)) {
    if (k === 'EPIC_CUSTOMERS_CONFIG' || k.startsWith('EPIC_')) {
      SAVED_ENV[k] = process.env[k];
    }
  }
}
function stripAllEpicEnv() {
  for (const k of Object.keys(process.env)) {
    if (k === 'EPIC_CUSTOMERS_CONFIG' || k.startsWith('EPIC_')) {
      delete process.env[k];
    }
  }
}
function restoreEpicEnv() {
  stripAllEpicEnv();
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    process.env[k] = v;
  }
}

let tmpdir;
beforeEach(() => {
  snapshotAllEpicEnv();
  stripAllEpicEnv();
  registry.resetCache();
  tmpdir = mkdtempSync(path.join(os.tmpdir(), 'epic-registry-test-'));
});
afterEach(() => {
  restoreEpicEnv();
  registry.resetCache();
  if (tmpdir) rmSync(tmpdir, { recursive: true, force: true });
});

describe('getCustomerConfig — input validation', () => {
  it('rejects missing orgId', () => {
    expect(() => registry.getCustomerConfig()).toThrow(/orgId is required/);
    expect(() => registry.getCustomerConfig({})).toThrow(/orgId is required/);
  });

  it('rejects unknown environment', () => {
    expect(() =>
      registry.getCustomerConfig({ orgId: 'x', environment: 'staging' })
    ).toThrow(/'prod' or 'sandbox'/);
  });
});

describe('getCustomerConfig — env-var resolution', () => {
  it('throws when no clientId present anywhere', () => {
    expect(() =>
      registry.getCustomerConfig({ orgId: 'org-a' })
    ).toThrow(/no clientId resolved/);
  });

  it('resolves per-customer env vars (sandbox)', () => {
    process.env.EPIC_CLIENT_ID__ORG_A__SANDBOX = 'client-A-sandbox';
    process.env.EPIC_PRIVATE_KEY_FILE__ORG_A__SANDBOX = 'C:/keys/orgA-sandbox.pem';
    const cfg = registry.getCustomerConfig({ orgId: 'org-a', environment: 'sandbox' });
    expect(cfg.clientId).toBe('client-A-sandbox');
    expect(cfg.environment).toBe('sandbox');
    expect(cfg.tokenUrl).toMatch(/^https?:\/\//);
    expect(cfg.fhirBase).toMatch(/^https?:\/\//);
    expect(cfg.kid).toBe('transtrack-epic-1');
  });

  it('different orgIds resolve to different clientIds', () => {
    process.env.EPIC_CLIENT_ID__ORG_A__SANDBOX = 'client-A';
    process.env.EPIC_PRIVATE_KEY_FILE__ORG_A__SANDBOX = 'C:/keys/orgA.pem';
    process.env.EPIC_CLIENT_ID__ORG_B__SANDBOX = 'client-B';
    process.env.EPIC_PRIVATE_KEY_FILE__ORG_B__SANDBOX = 'C:/keys/orgB.pem';
    const a = registry.getCustomerConfig({ orgId: 'org-a' });
    const b = registry.getCustomerConfig({ orgId: 'org-b' });
    expect(a.clientId).toBe('client-A');
    expect(b.clientId).toBe('client-B');
  });

  it('env=prod resolves separately from env=sandbox', () => {
    process.env.EPIC_CLIENT_ID__ORG_A__SANDBOX = 'sb';
    process.env.EPIC_PRIVATE_KEY_FILE__ORG_A__SANDBOX = 'C:/keys/sb.pem';
    process.env.EPIC_CLIENT_ID__ORG_A__PROD = 'pr';
    process.env.EPIC_PRIVATE_KEY_FILE__ORG_A__PROD = 'C:/keys/pr.pem';
    const sb = registry.getCustomerConfig({ orgId: 'org-a', environment: 'sandbox' });
    const pr = registry.getCustomerConfig({ orgId: 'org-a', environment: 'prod' });
    expect(sb.clientId).toBe('sb');
    expect(pr.clientId).toBe('pr');
    expect(sb.environment).toBe('sandbox');
    expect(pr.environment).toBe('prod');
  });

  it('falls back to single-tenant generic env vars', () => {
    process.env.EPIC_CLIENT_ID = 'generic-client';
    process.env.EPIC_PRIVATE_KEY_FILE = 'C:/keys/generic.pem';
    const cfg = registry.getCustomerConfig({ orgId: 'whatever' });
    expect(cfg.clientId).toBe('generic-client');
  });

  it('per-customer env var overrides generic fallback', () => {
    process.env.EPIC_CLIENT_ID = 'generic';
    process.env.EPIC_PRIVATE_KEY_FILE = 'C:/keys/generic.pem';
    process.env.EPIC_CLIENT_ID__ORG_A__SANDBOX = 'specific';
    const cfg = registry.getCustomerConfig({ orgId: 'org-a' });
    expect(cfg.clientId).toBe('specific');
  });

  it('orgId with non-alphanumeric characters is normalised', () => {
    process.env['EPIC_CLIENT_ID__ORG_A_2_3__SANDBOX'] = 'normalised';
    process.env['EPIC_PRIVATE_KEY_FILE__ORG_A_2_3__SANDBOX'] = 'C:/keys/n.pem';
    const cfg = registry.getCustomerConfig({ orgId: 'org-a.2-3' });
    expect(cfg.clientId).toBe('normalised');
  });
});

describe('getCustomerConfig — JSON file resolution', () => {
  it('resolves from a config file', () => {
    const file = path.join(tmpdir, 'epic.json');
    writeFileSync(file, JSON.stringify({
      customers: {
        'org-a': {
          sandbox: {
            clientId: 'file-A-sb',
            tokenUrl: 'https://file/sb/token',
            fhirBase: 'https://file/sb/fhir',
            privateKeyFile: 'C:/keys/orgA-sb.pem',
            kid: 'orgA-key-1',
          },
          prod: {
            clientId: 'file-A-pr',
            privateKeyFile: 'C:/keys/orgA-pr.pem',
          },
        },
      },
    }));
    process.env.EPIC_CUSTOMERS_CONFIG = file;
    const sb = registry.getCustomerConfig({ orgId: 'org-a', environment: 'sandbox' });
    const pr = registry.getCustomerConfig({ orgId: 'org-a', environment: 'prod' });
    expect(sb.clientId).toBe('file-A-sb');
    expect(sb.tokenUrl).toBe('https://file/sb/token');
    expect(sb.kid).toBe('orgA-key-1');
    expect(pr.clientId).toBe('file-A-pr');
  });

  it('env var beats file entry for the same key', () => {
    const file = path.join(tmpdir, 'epic.json');
    writeFileSync(file, JSON.stringify({
      customers: { 'org-a': { sandbox: {
        clientId: 'file-A',
        privateKeyFile: 'C:/keys/file.pem',
      } } },
    }));
    process.env.EPIC_CUSTOMERS_CONFIG = file;
    process.env.EPIC_CLIENT_ID__ORG_A__SANDBOX = 'env-A';
    const cfg = registry.getCustomerConfig({ orgId: 'org-a' });
    expect(cfg.clientId).toBe('env-A');
  });

  it('throws if file is unreadable', () => {
    process.env.EPIC_CUSTOMERS_CONFIG = path.join(tmpdir, 'does-not-exist.json');
    expect(() => registry.getCustomerConfig({ orgId: 'org-a' })).toThrow(/failed to load/);
  });
});

describe('listConfiguredCustomers', () => {
  it('returns empty when nothing configured', () => {
    expect(registry.listConfiguredCustomers()).toEqual([]);
  });

  it('lists env-configured customers', () => {
    process.env.EPIC_CLIENT_ID__ORG_A__SANDBOX = 'A';
    process.env.EPIC_PRIVATE_KEY_FILE__ORG_A__SANDBOX = 'p';
    process.env.EPIC_CLIENT_ID__ORG_B__PROD = 'B';
    process.env.EPIC_PRIVATE_KEY_FILE__ORG_B__PROD = 'p';
    const list = registry.listConfiguredCustomers();
    expect(list.length).toBe(2);
  });
});
