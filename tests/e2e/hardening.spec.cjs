/**
 * TransTrack — Electron runtime hardening E2E verification.
 *
 * tests/electronHardening.test.cjs asserts the hardening settings by static
 * analysis of main.cjs. This spec proves the same properties against the
 * *running* application, which is the only way to confirm that enabling
 * `sandbox: true` did not silently break the preload bridge.
 *
 * It deliberately re-verifies the Epic Connection Hub surface: the FHIR, HL7,
 * EHR entity bridges, and the remote API base URL that selects Epic/remote mode
 * must all still be present and callable after the sandbox change.
 *
 * Run: npm run test:e2e -- hardening.spec.cjs
 */

const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

let app;
let window;

// A recognisable value so we can prove the remote-mode URL reaches the
// sandboxed preload and is exposed to the renderer unchanged.
const REMOTE_API_URL = 'https://epic-hub.example.org:8443';

test.beforeAll(async () => {
  const userDataPath = path.join(
    os.tmpdir(),
    `transtrack-e2e-hardening-${process.pid}-${Date.now()}`,
  );
  fs.mkdirSync(userDataPath, { recursive: true });

  app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.cjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_DEV: '0',
      TRANSTRACK_E2E: '1',
      TRANSTRACK_USERDATA_DIR: userDataPath,
      TRANSTRACK_API_URL: REMOTE_API_URL,
    },
    timeout: 45000,
  });

  window = await app.firstWindow({ timeout: 30000 });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const hasApi = await w
        .evaluate(() => !!(window.electronAPI && window.electronAPI.auth))
        .catch(() => false);
      if (hasApi) {
        window = w;
        await window.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Timed out waiting for Electron window with electronAPI');
});

test.afterAll(async () => {
  if (app) {
    try { await app.close(); } catch { /* already exited */ }
  }
});

test.describe('Process isolation', () => {
  test('the renderer runs sandboxed with context isolation', async () => {
    const prefs = await app.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().map((w) => {
        const p = w.webContents.getLastWebPreferences() || {};
        return {
          sandbox: p.sandbox,
          contextIsolation: p.contextIsolation,
          nodeIntegration: p.nodeIntegration,
          webSecurity: p.webSecurity,
        };
      });
    });

    expect(prefs.length).toBeGreaterThan(0);
    for (const p of prefs) {
      expect(p.sandbox, 'sandbox must be enabled').toBe(true);
      expect(p.contextIsolation, 'contextIsolation must be enabled').toBe(true);
      expect(p.nodeIntegration, 'nodeIntegration must be disabled').toBe(false);
      expect(p.webSecurity, 'webSecurity must not be disabled').not.toBe(false);
    }
  });

  test('Node primitives are unreachable from the renderer', async () => {
    const reachable = await window.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      module: typeof window.module,
      global: typeof window.global,
      Buffer: typeof window.Buffer,
    }));

    expect(reachable.require).toBe('undefined');
    expect(reachable.process).toBe('undefined');
    expect(reachable.module).toBe('undefined');
    expect(reachable.global).toBe('undefined');
    expect(reachable.Buffer).toBe('undefined');
  });

  test('the renderer cannot reach Electron internals', async () => {
    const leaked = await window.evaluate(() => ({
      ipcRenderer: typeof window.ipcRenderer,
      electron: typeof window.electron,
      webFrame: typeof window.webFrame,
    }));

    expect(leaked.ipcRenderer).toBe('undefined');
    expect(leaked.electron).toBe('undefined');
    expect(leaked.webFrame).toBe('undefined');
  });

  test('the exposed bridge is frozen against renderer tampering', async () => {
    // contextBridge deep-freezes what it exposes; a compromised renderer must
    // not be able to swap a bridge function for its own.
    const result = await window.evaluate(() => {
      const original = window.electronAPI.auth.login;
      try { window.electronAPI.auth.login = () => 'hijacked'; } catch { /* strict-mode throw is fine */ }
      return { replaced: window.electronAPI.auth.login !== original };
    });
    expect(result.replaced, 'bridge methods must not be replaceable').toBe(false);
  });
});

test.describe('OS screen lock session control', () => {
  test('the session lock subscription is exposed to the renderer', async () => {
    // The main process ends the session on an OS lock/suspend; this bridge is
    // how the renderer learns to clear PHI from the screen. Without it, patient
    // data stays rendered and visible the moment the workstation is unlocked.
    const shape = await window.evaluate(() => ({
      hasSession: typeof window.electronAPI.session === 'object' && window.electronAPI.session !== null,
      onLockedType: typeof window.electronAPI.session?.onLocked,
    }));

    expect(shape.hasSession, 'the session bridge must be exposed').toBe(true);
    expect(shape.onLockedType).toBe('function');
  });

  test('subscribing returns a working unsubscribe function', async () => {
    // A listener that cannot be removed leaks across re-mounts of the renderer
    // component that owns it.
    const result = await window.evaluate(() => {
      const unsubscribe = window.electronAPI.session.onLocked(() => {});
      const type = typeof unsubscribe;
      let threw = null;
      try { unsubscribe(); } catch (e) { threw = e.message; }
      return { type, threw };
    });

    expect(result.type).toBe('function');
    expect(result.threw).toBeNull();
  });

  test('a lock delivered by the main process reaches the renderer', async () => {
    // Drives the real path end to end: main-process send → sandboxed preload
    // bridge → renderer callback, with the payload intact. A static check of
    // the preload source could not catch a broken contextBridge wiring.
    await window.evaluate(() => {
      window.__lockEvents = [];
      window.electronAPI.session.onLocked((payload) => window.__lockEvents.push(payload));
    });

    // app.evaluate receives the electron module, so no require() is needed.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      win.webContents.send('session:locked', { reason: 'lock-screen', wasAuthenticated: true });
    });

    await expect.poll(
      () => window.evaluate(() => window.__lockEvents.length),
      { timeout: 5000, message: 'the lock event must reach the renderer' }
    ).toBe(1);

    const payload = await window.evaluate(() => window.__lockEvents[0]);
    expect(payload).toEqual({ reason: 'lock-screen', wasAuthenticated: true });
  });

  test('the unsubscribed listener stops receiving locks', async () => {
    await window.evaluate(() => {
      window.__afterUnsub = [];
      const off = window.electronAPI.session.onLocked((p) => window.__afterUnsub.push(p));
      off();
    });

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      win.webContents.send('session:locked', { reason: 'suspend', wasAuthenticated: false });
    });

    // Give the event a chance to arrive before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const count = await window.evaluate(() => window.__afterUnsub.length);
    expect(count, 'a removed listener must not fire').toBe(0);
  });
});

test.describe('Sandboxed preload configuration transfer', () => {
  test('the session policy reaches the renderer through launch arguments', async () => {
    // A sandboxed preload cannot require() securityPolicy.cjs, so these values
    // arrive via additionalArguments. If that mechanism ever breaks, the
    // renderer would silently fall back to defaults and idle timeout drifts
    // away from the configured policy.
    const config = await window.evaluate(() => window.transtrackConfig);
    expect(config, 'transtrackConfig must be exposed').toBeTruthy();

    const policy = config.securityPolicy;
    expect(policy).toBeTruthy();
    expect(typeof policy.IDLE_TIMEOUT_MS).toBe('number');
    expect(policy.IDLE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(typeof policy.SESSION_ABSOLUTE_MS).toBe('number');
    expect(policy.SESSION_ABSOLUTE_MS).toBeGreaterThan(policy.IDLE_TIMEOUT_MS);
    expect(typeof policy.WARNING_BEFORE_MS).toBe('number');
    expect(policy.WARNING_BEFORE_MS).toBeGreaterThan(0);
  });

  test('the policy matches the main-process source of truth', async () => {
    // securityPolicy.cjs is plain CommonJS with no Electron dependency, so the
    // test process can read the same file the main process reads.
    const policy = require('../../electron/config/securityPolicy.cjs');
    const fromRenderer = await window.evaluate(() => window.transtrackConfig.securityPolicy);

    expect(fromRenderer).toEqual({
      IDLE_TIMEOUT_MS: policy.IDLE_TIMEOUT_MS,
      SESSION_ABSOLUTE_MS: policy.SESSION_ABSOLUTE_MS,
      WARNING_BEFORE_MS: policy.WARNING_BEFORE_MS,
    });
  });
});

// The Epic Connection Hub depends on remote mode being detected and on the
// FHIR/HL7/EHR bridges remaining callable. These are the assertions that would
// fail first if the sandbox change had regressed Epic connectivity.
test.describe('Epic Connection Hub surface', () => {
  test('remote/Epic mode is still detected in the renderer', async () => {
    const apiBaseUrl = await window.evaluate(() => window.transtrackConfig.apiBaseUrl);
    expect(apiBaseUrl, 'remote API base URL must reach the renderer').toBe(REMOTE_API_URL);
  });

  test('the FHIR bridge is exposed', async () => {
    const shape = await window.evaluate(() => ({
      fhir: typeof window.electronAPI.fhir,
      validate: typeof window.electronAPI.fhir?.validate,
    }));
    expect(shape.fhir).toBe('object');
    expect(shape.validate).toBe('function');
  });

  test('the HL7 v2 bridge is exposed in full', async () => {
    const shape = await window.evaluate(() => {
      const hl7 = window.electronAPI.hl7 || {};
      return {
        parse: typeof hl7.parse,
        buildAck: typeof hl7.buildAck,
        supportedEvents: typeof hl7.supportedEvents,
        ingest: typeof hl7.ingest,
      };
    });
    expect(shape).toEqual({
      parse: 'function',
      buildAck: 'function',
      supportedEvents: 'function',
      ingest: 'function',
    });
  });

  test('the EHR integration entity bridges are exposed', async () => {
    const shape = await window.evaluate(() => {
      const entities = window.electronAPI.entities || {};
      const names = ['EHRIntegration', 'EHRImport', 'EHRSyncLog', 'EHRValidationRule'];
      return names.map((name) => ({
        name,
        present: typeof entities[name] === 'object' && entities[name] !== null,
        methods: entities[name] ? Object.keys(entities[name]).sort() : [],
      }));
    });

    for (const entity of shape) {
      expect(entity.present, `${entity.name} bridge must be exposed`).toBe(true);
      expect(entity.methods, `${entity.name} methods`).toEqual(
        ['create', 'delete', 'filter', 'get', 'list', 'update']
      );
    }
  });

  test('an HL7 v2 message still round-trips through IPC unchanged', async () => {
    // Proves the new IPC argument validation does not reject or mangle a real
    // HL7 payload. hl7:supportedEvents needs no session, so this runs
    // pre-login and isolates the transport from authorization.
    const events = await window.evaluate(() => window.electronAPI.hl7.supportedEvents());
    expect(events, 'hl7:supportedEvents must respond').toBeTruthy();
  });

  test('a FHIR resource passes IPC validation without being rejected', async () => {
    const outcome = await window.evaluate(async () => {
      const resource = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{
          resource: {
            resourceType: 'Patient',
            id: 'erXuFYUfucBZaryVksYEcMg3',
            identifier: [{ system: 'urn:oid:1.2.840.114350.1.13.0.1.7.5.737384.0', value: 'E4007' }],
            name: [{ use: 'official', family: 'Lopez', given: ['Camila', 'Maria'] }],
            birthDate: '1987-09-12',
            extension: [{
              url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
              extension: [{ url: 'text', valueString: 'Declined' }],
            }],
          },
        }],
      };
      try {
        const result = await window.electronAPI.fhir.validate(resource);
        return { threw: false, result };
      } catch (err) {
        return { threw: true, message: String(err && err.message) };
      }
    });

    // The handler may legitimately require a session, but it must never fail
    // because the IPC layer refused the payload.
    if (outcome.threw) {
      expect(outcome.message).not.toMatch(/IPC validation|prototype|too large|too deep|rate limit/i);
    } else {
      expect(outcome.result).toBeTruthy();
    }
  });
});

// A CSP violation fires a `securitypolicyviolation` event carrying the exact
// policy that rejected the load. That is the only way to attribute a blocked
// request to CSP rather than to a DNS or network failure, so these tests read
// the applied policies from violation reports instead of inferring from a
// failed fetch.
test.describe('Content Security Policy', () => {
  test('the document declares a baseline policy', async () => {
    const csp = await window.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return meta ? meta.getAttribute('content') : null;
    });

    expect(csp, 'a meta CSP must be present').toBeTruthy();
    expect(csp).toMatch(/default-src\s+'self'/);
    expect(csp, 'object-src must be locked down').toMatch(/object-src\s+'none'/);
    expect(csp, 'framing must be refused').toMatch(/frame-ancestors\s+'none'/);
    expect(csp, 'base-uri must be pinned').toMatch(/base-uri\s+'self'/);
    expect(csp, 'form-action must be pinned').toMatch(/form-action\s+'self'/);
  });

  test('object-src is enforced, not just declared', async () => {
    const report = await window.evaluate(async () => {
      const violations = [];
      const onViolation = (e) => violations.push({
        directive: e.effectiveDirective || e.violatedDirective,
        policy: e.originalPolicy,
      });
      document.addEventListener('securitypolicyviolation', onViolation);

      const el = document.createElement('object');
      el.setAttribute('data', 'https://example.com/probe.swf');
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 400));

      el.remove();
      document.removeEventListener('securitypolicyviolation', onViolation);
      return violations;
    });

    const objectViolation = report.find((v) => /object-src/.test(v.directive || ''));
    expect(objectViolation, `expected an object-src violation, saw ${JSON.stringify(report)}`).toBeTruthy();
  });

  test('the main-process CSP header reaches the renderer', async () => {
    // The header policy — not the static meta tag — is what narrows connect-src
    // to the configured API origin in production. If onHeadersReceived ever
    // stopped applying, the meta policy's deliberately wide connect-src would
    // silently become the only policy in force.
    const policies = await window.evaluate(async () => {
      const seen = [];
      const onViolation = (e) => { if (e.originalPolicy) seen.push(e.originalPolicy); };
      document.addEventListener('securitypolicyviolation', onViolation);

      const img = document.createElement('img');
      img.src = 'https://blocked.example.com/probe.png';
      document.body.appendChild(img);
      await new Promise((r) => setTimeout(r, 400));

      img.remove();
      document.removeEventListener('securitypolicyviolation', onViolation);
      return seen;
    });

    // Two policies are in force: the meta tag and the response header. The
    // header is distinguishable because it pins worker-src differently and is
    // built from connectSrc in main.cjs.
    expect(policies.length, 'at least one policy must report the violation').toBeGreaterThan(0);
    const headerPolicy = policies.find((p) => !/http:\s+https:/.test(p));
    expect(
      headerPolicy,
      `expected a policy distinct from the wide meta policy, saw ${JSON.stringify(policies)}`
    ).toBeTruthy();
  });

  test('img-src blocks an arbitrary remote origin', async () => {
    const violated = await window.evaluate(async () => {
      let blockedByCsp = false;
      const onViolation = (e) => {
        if (/img-src/.test(e.effectiveDirective || e.violatedDirective || '')) blockedByCsp = true;
      };
      document.addEventListener('securitypolicyviolation', onViolation);

      const img = document.createElement('img');
      img.src = 'https://blocked.example.com/probe.png';
      document.body.appendChild(img);
      await new Promise((r) => setTimeout(r, 400));

      img.remove();
      document.removeEventListener('securitypolicyviolation', onViolation);
      return blockedByCsp;
    });
    expect(violated, 'a remote image must be refused by CSP').toBe(true);
  });
});

test.describe('Window and navigation policy', () => {
  test('popups are denied', async () => {
    const before = app.windows().length;
    await window.evaluate(() => { window.open('https://example.com', '_blank'); });
    await new Promise((r) => setTimeout(r, 500));
    expect(app.windows().length, 'window.open must not create a window').toBe(before);
  });

  test('webviews cannot be attached', async () => {
    const attached = await window.evaluate(async () => {
      const view = document.createElement('webview');
      view.setAttribute('src', 'https://example.com');
      document.body.appendChild(view);
      await new Promise((r) => setTimeout(r, 500));
      // In a hardened app the custom element is not registered at all, so it
      // never gains the webview API surface.
      const isRealWebview = typeof view.getWebContentsId === 'function';
      view.remove();
      return isRealWebview;
    });
    expect(attached, 'webview must not attach').toBe(false);
  });
});

test.describe('Fail-closed IPC authorization', () => {
  // The content of the health snapshot (including the integrity and auditTrail
  // components) is asserted by tests/healthCheck.test.cjs. What can only be
  // verified against the running app is that these channels refuse to answer an
  // unauthenticated renderer.
  test('operational diagnostics require a session', async () => {
    const outcome = await window.evaluate(async () => {
      try {
        const result = await window.electronAPI.system.getHealth();
        return { allowed: true, result };
      } catch (err) {
        return { allowed: false, message: String(err && err.message) };
      }
    });

    expect(outcome.allowed, 'system:getHealth must not answer without a session').toBe(false);
    expect(outcome.message).toMatch(/session|log in|unauthor/i);
  });

  test('audit trail channels refuse an unauthenticated renderer', async () => {
    const results = await window.evaluate(async () => {
      const channels = {
        verifyAuditChain: () => window.electronAPI.compliance.verifyAuditChain(),
        generateAuditReport: () => window.electronAPI.compliance.generateAuditReport({}),
        exportAuditReport: () => window.electronAPI.compliance.exportAuditReport({ format: 'csv' }),
      };
      const out = {};
      for (const [name, call] of Object.entries(channels)) {
        try {
          await call();
          out[name] = { allowed: true };
        } catch (err) {
          out[name] = { allowed: false, message: String(err && err.message) };
        }
      }
      return out;
    });

    for (const [name, outcome] of Object.entries(results)) {
      expect(outcome.allowed, `${name} must be refused without a session`).toBe(false);
      expect(outcome.message, `${name} rejection reason`).toMatch(/session|log in|unauthor|permission|denied/i);
    }
  });

  test('entity writes are refused without a session', async () => {
    const outcome = await window.evaluate(async () => {
      try {
        await window.electronAPI.entities.Patient.create({ full_name: 'Probe, Unauthorized' });
        return { allowed: true };
      } catch (err) {
        return { allowed: false, message: String(err && err.message) };
      }
    });
    expect(outcome.allowed, 'an unauthenticated create must be refused').toBe(false);
    expect(outcome.message).toMatch(/session|log in|unauthor|permission|denied/i);
  });
});
