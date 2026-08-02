/**
 * H-3 / M-27 regression suite — HL7 dead-letter and sending-app tenancy.
 *
 * Before remediation an admin in org A could replay or discard org B's
 * quarantined PHI, list every tenant's sending-application mappings, delete
 * them, and create a mapping pointing at somebody else's org — and the two
 * tables carried no row-level security to stop any of it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadWithStubs, restoreModules, fakeApp, fakeClient, fakePool } from './helpers/routeHarness.mjs';

const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const DL_IN_ORG_B = 'dddddddd-3333-4333-8333-dddddddddddd';
const SENDING_APP_IN_ORG_B = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee';

const RAW_HL7 = [
  'MSH|^~\\&|EPIC|MERCY|TT|TT|20260101010101||ADT^A04|MSG00001|P|2.5',
  'PID|1||900001^^^EPIC^MR||DOE^JANE||19800101|F',
].join('\r');

/** A dead-letter table that behaves like PostgreSQL would with the predicates applied. */
function hl7Fixture() {
  return {
    dead_letters: [{
      id: DL_IN_ORG_B,
      org_id: ORG_B,
      raw_message: RAW_HL7,
      replay_status: 'pending',
      transport: 'mllp',
      peer_address: '10.0.0.9',
    }],
    sending_apps: [
      { id: SENDING_APP_IN_ORG_B, sending_app: 'EPIC', org_id: ORG_B, is_active: true },
    ],
  };
}

function hl7Client(db) {
  return fakeClient((text, values) => {
    if (/SELECT \* FROM hl7_dead_letters/.test(text)) {
      const [id, orgId] = values;
      return db.dead_letters.filter(
        (r) => r.id === id && r.org_id === orgId && r.replay_status === 'pending'
      );
    }
    if (/UPDATE hl7_dead_letters SET replay_status = 'discarded'/.test(text)) {
      const [id, orgId] = values;
      const hit = db.dead_letters.find(
        (r) => r.id === id && r.org_id === orgId && r.replay_status === 'pending'
      );
      if (!hit) return [];
      hit.replay_status = 'discarded';
      return [{ id: hit.id }];
    }
    if (/FROM hl7_sending_apps/.test(text)) {
      const [orgId] = values;
      return db.sending_apps.filter((r) => r.org_id === orgId);
    }
    if (/DELETE FROM hl7_sending_apps/.test(text)) {
      const [id, orgId] = values;
      const idx = db.sending_apps.findIndex((r) => r.id === id && r.org_id === orgId);
      if (idx < 0) return [];
      const [removed] = db.sending_apps.splice(idx, 1);
      return [{ id: removed.id }];
    }
    if (/INSERT INTO hl7_sending_apps/.test(text)) {
      const [sendingApp, orgId, description] = values;
      const row = { id: 'new-mapping', sending_app: sendingApp, org_id: orgId, description };
      db.sending_apps.push(row);
      return [row];
    }
    return [];
  });
}

describe('HL7 dead-letter and sending-app routes are tenant-scoped', () => {
  let app;
  let db;
  let client;
  let ingested;

  beforeEach(async () => {
    db = hl7Fixture();
    client = hl7Client(db);
    ingested = [];
    const routes = loadWithStubs('src/routes/hl7.js', {
      'src/db/pool.js': fakePool(client),
      'src/hl7/ingest.js': {
        ingest: async (args) => {
          ingested.push(args);
          return { hl7MessageId: 'msg-1', ackCode: 'AA', ackText: 'ok', processed: true };
        },
      },
      'src/services/vendorProfileService.js': { findFor: async () => null },
    });
    app = fakeApp();
    await routes(app);
  });

  afterEach(() => restoreModules());

  it('refuses to replay a dead letter belonging to another organisation', async () => {
    const result = await app.call('POST /hl7/dead-letters/:id/replay', {
      params: { id: DL_IN_ORG_B },
      auth: { orgId: ORG_A, role: 'admin', tokenType: 'jwt' },
    });
    expect(result).toEqual({ replayed: false, reason: 'not found or already processed' });
    // Nothing from org B was fed into org A's ingest pipeline.
    expect(ingested).toHaveLength(0);
    expect(db.dead_letters[0].replay_status).toBe('pending');
  });

  it('binds the caller organisation into the replay lookup', async () => {
    await app.call('POST /hl7/dead-letters/:id/replay', {
      params: { id: DL_IN_ORG_B },
      auth: { orgId: ORG_A, role: 'admin', tokenType: 'jwt' },
    });
    const select = client.queries.find((q) => /SELECT \* FROM hl7_dead_letters/.test(q.text));
    expect(select.text).toMatch(/org_id = \$2/);
    expect(select.values).toEqual([DL_IN_ORG_B, ORG_A]);
    expect(select.text).not.toContain(ORG_A);
  });

  it('replays a dead letter that does belong to the caller', async () => {
    const result = await app.call('POST /hl7/dead-letters/:id/replay', {
      params: { id: DL_IN_ORG_B },
      auth: { orgId: ORG_B, role: 'admin', tokenType: 'jwt' },
    });
    expect(result.replayed).toBe(true);
    expect(ingested).toHaveLength(1);
    expect(ingested[0].ctx.orgId).toBe(ORG_B);
  });

  it('refuses to discard another organisation dead letter', async () => {
    const result = await app.call('POST /hl7/dead-letters/:id/discard', {
      params: { id: DL_IN_ORG_B },
      auth: { orgId: ORG_A, role: 'admin', tokenType: 'jwt' },
    });
    expect(result).toEqual({ discarded: false });
    expect(db.dead_letters[0].replay_status).toBe('pending');
  });

  it('lists only the caller organisation sending-app mappings', async () => {
    const mine = await app.call('GET /hl7/sending-apps', {
      auth: { orgId: ORG_A, role: 'admin', tokenType: 'jwt' },
    });
    expect(mine).toEqual([]);
    const theirs = await app.call('GET /hl7/sending-apps', {
      auth: { orgId: ORG_B, role: 'admin', tokenType: 'jwt' },
    });
    expect(theirs).toHaveLength(1);
  });

  it('refuses to delete another organisation sending-app mapping', async () => {
    const result = await app.call('DELETE /hl7/sending-apps/:id', {
      params: { id: SENDING_APP_IN_ORG_B },
      auth: { orgId: ORG_A, role: 'admin', tokenType: 'jwt' },
    });
    expect(result).toEqual({ deleted: false });
    expect(db.sending_apps).toHaveLength(1);
  });

  it('refuses to create a sending-app mapping for another organisation', async () => {
    await expect(app.call('POST /hl7/sending-apps', {
      body: { sending_app: 'CERNER', org_id: ORG_B },
      auth: { orgId: ORG_A, role: 'admin', tokenType: 'jwt' },
    })).rejects.toMatchObject({ status: 403 });
    expect(db.sending_apps).toHaveLength(1);
  });

  it('always stores a new mapping against the caller organisation', async () => {
    const created = await app.call('POST /hl7/sending-apps', {
      body: { sending_app: 'CERNER' },
      auth: { orgId: ORG_A, role: 'admin', tokenType: 'jwt' },
    });
    expect(created.org_id).toBe(ORG_A);
  });
});

// ---------------------------------------------------------------------------
// The row-level-security backstop behind the application predicates
// ---------------------------------------------------------------------------

describe('migration 010 adds the missing row-level security', () => {
  const migrationsDir = path.resolve('src/db/migrations');
  const sql = fs.readFileSync(path.join(migrationsDir, '010_tenant_rls_hardening.sql'), 'utf8');

  for (const table of ['hl7_dead_letters', 'hl7_sending_apps', 'issued_licenses']) {
    it(`enables and forces row-level security on ${table}`, () => {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY tenant_isolation_${table} ON ${table}`);
    });
  }

  it('scopes the hl7 policies with app_current_org_id()', () => {
    expect(sql).toContain('USING (org_id = app_current_org_id())');
    expect(sql).toContain('WITH CHECK (org_id = app_current_org_id())');
  });

  it('attributes NULL-org dead letters to the reserved system organisation and forbids new ones', () => {
    expect(sql).toContain("SET org_id = '00000000-0000-0000-0000-000000000000'");
    expect(sql).toContain('WHERE org_id IS NULL');
    expect(sql).toContain('ALTER COLUMN org_id SET NOT NULL');
    // SET NULL is no longer a legal outcome once the column is NOT NULL.
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('limits the unscoped sending-app carve-out to SELECT', () => {
    const carveOut = sql.slice(sql.indexOf('CREATE POLICY mllp_routing_lookup_hl7_sending_apps'));
    expect(carveOut).toMatch(/FOR SELECT\s+USING \(app_current_org_id\(\) IS NULL\)/);
    expect(carveOut).not.toContain('WITH CHECK (app_current_org_id() IS NULL)');
  });

  it('is discovered by the migration runner, which applies files in name order', () => {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain('010_tenant_rls_hardening.sql');
    expect(files.indexOf('010_tenant_rls_hardening.sql'))
      .toBeGreaterThan(files.indexOf('008_hl7_production_hardening.sql'));
  });

  it('no longer claims 006 protects issued_licenses with row-level security', () => {
    const six = fs.readFileSync(path.join(migrationsDir, '006_issued_licenses.sql'), 'utf8');
    expect(six).not.toMatch(/protected by row-level security/);
    expect(six).toContain('010_tenant_rls_hardening.sql');
  });
});

// ---------------------------------------------------------------------------
// M-27 — unroutable MLLP traffic
// ---------------------------------------------------------------------------

describe('unroutable MLLP messages are quarantined against a real owner (M-27)', () => {
  let hl7Server;
  let client;
  const logged = [];

  beforeEach(() => {
    client = fakeClient(() => []);
    hl7Server = loadWithStubs('src/hl7/server.js', {
      'src/db/pool.js': fakePool(client),
      'src/hl7/ingest.js': { ingest: async () => ({ ackCode: 'AA' }) },
      'src/services/vendorProfileService.js': { findFor: async () => null },
    });
    logged.length = 0;
  });

  afterEach(() => restoreModules());

  it('never writes a dead letter with a NULL org_id', async () => {
    await hl7Server.quarantineDeadLetter({
      raw: RAW_HL7,
      parsed: { sending_app: 'UNKNOWN', sending_facility: 'X', message_control_id: 'MSG1' },
      peer: { address: '10.0.0.9' },
      logger: { error: (...a) => logged.push(a), warn: () => {} },
      reason: 'No org mapping for sending application',
    });
    const insert = client.queries.find((q) => /INSERT INTO hl7_dead_letters/.test(q.text));
    expect(insert).toBeDefined();
    expect(insert.text).toContain('org_id');
    expect(insert.values[0]).toBe('00000000-0000-0000-0000-000000000000');
    expect(insert.values[0]).not.toBeNull();
  });

  it('prefers a facility-qualified sending-app mapping over the bare application name', async () => {
    const rows = [
      { sending_app: 'EPIC', org_id: ORG_A },
      { sending_app: 'EPIC|MERCY', org_id: ORG_B },
    ];
    const lookupClient = fakeClient(() => rows);
    const mod = loadWithStubs('src/hl7/server.js', {
      'src/db/pool.js': fakePool(lookupClient),
      'src/hl7/ingest.js': { ingest: async () => ({}) },
      'src/services/vendorProfileService.js': { findFor: async () => null },
    });
    expect(await mod.resolveOrgFromSendingApp('EPIC', 'MERCY')).toBe(ORG_B);
    expect(await mod.resolveOrgFromSendingApp('EPIC', null)).toBe(ORG_A);
  });
});
