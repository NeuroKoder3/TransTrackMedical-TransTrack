/**
 * src/api/remoteClient.js — the HTTP client used when the renderer is pointed
 * at a TransTrack API server instead of local SQLite.
 *
 * It was at 5.3% line coverage (finding H-8) despite owning three things that
 * fail quietly and dangerously: where the access token is kept, what happens to
 * an in-flight PHI request when the token expires mid-shift, and which entities
 * are allowed to fall back to browser storage. A regression in the last one
 * would put clinical configuration in sessionStorage on a shared workstation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRemoteClient,
  isRemoteEnabled,
  resolveBaseUrl,
} from '@/api/remoteClient';

const BASE = 'https://api.transtrack.example';

/** Minimal fetch Response double. */
function reply(body, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => {
      if (body === undefined) throw new Error('not json');
      return body;
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

let fetchMock;

beforeEach(() => {
  window.transtrackConfig = { apiBaseUrl: BASE };
  window.__transtrackAccess = null;
  sessionStorage.clear();
  localStorage.clear();
  fetchMock = vi.fn(async () => reply({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  // The access token lives in a module-level variable — one session per
  // renderer process — so it outlives an individual client instance and has to
  // be cleared between tests.
  createRemoteClient().tokens.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.transtrackConfig = { apiBaseUrl: null };
  window.__transtrackAccess = null;
  sessionStorage.clear();
});

/** Last URL fetch was called with. */
function lastUrl() {
  return fetchMock.mock.calls.at(-1)[0];
}
function lastInit() {
  return fetchMock.mock.calls.at(-1)[1];
}

describe('base URL resolution', () => {
  it('uses the preload-supplied base URL', () => {
    expect(resolveBaseUrl()).toBe(BASE);
    expect(isRemoteEnabled()).toBe(true);
  });

  it('is off unless a base URL is configured', () => {
    window.transtrackConfig = { apiBaseUrl: null };
    vi.stubEnv('VITE_TRANSTRACK_API_URL', '');
    expect(resolveBaseUrl()).toBeNull();
    expect(isRemoteEnabled()).toBe(false);
    expect(() => createRemoteClient()).toThrow(/No TRANSTRACK_API_URL/);
  });

  it('refuses a plaintext HTTP endpoint that is not loopback', () => {
    // PHI over cleartext to a remote host is not a configuration mistake we
    // tolerate; the client must decline rather than downgrade.
    window.transtrackConfig = { apiBaseUrl: 'http://ehr.hospital.example' };
    vi.stubEnv('VITE_TRANSTRACK_API_URL', '');
    expect(resolveBaseUrl()).toBeNull();
  });

  it('allows plaintext loopback for local development', () => {
    for (const url of ['http://localhost:8080', 'http://127.0.0.1:8080']) {
      window.transtrackConfig = { apiBaseUrl: url };
      expect(resolveBaseUrl()).toBe(url);
    }
  });

  it('rejects a non-HTTP scheme and unparseable garbage', () => {
    vi.stubEnv('VITE_TRANSTRACK_API_URL', '');
    for (const bad of ['file:///etc/passwd', 'not a url', '', '   ']) {
      window.transtrackConfig = { apiBaseUrl: bad };
      expect(resolveBaseUrl(), bad).toBeNull();
    }
  });

  it('tolerates a UTF-8 BOM and surrounding whitespace from a PowerShell-written .env', () => {
    window.transtrackConfig = { apiBaseUrl: null };
    vi.stubEnv('VITE_TRANSTRACK_API_URL', `\uFEFF  ${BASE}  `);
    expect(resolveBaseUrl()).toBe(BASE);
  });

  it('rewrites the legacy Vite proxy path to the real API origin', () => {
    window.transtrackConfig = { apiBaseUrl: null };
    vi.stubEnv('VITE_TRANSTRACK_API_URL', 'http://localhost:5173/__api');
    expect(resolveBaseUrl()).toBe('http://127.0.0.1:8080');
  });

  it('strips trailing slashes so paths do not double up', async () => {
    window.transtrackConfig = { apiBaseUrl: `${BASE}///` };
    const client = createRemoteClient();
    await client.auth.me();
    expect(lastUrl()).toBe(`${BASE}/auth/me`);
  });
});

describe('session tokens', () => {
  it('purges any legacy tokens left in localStorage by an older build', async () => {
    localStorage.setItem('transtrack:access', 'stale');
    localStorage.setItem('transtrack:refresh', 'stale');
    vi.resetModules();
    await import('@/api/remoteClient');
    expect(localStorage.getItem('transtrack:access')).toBeNull();
    expect(localStorage.getItem('transtrack:refresh')).toBeNull();
  });

  it('keeps the access token out of localStorage after login', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'tok-1', user: { id: 'u1' } }));
    const result = await client.auth.login({ email: 'a@b.c', password: 'pw' });

    expect(result.kind).toBe('session');
    await expect(client.auth.isAuthenticated()).resolves.toBe(true);
    expect(localStorage.getItem('transtrack:access')).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('tok-1');
  });

  it('sends the bearer token on subsequent calls', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'tok-1' }));
    await client.auth.login({ email: 'a@b.c', password: 'pw' });
    await client.auth.me();
    expect(lastInit().headers.authorization).toBe('Bearer tok-1');
    expect(lastInit().credentials).toBe('include');
  });

  it('does not send an authorization header before login', async () => {
    const client = createRemoteClient();
    await client.auth.me();
    expect(lastInit().headers.authorization).toBeUndefined();
  });

  it('stores the token from an MFA completion, not from the challenge', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'mfa_required', challengeId: 'ch-1' }));
    await client.auth.login({ email: 'a@b.c', password: 'pw' });
    await expect(client.auth.isAuthenticated()).resolves.toBe(false);

    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'tok-2' }));
    await client.auth.loginMfa({ challenge_token: 'ch-1', code: '123456' });
    expect(lastInit().body).toBe(JSON.stringify({ challengeId: 'ch-1', code: '123456' }));
    await expect(client.auth.isAuthenticated()).resolves.toBe(true);
  });

  it('prefers an explicit challengeId over the legacy challenge_token field', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 't' }));
    await client.auth.loginMfa({ challengeId: 'new', challenge_token: 'old', code: '1' });
    expect(lastInit().body).toContain('"challengeId":"new"');
  });

  it('clears the token on logout even when the server call fails', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'tok-1' }));
    await client.auth.login({ email: 'a@b.c', password: 'pw' });

    fetchMock.mockResolvedValueOnce(reply({ error: { message: 'boom' } }, { status: 500 }));
    await expect(client.auth.logout()).rejects.toThrow('boom');
    // The local session must not survive a failed logout.
    await expect(client.auth.isAuthenticated()).resolves.toBe(false);
  });

  it('clears the token on a clean logout', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'tok-1' }));
    await client.auth.login({ email: 'a@b.c', password: 'pw' });
    fetchMock.mockResolvedValueOnce(reply(null, { status: 204 }));
    await expect(client.auth.logout()).resolves.toEqual({ ok: true });
    await expect(client.auth.isAuthenticated()).resolves.toBe(false);
  });
});

describe('refresh on 401', () => {
  it('refreshes once and replays the original request', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'expired' }));
    await client.auth.login({ email: 'a@b.c', password: 'pw' });

    fetchMock
      .mockResolvedValueOnce(reply({ error: { message: 'expired' } }, { status: 401 }))
      .mockResolvedValueOnce(reply({ access: 'fresh' }))
      .mockResolvedValueOnce(reply([{ id: 'p1' }]));

    await expect(client.patients.list()).resolves.toEqual([{ id: 'p1' }]);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      `${BASE}/auth/login`,
      `${BASE}/patients?`,
      `${BASE}/auth/refresh`,
      `${BASE}/patients?`,
    ]);
    expect(lastInit().headers.authorization).toBe('Bearer fresh');
  });

  it('does not retry forever when the replay is also unauthorised', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'expired' }));
    await client.auth.login({ email: 'a@b.c', password: 'pw' });

    fetchMock
      .mockResolvedValueOnce(reply({ error: { message: 'nope' } }, { status: 401 }))
      .mockResolvedValueOnce(reply({ access: 'fresh' }))
      .mockResolvedValueOnce(reply({ error: { message: 'still nope' } }, { status: 401 }));

    await expect(client.auth.me()).rejects.toThrow('still nope');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('drops the session when the refresh endpoint rejects', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'expired' }));
    await client.auth.login({ email: 'a@b.c', password: 'pw' });

    fetchMock
      .mockResolvedValueOnce(reply({ error: { message: 'expired' } }, { status: 401 }))
      .mockResolvedValueOnce(reply({ error: { message: 'no refresh cookie' } }, { status: 401 }));

    await expect(client.auth.me()).rejects.toThrow('expired');
    await expect(client.auth.isAuthenticated()).resolves.toBe(false);
  });

  it('drops the session when the refresh call throws (server unreachable)', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ kind: 'session', access: 'expired' }));
    await client.auth.login({ email: 'a@b.c', password: 'pw' });

    fetchMock
      .mockResolvedValueOnce(reply({ error: { message: 'expired' } }, { status: 401 }))
      .mockRejectedValueOnce(new Error('network down'));

    await expect(client.auth.me()).rejects.toThrow('expired');
    await expect(client.auth.isAuthenticated()).resolves.toBe(false);
  });

  it('does not attempt a refresh for an anonymous 401', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ error: { message: 'bad credentials' } }, { status: 401 }));
    await expect(client.auth.login({ email: 'a@b.c', password: 'wrong' })).rejects.toThrow('bad credentials');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('response and error handling', () => {
  it('surfaces the server error message, status, code and details', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(
      reply(
        { error: { message: 'patient_id already on the waitlist', code: 'DUPLICATE', details: { field: 'patient_id' } } },
        { status: 409 }
      )
    );
    await expect(client.patients.create({ patient_id: 'MRN-1' })).rejects.toMatchObject({
      message: 'patient_id already on the waitlist',
      status: 409,
      code: 'DUPLICATE',
      details: { field: 'patient_id' },
    });
  });

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply(undefined, { status: 502, contentType: 'text/html' }));
    await expect(client.auth.me()).rejects.toMatchObject({ status: 502 });
  });

  it('returns null for 204 and raw text for a non-JSON body', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply(null, { status: 204 }));
    await expect(client.audit.verifyChain()).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(reply('patient_id,organ\nMRN-1,kidney', { contentType: 'text/csv' }));
    await expect(client.audit.list()).resolves.toBe('patient_id,organ\nMRN-1,kidney');
  });
});

describe('endpoint mapping', () => {
  /** [description, invocation, expected method, expected path] */
  const CASES = [
    ['patients.list', (c) => c.patients.list({ limit: '25' }), 'GET', '/patients?limit=25'],
    ['patients.get', (c) => c.patients.get('p1'), 'GET', '/patients/p1'],
    ['patients.create', (c) => c.patients.create({ a: 1 }), 'POST', '/patients'],
    ['patients.update', (c) => c.patients.update('p1', { a: 1 }), 'PATCH', '/patients/p1'],
    ['organOffers.list', (c) => c.organOffers.list({ status: 'PENDING' }), 'GET', '/organ-offers?status=PENDING'],
    ['organOffers.create', (c) => c.organOffers.create({ a: 1 }), 'POST', '/organ-offers'],
    ['organOffers.transition', (c) => c.organOffers.transition({ id: 'o1', action: 'accept', note: 'x' }), 'POST', '/organ-offers/o1/accept'],
    ['labs.listForPatient', (c) => c.labs.listForPatient('p1', { code: 'CREAT' }), 'GET', '/patients/p1/labs?code=CREAT'],
    ['labs.create', (c) => c.labs.create('p1', { code: 'CREAT' }), 'POST', '/patients/p1/labs'],
    ['hl7.list', (c) => c.hl7.list({ limit: '5' }), 'GET', '/hl7/messages?limit=5'],
    ['hl7.get', (c) => c.hl7.get('m1'), 'GET', '/hl7/messages/m1'],
    ['hl7.ingest', (c) => c.hl7.ingest({ message: 'MSH|' }), 'POST', '/hl7/ingest'],
    ['audit.list', (c) => c.audit.list({ limit: '5' }), 'GET', '/audit?limit=5'],
    ['audit.verifyChain', (c) => c.audit.verifyChain(), 'GET', '/audit/verify'],
    ['auth.changePassword', (c) => c.auth.changePassword({ currentPassword: 'a', newPassword: 'b' }), 'POST', '/auth/password/change'],
    ['mfa.beginEnrollment', (c) => c.mfa.beginEnrollment(), 'POST', '/auth/mfa/enroll/begin'],
    ['mfa.confirmEnrollment', (c) => c.mfa.confirmEnrollment({ code: '1' }), 'POST', '/auth/mfa/enroll/confirm'],
    ['integrations.epic.status', (c) => c.integrations.epic.status(), 'GET', '/integrations/epic/status'],
    ['integrations.epic.import', (c) => c.integrations.epic.import({ epicPatientId: 'e1' }), 'POST', '/integrations/epic/import'],
    ['calculators.meld', (c) => c.calculators.meld({ bilirubin: 2 }), 'POST', '/calculators/meld'],
    ['calculators.meldNa', (c) => c.calculators.meldNa({}), 'POST', '/calculators/meld-na'],
    ['calculators.meld3', (c) => c.calculators.meld3({}), 'POST', '/calculators/meld-3'],
    ['calculators.peld', (c) => c.calculators.peld({}), 'POST', '/calculators/peld'],
    ['calculators.las', (c) => c.calculators.las({}), 'POST', '/calculators/las'],
    ['calculators.kdpi', (c) => c.calculators.kdpi({}), 'POST', '/calculators/kdpi'],
    ['calculators.epts', (c) => c.calculators.epts({}), 'POST', '/calculators/epts'],
  ];

  it.each(CASES)('%s hits %s %s', async (_name, invoke, method, path) => {
    const client = createRemoteClient();
    await invoke(client);
    expect(lastUrl()).toBe(BASE + path);
    expect(lastInit().method).toBe(method);
  });

  it('sends the transition payload without the routing fields', async () => {
    const client = createRemoteClient();
    await client.organOffers.transition({ id: 'o1', action: 'decline', reason: 'DONOR_QUALITY' });
    expect(JSON.parse(lastInit().body)).toEqual({ reason: 'DONOR_QUALITY' });
  });

  it('accepts either naming for a password change', async () => {
    const client = createRemoteClient();
    await client.auth.changePassword({ current: 'old', next: 'new' });
    expect(JSON.parse(lastInit().body)).toEqual({ current: 'old', next: 'new' });
    await client.auth.changePassword({ currentPassword: 'old2', newPassword: 'new2' });
    expect(JSON.parse(lastInit().body)).toEqual({ current: 'old2', next: 'new2' });
  });

  it('unwraps the formula list', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply({ formulas: ['MELD', 'LAS'] }));
    await expect(client.calculators.listFormulas()).resolves.toEqual(['MELD', 'LAS']);
  });

  it('sends the login hash on redirectToLogin', () => {
    createRemoteClient().auth.redirectToLogin();
    expect(window.location.hash).toBe('#/login');
  });
});

describe('entity facade', () => {
  it('reads the waitlist from the patients endpoint and never trusts a non-array body', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply([{ id: 'p1' }]));
    await expect(client.entities.Patient.list('-priority_score', 10)).resolves.toEqual([{ id: 'p1' }]);
    expect(lastUrl()).toBe(`${BASE}/patients?limit=10`);

    fetchMock.mockResolvedValueOnce(reply({ error: null }));
    await expect(client.entities.Patient.list()).resolves.toEqual([]);
    expect(lastUrl()).toBe(`${BASE}/patients?limit=50`);
  });

  it('translates the UI filter names into query parameters and applies the rest client-side', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(
      reply([
        { id: 'p1', blood_type: 'O+', waitlist_status: 'active' },
        { id: 'p2', blood_type: 'A-', waitlist_status: 'active' },
      ])
    );
    const rows = await client.entities.Patient.filter(
      { waitlist_status: 'active', organ_needed: 'kidney', search: 'smith', blood_type: 'O+', notes: '' },
      '-priority_score',
      25
    );
    const url = new URL(lastUrl());
    expect(url.pathname).toBe('/patients');
    expect(url.searchParams.get('status')).toBe('active');
    expect(url.searchParams.get('organ')).toBe('kidney');
    expect(url.searchParams.get('search')).toBe('smith');
    expect(url.searchParams.get('limit')).toBe('25');
    // blood_type is not a server parameter, so it is enforced locally; an empty
    // filter value must not exclude every row.
    expect(rows).toEqual([{ id: 'p1', blood_type: 'O+', waitlist_status: 'active' }]);
  });

  it('supports patient get/create/update and refuses delete', async () => {
    const client = createRemoteClient();
    await client.entities.Patient.get('p1');
    expect(lastUrl()).toBe(`${BASE}/patients/p1`);
    await client.entities.Patient.create({ patient_id: 'MRN-2' });
    expect(lastInit().method).toBe('POST');
    await client.entities.Patient.update('p1', { blood_type: 'B+' });
    expect(lastInit().method).toBe('PATCH');
    // A waitlist record is a retained clinical record; the remote API has no
    // hard-delete and the client must not pretend otherwise.
    await expect(client.entities.Patient.delete('p1')).rejects.toThrow(/not available/i);
  });

  it('reads the audit log from /audit and tolerates both body shapes', async () => {
    const client = createRemoteClient();
    fetchMock.mockResolvedValueOnce(reply([{ id: 'a1' }]));
    await expect(client.entities.AuditLog.list()).resolves.toEqual([{ id: 'a1' }]);

    fetchMock.mockResolvedValueOnce(reply({ items: [{ id: 'a2' }] }));
    await expect(client.entities.AuditLog.list('-created_at', 10)).resolves.toEqual([{ id: 'a2' }]);

    fetchMock.mockResolvedValueOnce(reply({ items: [{ id: 'a3' }] }));
    await expect(client.entities.AuditLog.filter({ entity_id: 'p1' })).resolves.toEqual([{ id: 'a3' }]);
    expect(new URL(lastUrl()).searchParams.get('entityId')).toBe('p1');

    fetchMock.mockResolvedValueOnce(reply({}));
    await expect(client.entities.AuditLog.filter()).resolves.toEqual([]);
  });

  it('never writes to the audit log from the renderer', async () => {
    const client = createRemoteClient();
    // The chain is append-only in the server; a renderer-side create would be
    // an unauthenticated forgery vector, so it is a no-op.
    await expect(client.entities.AuditLog.create({ action: 'read' })).resolves.toEqual({});
    await expect(client.entities.AuditLog.update('a1', {})).resolves.toEqual({});
    await expect(client.entities.AuditLog.delete('a1')).resolves.toEqual({});
    await expect(client.entities.AuditLog.get('a1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps desktop config entities in session storage in a dev build', async () => {
    const client = createRemoteClient();
    const rules = client.entities.EHRValidationRule;
    const created = await rules.create({ field: 'blood_type', rule: 'required' });
    expect(created.id).toBeTruthy();
    expect(created.created_at).toBeTruthy();
    await expect(rules.list()).resolves.toHaveLength(1);
    await expect(rules.get(created.id)).resolves.toMatchObject({ field: 'blood_type' });
    await expect(rules.get('missing')).resolves.toBeNull();
    await expect(rules.filter({ field: 'blood_type', rule: '' })).resolves.toHaveLength(1);
    await expect(rules.filter({ field: 'other' })).resolves.toHaveLength(0);

    const updated = await rules.update(created.id, { rule: 'optional' });
    expect(updated.rule).toBe('optional');
    await expect(rules.update('missing', {})).rejects.toThrow(/not found/);

    await expect(rules.delete(created.id)).resolves.toEqual({ success: true });
    await expect(rules.list()).resolves.toEqual([]);
    // None of this touched the API.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('survives a corrupt session-storage payload instead of breaking the page', async () => {
    sessionStorage.setItem('transtrack:remote-entity:PriorityWeights', '{not json');
    const client = createRemoteClient();
    await expect(client.entities.PriorityWeights.list()).resolves.toEqual([]);
  });

  it('refuses to store clinical config in browser storage in a production build', async () => {
    vi.stubEnv('PROD', true);
    const client = createRemoteClient();
    for (const name of ['EHRIntegration', 'PriorityWeights', 'NotificationRule', 'DonorOrgan', 'Match']) {
      const entity = client.entities[name];
      for (const op of ['list', 'filter', 'get', 'create', 'update', 'delete']) {
        await expect(entity[op]('x', {}), `${name}.${op}`).rejects.toThrow(/disabled in production/);
      }
    }
  });

  it('refuses unsupported entity reads and writes loudly (H-14)', async () => {
    const client = createRemoteClient();
    const entity = client.entities.SomethingUnsupported;
    await expect(entity.list()).rejects.toThrow(/not available in remote API mode/);
    await expect(entity.filter({})).rejects.toThrow(/not available in remote API mode/);
    await expect(entity.get('x')).rejects.toThrow(/not available in remote API mode/);
    await expect(entity.create({})).rejects.toThrow(/not available in remote API mode/);
    await expect(entity.update('x', {})).rejects.toThrow(/not available in remote API mode/);
    await expect(entity.delete('x')).rejects.toThrow(/not available in remote API mode/);
  });

  it('ignores symbol property access on the entity proxy', () => {
    const client = createRemoteClient();
    expect(client.entities[Symbol.iterator]).toBeUndefined();
  });

  it('throws rather than silently succeeding for an IPC-only function (H-14)', async () => {
    const client = createRemoteClient();
    await expect(client.functions.invoke('recalculatePriority', { id: 'p1' }))
      .rejects.toThrow(/not available in remote API mode/);
  });
});

describe('desktop passthrough namespaces', () => {
  const NAMESPACES = [
    'actionQueue', 'recovery', 'risk', 'outcomes',
    'compliance', 'predictions', 'tasks', 'srtr', 'sso',
  ];

  afterEach(() => {
    delete window.electronAPI.__probe;
  });

  it('reaches the Electron bridge when it is present', async () => {
    const client = createRemoteClient();
    for (const ns of NAMESPACES) {
      const spy = vi.fn(async (...args) => ({ ns, args }));
      window.electronAPI[ns] = { probe: spy };
      await expect(client[ns].probe('a', 'b')).resolves.toEqual({ ns, args: ['a', 'b'] });
      expect(spy).toHaveBeenCalledWith('a', 'b');
      delete window.electronAPI[ns];
    }
  });

  it('fails with a diagnosable error when the desktop runtime is absent', async () => {
    const client = createRemoteClient();
    const saved = window.electronAPI;
    delete window.electronAPI;
    try {
      for (const ns of NAMESPACES) {
        await expect(client[ns].getDashboard(), ns).rejects.toThrow(
          new RegExp(`${ns}\\.getDashboard requires the TransTrack desktop runtime`)
        );
      }
    } finally {
      window.electronAPI = saved;
    }
  });

  it('ignores symbol access on a passthrough namespace', () => {
    const client = createRemoteClient();
    expect(client.recovery[Symbol.toStringTag]).toBeUndefined();
  });
});
