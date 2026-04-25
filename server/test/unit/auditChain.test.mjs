import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const audit = require('../../src/services/auditService');

function makeFakeClient() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT record_hash FROM audit_logs')) {
        const orgId = params[0];
        const filtered = rows.filter(r => r.org_id === orgId);
        const last = filtered[filtered.length - 1];
        return { rows: last ? [{ record_hash: last.record_hash }] : [] };
      }
      if (s.startsWith('SELECT id, prev_hash')) {
        return { rows: rows.filter(r => r.org_id === params[0]) };
      }
      if (s.startsWith('INSERT INTO audit_logs')) {
        const [
          orgId, action, entityType, entityId, patientName, details,
          userId, userEmail, userRole, ip, ua, prevHash, recordHash,
        ] = params;
        rows.push({
          id: 'r' + (rows.length + 1),
          org_id: orgId, action, entity_type: entityType, entity_id: entityId,
          patient_name: patientName,
          details: typeof details === 'string' ? JSON.parse(details) : details,
          user_id: userId, user_email: userEmail, user_role: userRole,
          ip_address: ip, user_agent: ua,
          prev_hash: prevHash, record_hash: recordHash,
        });
        return { rows: [] };
      }
      throw new Error('unexpected sql in fake: ' + s);
    },
  };
}

describe('audit hash chain', () => {
  it('chains records and verifies', async () => {
    const c = makeFakeClient();
    const ctx = { orgId: 'o1', userId: 'u1', userEmail: 'a@b', role: 'admin' };
    await audit.record(c, ctx, { action: 'patient.create', entityType: 'patient', entityId: 'p1' });
    await audit.record(c, ctx, { action: 'patient.update', entityType: 'patient', entityId: 'p1' });
    await audit.record(c, ctx, { action: 'organ_offer.accept', entityType: 'organ_offer', entityId: 'oo1' });
    expect(c.rows).toHaveLength(3);
    expect(c.rows[0].prev_hash).toBe('GENESIS');
    expect(c.rows[1].prev_hash).toBe(c.rows[0].record_hash);
    expect(c.rows[2].prev_hash).toBe(c.rows[1].record_hash);
    const v = await audit.verifyChain(c, 'o1');
    expect(v.ok).toBe(true);
  });

  it('detects tampering', async () => {
    const c = makeFakeClient();
    const ctx = { orgId: 'o1', userId: 'u1', userEmail: 'a@b', role: 'admin' };
    await audit.record(c, ctx, { action: 'a' });
    await audit.record(c, ctx, { action: 'b' });
    c.rows[0].action = 'EVIL';
    const v = await audit.verifyChain(c, 'o1');
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe('r1');
  });
});
