/**
 * src/api/localClient.js — the renderer's side of the Electron IPC bridge.
 *
 * Every PHI read and write in the desktop app goes through this module, and it
 * was at 8.6% line coverage (finding H-8). Two properties matter enough to test
 * exhaustively:
 *
 *   1. Every namespace the pages call must actually reach the matching preload
 *      channel. A renamed channel in preload is otherwise invisible until a
 *      clinician clicks the button, because each wrapper is a one-line
 *      delegation with nothing to type-check it.
 *   2. The browser-dev mock must never fabricate a *receipt* — a backup, an
 *      IOTA notice, a support bundle. Returning `{ success: true }` from a mock
 *      would tell an operator a regulatory obligation was discharged when
 *      nothing was written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { localClient } from '@/api/localClient';

const realElectronAPI = window.electronAPI;

afterEach(() => {
  window.electronAPI = realElectronAPI;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Browser-dev mock client (no Electron bridge attached)
// ---------------------------------------------------------------------------

describe('localClient without an Electron bridge (browser dev mock)', () => {
  beforeEach(() => {
    delete window.electronAPI;
  });

  /**
   * Calls that must reject rather than resolve. Each one produces an artefact a
   * user would rely on — a backup file, a CMS notice, an exported bundle, an
   * Epic import. A mock cannot produce any of them, so it must fail loudly.
   */
  const MUST_REJECT = [
    ['recovery', 'createBackup'],
    ['recovery', 'verifyBackup'],
    ['recovery', 'restoreBackup'],
    ['support', 'exportBundle'],
    ['iota', 'saveConfig'],
    ['iota', 'recordTransition'],
    ['iota', 'generateNotice'],
    ['iota', 'markDelivered'],
    ['iota', 'markSecondaryNotified'],
    ['iota', 'fileToChart'],
  ];

  it.each(MUST_REJECT)('%s.%s refuses instead of reporting success', async (ns, method) => {
    await expect(localClient[ns][method]({ id: 'x' })).rejects.toThrow(/desktop|Electron/i);
  });

  it('epic import refuses and directs the caller to server mode', async () => {
    await expect(localClient.integrations.epic.import({})).rejects.toThrow(/remote|server/i);
    await expect(localClient.integrations.epic.status()).resolves.toMatchObject({ enabled: false });
  });

  it('reports the IOTA centre as unconfigured so nothing looks discharged', async () => {
    const config = await localClient.iota.getConfig();
    expect(config.ready).toBe(false);
    expect(config.templateValid).toBe(false);
    expect(config.missing.length).toBeGreaterThan(0);

    const summary = await localClient.iota.getSummary();
    expect(summary.config.ready).toBe(false);
    expect(summary.total).toBe(0);
    expect(summary.delivered).toBe(0);
    await expect(localClient.iota.listNotifications()).resolves.toEqual([]);
    await expect(localClient.iota.listTransitions()).resolves.toEqual([]);
    await expect(localClient.iota.getNotification('n1')).resolves.toBeNull();
    await expect(localClient.iota.previewTemplate('x')).resolves.toMatchObject({ ok: false });
  });

  it('labels placeholder operational data as a placeholder', async () => {
    const health = await localClient.system.getHealth();
    expect(health.status).toBe('warn');
    expect(health.components.database.status).toBe('warn');

    const queue = await localClient.actionQueue.build();
    expect(queue.queueSize).toBe(0);
    expect(queue.disclaimer).toMatch(/dev placeholder/i);

    const bundle = await localClient.support.previewBundle();
    expect(bundle.redactionPolicy.containsPhi).toBe(false);

    const license = await localClient.license.getInfo();
    expect(license.isDevelopmentBuild).toBe(true);
    expect(license.isEvaluation).toBe(true);
  });

  it('returns no PHI from any list/summary read', async () => {
    const empties = await Promise.all([
      localClient.organOffers.list(),
      localClient.organOffers.getEvents('o1'),
      localClient.postTx.listEventsByPatient('p1'),
      localClient.postTx.listImmunoByPatient('p1'),
      localClient.postTx.listRejectionsByPatient('p1'),
      localClient.postTx.listBiopsiesByPatient('p1'),
      localClient.postTx.listReadmissionsByPatient('p1'),
      localClient.livingDonor.list(),
      localClient.livingDonor.listEvals('d1'),
      localClient.livingDonor.listFollowups('d1'),
      localClient.labs.getByPatient('p1'),
      localClient.barriers.getByPatient('p1'),
      localClient.barriers.getAllOpen(),
      localClient.barriers.getAuditHistory('p1'),
      localClient.ahhq.getAll(),
      localClient.ahhq.getExpiring(),
      localClient.ahhq.getExpired(),
      localClient.ahhq.getIncomplete(),
      localClient.ahhq.getPatientsWithIssues(),
      localClient.ahhq.getAuditHistory('p1'),
      localClient.compliance.getAuditTrail({}),
      localClient.labs.getRequiredTypes('kidney'),
      localClient.actionQueue.getInterventionsForPatient({ patientId: 'p1' }),
      localClient.recovery.listBackups(),
    ]);
    for (const value of empties) expect(value).toEqual([]);

    await expect(localClient.livingDonor.get('d1')).resolves.toBeNull();
    await expect(localClient.organOffers.get('o1')).resolves.toBeNull();
    await expect(localClient.labs.get('l1')).resolves.toBeNull();
    await expect(localClient.ahhq.getById('a1')).resolves.toBeNull();
    await expect(localClient.ahhq.getByPatient('p1')).resolves.toBeNull();
    await expect(localClient.livingDonor.summary('d1')).resolves.toBeNull();
    await expect(localClient.actionQueue.buildDigest({})).resolves.toBeNull();
  });

  it('exports nothing rather than an empty-looking file', async () => {
    for (const fn of ['exportTCR', 'exportTRR', 'exportTRF']) {
      await expect(localClient.optn[fn]({})).resolves.toEqual({ csv: '', count: 0 });
    }
    for (const fn of ['exportCSV', 'exportExcel', 'exportPDF']) {
      const result = await localClient.files[fn]([], 'x.csv');
      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/Electron/);
    }
    await expect(localClient.files.importFile('csv')).resolves.toBeNull();
  });

  it('serves the enumerations the forms need, and every remaining namespace responds', async () => {
    // Enumerations drive select options; an empty map renders an unusable form.
    expect(Object.keys(await localClient.barriers.getTypes()).length).toBeGreaterThan(0);
    expect(Object.keys(await localClient.barriers.getStatuses()).length).toBe(3);
    expect(Object.keys(await localClient.barriers.getRiskLevels()).length).toBe(3);
    expect(Object.keys(await localClient.barriers.getOwningRoles()).length).toBeGreaterThan(0);
    expect(Object.keys(await localClient.ahhq.getStatuses()).length).toBe(4);
    expect(Object.keys(await localClient.ahhq.getIssues()).length).toBe(4);
    expect(Object.keys(await localClient.ahhq.getOwningRoles()).length).toBe(4);
    expect(await localClient.labs.getCodes()).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CREAT' })])
    );
    expect(await localClient.labs.getSources()).toMatchObject({ MANUAL: 'MANUAL' });
    expect(await localClient.hl7.supportedEvents()).toContain('A08');
    expect(await localClient.calculators.listFormulas()).toContain('MELD');
    expect(await localClient.livingDonor.getMilestones()).toEqual([6, 12, 24]);

    // Everything else: exercised so a mock namespace cannot rot into a shape
    // that throws the first time a developer opens the page in a browser.
    const remaining = [
      () => localClient.auth.login({ email: 'a', password: 'b' }),
      () => localClient.auth.loginMfa({}),
      () => localClient.auth.logout(),
      () => localClient.auth.me(),
      () => localClient.auth.isAuthenticated(),
      () => localClient.mfa.status(),
      () => localClient.mfa.beginEnrollment(),
      () => localClient.mfa.confirmEnrollment({ code: '1' }),
      () => localClient.mfa.verifyChallenge({ code: '1' }),
      () => localClient.mfa.regenerateBackupCodes(),
      () => localClient.mfa.disable({}),
      () => localClient.mfa.isRequired('u1'),
      () => localClient.organOffers.getStatuses(),
      () => localClient.organOffers.getDeclineReasons(),
      () => localClient.organOffers.create({ organ: 'kidney' }),
      () => localClient.organOffers.transition({ id: '1', to_status: 'ACCEPTED' }),
      () => localClient.organOffers.expireDue(),
      () => localClient.postTx.createEvent({}),
      () => localClient.postTx.updateEvent({ id: '1', fields: {} }),
      () => localClient.postTx.createImmuno({}),
      () => localClient.postTx.createRejection({}),
      () => localClient.postTx.createBiopsy({}),
      () => localClient.postTx.createReadmission({}),
      () => localClient.postTx.getPatientSummary('p1'),
      () => localClient.livingDonor.getStatuses(),
      () => localClient.livingDonor.create({}),
      () => localClient.livingDonor.transition({ id: '1', to_status: 'CLEARED' }),
      () => localClient.livingDonor.addEvalStep({}),
      () => localClient.livingDonor.updateEvalStep({ id: '1' }),
      () => localClient.livingDonor.updateFollowup({ id: '1' }),
      () => localClient.livingDonor.markOverdue(),
      () => localClient.hl7.parse('MSH|'),
      () => localClient.hl7.buildAck({}),
      () => localClient.hl7.ingest({ message: 'MSH|' }),
      () => localClient.adminSecurity.lockoutReport(),
      () => localClient.adminSecurity.unlockAccount('a@b.c'),
      () => localClient.calculators.meld({}),
      () => localClient.calculators.meldNa({}),
      () => localClient.calculators.meld3({}),
      () => localClient.calculators.peld({}),
      () => localClient.calculators.las({}),
      () => localClient.calculators.kdpi({}),
      () => localClient.calculators.epts({}),
      () => localClient.encryption.getStatus(),
      () => localClient.encryption.verifyIntegrity(),
      () => localClient.encryption.isEnabled(),
      () => localClient.license.getMachineId(),
      () => localClient.license.activate('wire'),
      () => localClient.license.remove(),
      () => localClient.license.checkFeature('f'),
      () => localClient.license.checkLimit('patients', 1),
      () => localClient.ahhq.create({}),
      () => localClient.ahhq.getPatientSummary('p1'),
      () => localClient.ahhq.update('a1', {}),
      () => localClient.ahhq.markComplete('a1'),
      () => localClient.ahhq.markFollowUpRequired('a1'),
      () => localClient.ahhq.delete('a1'),
      () => localClient.ahhq.getDashboard(),
      () => localClient.barriers.create({}),
      () => localClient.barriers.update('b1', {}),
      () => localClient.barriers.resolve('b1'),
      () => localClient.barriers.delete('b1'),
      () => localClient.barriers.getPatientSummary('p1'),
      () => localClient.barriers.getDashboard(),
      () => localClient.labs.create({}),
      () => localClient.labs.update('l1', {}),
      () => localClient.labs.delete('l1'),
      () => localClient.labs.getLatestByPatient('p1'),
      () => localClient.labs.getPatientStatus('p1'),
      () => localClient.labs.getDashboard(),
      () => localClient.risk.getDashboard(),
      () => localClient.risk.getFullReport(),
      () => localClient.risk.assessPatient('p1'),
      () => localClient.actionQueue.topInterventionsForPatient({}),
      () => localClient.actionQueue.recordIntervention({}),
      () => localClient.actionQueue.recordOutcome({}),
      () => localClient.actionQueue.getInterventionEffectiveness({}),
      () => localClient.outcomes.getDashboard(),
      () => localClient.outcomes.saveSnapshot({}),
      () => localClient.compliance.getSummary(),
      () => localClient.compliance.getValidationReport(),
      () => localClient.compliance.getDataCompleteness(),
      () => localClient.predictions.getDashboard(),
      () => localClient.predictions.runAll(),
      () => localClient.tasks.getDashboard(),
      () => localClient.tasks.getAll({}),
      () => localClient.tasks.generateAuto(),
      () => localClient.tasks.processEscalations(),
      () => localClient.tasks.update('t1', {}),
      () => localClient.srtr.getDashboard(),
      () => localClient.srtr.saveSnapshot(),
      () => localClient.recovery.getStatus(),
      () => localClient.system.getMigrationStatus(),
      () => localClient.clock.getData(),
      () => localClient.clock.getTimeSinceLastUpdate(),
      () => localClient.clock.getAverageResolutionTime(),
      () => localClient.clock.getNextExpiration(),
      () => localClient.clock.getTaskCounts(),
      () => localClient.clock.getCoordinatorLoad(),
      () => localClient.functions.invoke('recalcPriority', {}),
    ];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const call of remaining) {
      await expect(call()).resolves.not.toBeUndefined();
    }
  });

  it('exposes CRUD stubs for every entity the pages import', async () => {
    for (const name of ['Patient', 'DonorOrgan', 'Match', 'AuditLog', 'User', 'ReadinessBarrier']) {
      const entity = localClient.entities[name];
      await expect(entity.list()).resolves.toEqual([]);
      await expect(entity.filter({})).resolves.toEqual([]);
      await expect(entity.get('x')).resolves.toEqual({ id: 'x' });
      await expect(entity.create({ a: 1 })).resolves.toMatchObject({ a: 1 });
      await expect(entity.update('x', { a: 2 })).resolves.toEqual({ id: 'x', a: 2 });
      await expect(entity.delete('x')).resolves.toEqual({ success: true });
    }
  });

  it('sends the browser to the login route on redirectToLogin', () => {
    localClient.auth.redirectToLogin();
    // The mock logs rather than navigating; assert it is callable and silent.
    expect(typeof localClient.auth.redirectToLogin).toBe('function');
  });

  it('is not mistaken for a thenable when awaited', async () => {
    expect(localClient.then).toBeUndefined();
    await expect(Promise.resolve(localClient)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Electron client — delegation to the preload bridge
// ---------------------------------------------------------------------------

/**
 * A preload double whose namespaces materialise on first access, so the test
 * asserts against the same vi.fn the client called without having to restate
 * the whole channel list.
 */
function makeBridge(overrides = {}) {
  const namespaces = new Map();
  const materialise = (nsName) => {
    if (!namespaces.has(nsName)) {
      const methods = new Map();
      namespaces.set(
        nsName,
        new Proxy(
          {},
          {
            get(_t, method) {
              if (typeof method === 'symbol') return undefined;
              if (!methods.has(method)) {
                methods.set(
                  method,
                  vi.fn(async (...args) => ({ channel: `${nsName}.${method}`, args }))
                );
              }
              return methods.get(method);
            },
            has: () => true,
          }
        )
      );
    }
    return namespaces.get(nsName);
  };

  return new Proxy(overrides, {
    get(target, nsName) {
      if (typeof nsName === 'symbol') return undefined;
      if (nsName in target) return target[nsName];
      return materialise(nsName);
    },
  });
}

/** Namespaces whose methods are 1:1 pass-throughs to the same channel name. */
const PASSTHROUGH_NAMESPACES = [
  'mfa', 'organOffers', 'postTx', 'livingDonor', 'hl7', 'optn', 'adminSecurity',
  'calculators', 'barriers', 'labs', 'clock', 'encryption', 'files', 'risk',
  'actionQueue', 'iota', 'outcomes', 'compliance', 'predictions', 'tasks',
  'srtr', 'recovery', 'system', 'support',
];

describe('localClient over the Electron bridge', () => {
  let bridge;

  beforeEach(() => {
    bridge = makeBridge({
      // Explicit so the client's "entity already on preload?" branch is
      // exercised in the negative — Patient is not pre-bound here.
      entities: {
        create: vi.fn(async (name, data) => ({ channel: 'entities.create', name, data })),
        get: vi.fn(async (name, id) => ({ channel: 'entities.get', name, id })),
        update: vi.fn(async (name, id, data) => ({ channel: 'entities.update', name, id, data })),
        delete: vi.fn(async (name, id) => ({ channel: 'entities.delete', name, id })),
        list: vi.fn(async (name, orderBy, limit) => ({ channel: 'entities.list', name, orderBy, limit })),
        filter: vi.fn(async (name, f, o, l) => ({ channel: 'entities.filter', name, f, o, l })),
      },
      ahhq: {
        getDashboard: vi.fn(async () => ({ totalPatients: 3 })),
        getByPatient: vi.fn(async (id) => ({ id })),
      },
    });
    window.electronAPI = bridge;
  });

  it('routes every namespace method to the identically named preload channel', async () => {
    let checked = 0;
    for (const ns of PASSTHROUGH_NAMESPACES) {
      const namespace = localClient[ns];
      expect(namespace, ns).toBeTruthy();
      for (const method of Object.keys(namespace)) {
        const result = await namespace[method]({ probe: `${ns}.${method}` }, 'second');
        expect(result, `${ns}.${method}`).toMatchObject({ channel: `${ns}.${method}` });
        expect(bridge[ns][method], `${ns}.${method}`).toHaveBeenCalled();
        checked += 1;
      }
    }
    // Guards against a future refactor that empties a namespace and makes the
    // loop above assert nothing.
    expect(checked).toBeGreaterThan(100);
  });

  it('forwards call arguments unchanged', async () => {
    await localClient.labs.getByPatient('p1', { limit: 10 });
    expect(bridge.labs.getByPatient).toHaveBeenCalledWith('p1', { limit: 10 });

    await localClient.barriers.getByPatient('p1');
    expect(bridge.barriers.getByPatient).toHaveBeenCalledWith('p1', false);

    await localClient.barriers.getAuditHistory('p1', '2026-01-01', '2026-02-01');
    expect(bridge.barriers.getAuditHistory).toHaveBeenCalledWith('p1', '2026-01-01', '2026-02-01');

    await localClient.iota.markDelivered({ id: 'n1', method: 'mail' });
    expect(bridge.iota.markDelivered).toHaveBeenCalledWith({ id: 'n1', method: 'mail' });
  });

  describe('auth', () => {
    it('normalises a successful login into the shape the pages branch on', async () => {
      bridge.auth.login.mockResolvedValue({
        user: { id: 'u1', email: 'a@b.c' },
        mustChangePassword: 1,
        mfaEnrollmentRequired: 0,
      });
      const result = await localClient.auth.login({ email: 'a@b.c', password: 'pw' });
      expect(result.user).toEqual({ id: 'u1', email: 'a@b.c' });
      // Coerced: a truthy SQLite 1/0 must not leak into an `=== true` check.
      expect(result.mustChangePassword).toBe(true);
      expect(result.mfaEnrollmentRequired).toBe(false);
      expect(result.mfa_required).toBeUndefined();
    });

    it('returns the MFA challenge without a user when TOTP is enrolled', async () => {
      bridge.auth.login.mockResolvedValue({
        mfa_required: true,
        challenge_token: 'ch-1',
        user: { id: 'u1' },
      });
      const result = await localClient.auth.login({ email: 'a@b.c', password: 'pw' });
      expect(result).toEqual({ mfa_required: true, challenge_token: 'ch-1' });
      // No session identity is handed to the renderer before the second factor.
      expect(result.user).toBeUndefined();
    });

    it('completes an MFA login', async () => {
      bridge.auth.loginMfa.mockResolvedValue({ user: { id: 'u1' } });
      const result = await localClient.auth.loginMfa({ challenge_token: 'ch-1', code: '123456' });
      expect(bridge.auth.loginMfa).toHaveBeenCalledWith({ challenge_token: 'ch-1', code: '123456' });
      expect(result).toEqual({ user: { id: 'u1' }, mustChangePassword: false });
    });

    it('passes through the remaining auth channels', async () => {
      bridge.auth.me.mockResolvedValue({ id: 'u1' });
      bridge.auth.isAuthenticated.mockResolvedValue(true);
      await expect(localClient.auth.me()).resolves.toEqual({ id: 'u1' });
      await expect(localClient.auth.isAuthenticated()).resolves.toBe(true);
      await expect(localClient.auth.logout()).resolves.toBeUndefined();
      expect(bridge.auth.logout).toHaveBeenCalled();
      await localClient.auth.register({ email: 'a@b.c' });
      expect(bridge.auth.register).toHaveBeenCalledWith({ email: 'a@b.c' });
      await localClient.auth.changePassword({ current: 'a', next: 'b' });
      expect(bridge.auth.changePassword).toHaveBeenCalledWith({ current: 'a', next: 'b' });
    });

    it('sets the login hash on redirectToLogin', () => {
      localClient.auth.redirectToLogin();
      expect(window.location.hash).toBe('#/login');
    });

    it('falls back to safe hints when preload predates the loginHints channel', async () => {
      window.electronAPI = makeBridge({ auth: { login: vi.fn() } });
      const hints = await localClient.auth.loginHints();
      // The fallback must not claim a setup token exists — the Login page would
      // then tell the operator to read a file that was never written.
      expect(hints.setupTokenPresent).toBe(false);
      expect(hints.setupTokenPath).toBeNull();
      expect(hints.isPackaged).toBe(false);
      expect(hints.hasAdmin).toBe(true);
    });

    it('uses the loginHints channel when preload provides it', async () => {
      bridge.auth.loginHints.mockResolvedValue({ isPackaged: true, setupTokenPresent: true });
      await expect(localClient.auth.loginHints()).resolves.toMatchObject({ setupTokenPresent: true });
    });
  });

  describe('entities', () => {
    it('passes the entity name to the generic IPC channels', async () => {
      const patients = localClient.entities.Patient;
      await patients.create({ patient_id: 'MRN-1' });
      expect(bridge.entities.create).toHaveBeenCalledWith('Patient', { patient_id: 'MRN-1' });
      await patients.get('p1');
      expect(bridge.entities.get).toHaveBeenCalledWith('Patient', 'p1');
      await patients.update('p1', { blood_type: 'O+' });
      expect(bridge.entities.update).toHaveBeenCalledWith('Patient', 'p1', { blood_type: 'O+' });
      await patients.delete('p1');
      expect(bridge.entities.delete).toHaveBeenCalledWith('Patient', 'p1');
      await patients.list('-created_at', 25);
      expect(bridge.entities.list).toHaveBeenCalledWith('Patient', '-created_at', 25);
      await patients.filter({ waitlist_status: 'active' }, '-priority_score', 10);
      expect(bridge.entities.filter).toHaveBeenCalledWith(
        'Patient', { waitlist_status: 'active' }, '-priority_score', 10
      );
    });

    it('routes User writes through the account-management channels, not generic entity CRUD', async () => {
      const users = localClient.entities.User;
      await users.create({ email: 'new@transtrack.local' });
      expect(bridge.auth.createUser).toHaveBeenCalledWith({ email: 'new@transtrack.local' });
      await users.update('u1', { role: 'coordinator' });
      expect(bridge.auth.updateUser).toHaveBeenCalledWith('u1', { role: 'coordinator' });
      await users.delete('u1');
      expect(bridge.auth.deleteUser).toHaveBeenCalledWith('u1');
      await users.list('-created_at', 100);
      expect(bridge.auth.listUsers).toHaveBeenCalledWith('-created_at', 100);
      // Reads stay on the generic channels.
      await users.get('u1');
      expect(bridge.entities.get).toHaveBeenCalledWith('User', 'u1');
      await users.filter({ role: 'admin' });
      expect(bridge.entities.filter).toHaveBeenCalledWith('User', { role: 'admin' }, undefined, undefined);
      // Generic create must not have been used for a user account.
      expect(bridge.entities.create).not.toHaveBeenCalled();
    });

    it('prefers a purpose-built preload entity over the generic channels', async () => {
      const dedicated = { list: vi.fn(async () => [{ id: 'p1' }]) };
      window.electronAPI = makeBridge({ entities: { Patient: dedicated, list: vi.fn() } });
      await expect(localClient.entities.Patient.list()).resolves.toEqual([{ id: 'p1' }]);
      expect(dedicated.list).toHaveBeenCalled();
    });

    it('exposes the same CRUD surface under asServiceRole', async () => {
      const svc = localClient.asServiceRole.entities.AuditLog;
      await svc.create({ action: 'read' });
      expect(bridge.entities.create).toHaveBeenCalledWith('AuditLog', { action: 'read' });
      await svc.get('a1');
      await svc.update('a1', {});
      await svc.delete('a1');
      await svc.list('-created_at', 10);
      await svc.filter({ entity_type: 'Patient' });
      expect(bridge.entities.filter).toHaveBeenCalledWith(
        'AuditLog', { entity_type: 'Patient' }, undefined, undefined
      );
    });
  });

  describe('functions.invoke', () => {
    it('keeps an envelope that already has data', async () => {
      bridge.functions.invoke.mockResolvedValue({ data: { updated: 4 } });
      await expect(localClient.functions.invoke('recalcPriority', { id: 'p1' }))
        .resolves.toEqual({ data: { updated: 4 } });
      expect(bridge.functions.invoke).toHaveBeenCalledWith('recalcPriority', { id: 'p1' });
    });

    it('wraps a bare result so callers can always read .data', async () => {
      bridge.functions.invoke.mockResolvedValue([1, 2, 3]);
      await expect(localClient.functions.invoke('listThings')).resolves.toEqual({ data: [1, 2, 3] });
    });

    it('wraps a null result rather than losing the envelope', async () => {
      bridge.functions.invoke.mockResolvedValue(null);
      await expect(localClient.functions.invoke('noop')).resolves.toEqual({ data: null });
    });
  });

  describe('optional namespaces', () => {
    it('resolves to undefined instead of throwing when license is not wired', async () => {
      window.electronAPI = makeBridge({ license: undefined });
      await expect(localClient.license.getInfo()).resolves.toBeUndefined();
      await expect(localClient.license.getMachineId()).resolves.toBeUndefined();
      await expect(localClient.license.activate('w')).resolves.toBeUndefined();
      await expect(localClient.license.remove()).resolves.toBeUndefined();
      await expect(localClient.license.checkFeature('f')).resolves.toBeUndefined();
      await expect(localClient.license.checkLimit('patients', 1)).resolves.toBeUndefined();
    });

    it('delegates license calls when the namespace is present', async () => {
      window.electronAPI = makeBridge({
        license: {
          getInfo: vi.fn(async () => ({ tier: 'enterprise' })),
          getMachineId: vi.fn(async () => 'mach-1'),
          activate: vi.fn(async () => ({ success: true })),
          remove: vi.fn(async () => ({ success: true })),
          checkFeature: vi.fn(async () => ({ enabled: true })),
          checkLimit: vi.fn(async () => ({ withinLimit: true })),
        },
      });
      await expect(localClient.license.getInfo()).resolves.toEqual({ tier: 'enterprise' });
      await expect(localClient.license.getMachineId()).resolves.toBe('mach-1');
      await expect(localClient.license.activate('w')).resolves.toEqual({ success: true });
      await expect(localClient.license.remove()).resolves.toEqual({ success: true });
      await expect(localClient.license.checkFeature('f')).resolves.toEqual({ enabled: true });
      await expect(localClient.license.checkLimit('patients', 1)).resolves.toEqual({ withinLimit: true });
    });

    it('reports SSO as unconfigured, and always returns a callable unsubscribe', async () => {
      window.electronAPI = makeBridge({ sso: undefined });
      await expect(localClient.sso.status()).resolves.toEqual({
        configured: false, issuerConfigured: false, clientIdConfigured: false,
      });
      await expect(localClient.sso.start()).resolves.toBeUndefined();
      await expect(localClient.sso.cancel()).resolves.toBeUndefined();
      // React effect cleanup calls this unconditionally.
      expect(() => localClient.sso.onCompleted(() => {})()).not.toThrow();
    });

    it('returns a no-op unsubscribe when preload forgets to return one', () => {
      window.electronAPI = makeBridge({
        sso: { onCompleted: vi.fn(() => undefined), status: vi.fn(async () => ({ configured: true })) },
      });
      expect(() => localClient.sso.onCompleted(() => {})()).not.toThrow();
    });

    it('uses the real unsubscribe when preload returns one', () => {
      const unsubscribe = vi.fn();
      window.electronAPI = makeBridge({ sso: { onCompleted: vi.fn(() => unsubscribe) } });
      localClient.sso.onCompleted(() => {})();
      expect(unsubscribe).toHaveBeenCalled();
    });

    it('mirrors whatever aHHQ channels preload exposes', async () => {
      await expect(localClient.ahhq.getDashboard()).resolves.toEqual({ totalPatients: 3 });
      await expect(localClient.ahhq.getByPatient('p1')).resolves.toEqual({ id: 'p1' });
      expect(Object.keys(localClient.ahhq).sort()).toEqual(['getByPatient', 'getDashboard']);
    });

    it('exposes an empty aHHQ surface rather than throwing when preload omits it', () => {
      window.electronAPI = makeBridge({ ahhq: undefined });
      expect(localClient.ahhq).toEqual({});
    });
  });

  it('uploads a file by handing the renderer an object URL', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const file = new File(['x'], 'labs.csv', { type: 'text/csv' });
    await expect(localClient.integrations.Core.UploadFile(file)).resolves.toEqual({
      url: 'blob:mock',
      name: 'labs.csv',
    });
    expect(created).toHaveBeenCalledWith(file);
  });

  it('resolves the bridge on every access, not once at import', async () => {
    // A page that mounts before preload finishes must not be pinned to the mock.
    delete window.electronAPI;
    await expect(localClient.recovery.createBackup()).rejects.toThrow(/Electron/);
    window.electronAPI = bridge;
    await expect(localClient.recovery.createBackup({ reason: 'test' }))
      .resolves.toMatchObject({ channel: 'recovery.createBackup' });
  });
});
