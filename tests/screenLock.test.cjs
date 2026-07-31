/**
 * TransTrack — OS screen lock / suspend session locking.
 *
 * The idle timeout only fires on inactivity, so a clinician who locks the
 * workstation (Win+L) or whose machine suspends would otherwise leave a live
 * authenticated session — and rendered PHI — behind the lock screen until the
 * idle window elapsed. electron/services/screenLock.cjs ends the session
 * immediately instead.
 *
 * What these tests pin:
 *   • the session row is deleted so it cannot be resumed
 *   • in-memory state is cleared, so IPC fails closed afterwards
 *   • the event is audited, attributed, and contains no PHI
 *   • the renderer is notified so PHI leaves the screen
 *   • every failure mode is survivable — an OS transition must never throw
 *
 * Run standalone: node tests/screenLock.test.cjs
 */

'use strict';

const assert = require('assert');
const Database = require('better-sqlite3-multiple-ciphers');

process.env.NODE_ENV = 'test';
process.env.TRANSTRACK_AUDIT_HMAC_KEY = 'cd'.repeat(32);

// --- Electron mock, including a controllable powerMonitor ------------------

const powerMonitorHandlers = new Map();
let powerMonitorThrowsFor = null;

const mockPowerMonitor = {
  on: (event, handler) => {
    if (powerMonitorThrowsFor === event) throw new Error(`no listener support for ${event}`);
    if (!powerMonitorHandlers.has(event)) powerMonitorHandlers.set(event, []);
    powerMonitorHandlers.get(event).push(handler);
  },
};

/** Fire an OS event exactly as Electron would. */
function emitOsEvent(event) {
  const handlers = powerMonitorHandlers.get(event) || [];
  for (const handler of handlers) handler();
  return handlers.length;
}

require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: { getPath: () => __dirname, isPackaged: false, getVersion: () => '1.2.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
    powerMonitor: mockPowerMonitor,
  },
};

// Capture logs so we can assert no PHI reaches them.
const logs = [];
const loggerPath = require.resolve('../electron/services/logger.cjs');
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: {
    logger: {
      info: (message, meta) => logs.push({ level: 'info', message, meta }),
      warn: (message, meta) => logs.push({ level: 'warn', message, meta }),
      error: (message, meta) => logs.push({ level: 'error', message, meta }),
      debug: () => {},
    },
  },
};

// --- Database ---------------------------------------------------------------

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, action TEXT NOT NULL,
    entity_type TEXT, entity_id TEXT, patient_name TEXT, details TEXT,
    user_id TEXT, user_email TEXT, user_role TEXT, request_id TEXT,
    prev_hash TEXT, record_hash TEXT, record_hmac TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
  CREATE TABLE users (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, is_active INTEGER DEFAULT 1);
  CREATE TABLE login_attempts (
    id TEXT PRIMARY KEY, email TEXT, attempt_count INTEGER DEFAULT 0,
    locked_until TEXT, last_attempt_at TEXT, ip_address TEXT,
    created_at TEXT, updated_at TEXT
  );
`);

const initPath = require.resolve('../electron/database/init.cjs');
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: {
    getDatabase: () => db,
    getDatabasePath: () => ':memory:',
    getDatabaseEncryptionKey: () => 'aa'.repeat(32),
  },
};

const siemPath = require.resolve('../electron/services/siemForwarder.cjs');
require.cache[siemPath] = {
  id: siemPath, filename: siemPath, loaded: true,
  exports: { forwardAuditRow: () => {} },
};

const shared = require('../electron/ipc/shared.cjs');
const screenLock = require('../electron/services/screenLock.cjs');

// --- Harness ---------------------------------------------------------------

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const ORG = 'ORG_LOCK';
const USER = { id: 'u-lock', org_id: ORG, email: 'clinician@example.org', role: 'coordinator' };

db.prepare('INSERT INTO users (id, org_id) VALUES (?, ?)').run(USER.id, ORG);

/** Fake main window that records what was sent to the renderer. */
function makeWindow({ destroyed = false, contentsDestroyed = false, throwOnSend = false } = {}) {
  const sent = [];
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => contentsDestroyed,
      send: (channel, payload) => {
        if (throwOnSend) throw new Error('render process gone');
        sent.push({ channel, payload });
      },
    },
  };
}

/** Establish a logged-in session. */
function login(sessionId = 's-lock') {
  db.prepare('INSERT OR REPLACE INTO sessions (id, user_id) VALUES (?, ?)').run(sessionId, USER.id);
  shared.setSessionState(sessionId, { ...USER }, Date.now() + 3600000, 1);
  return sessionId;
}

function resetAll() {
  shared.clearSession();
  db.prepare('DELETE FROM sessions').run();
  powerMonitorHandlers.clear();
  powerMonitorThrowsFor = null;
  logs.length = 0;
  screenLock._resetForTests();
}

console.log('\n=== Locking an active session ===');

test('deletes the session row so it cannot be resumed', () => {
  resetAll();
  const sessionId = login();
  const win = makeWindow();
  screenLock.initializeScreenLock({ getMainWindow: () => win });

  const result = screenLock.lockSession('lock-screen');

  assert.strictEqual(result.locked, true, JSON.stringify(result));
  const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
  assert.strictEqual(row, undefined, 'the session row must be gone');
});

test('clears in-memory state so IPC fails closed', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });

  assert.strictEqual(shared.validateSession(1), true, 'precondition: session is valid');
  screenLock.lockSession('lock-screen');

  assert.strictEqual(shared.validateSession(1), false, 'session must no longer validate');
  const state = shared.getSessionState();
  assert.strictEqual(state.currentSession, null);
  assert.strictEqual(state.currentUser, null);
});

test('notifies the renderer so PHI leaves the screen', () => {
  resetAll();
  login();
  const win = makeWindow();
  screenLock.initializeScreenLock({ getMainWindow: () => win });

  screenLock.lockSession('suspend');

  assert.strictEqual(win.sent.length, 1, JSON.stringify(win.sent));
  assert.strictEqual(win.sent[0].channel, 'session:locked');
  assert.deepStrictEqual(win.sent[0].payload, { reason: 'suspend', wasAuthenticated: true });
});

console.log('\n=== Audit trail ===');

test('writes an attributable audit entry naming the OS event', () => {
  resetAll();
  const sessionId = login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });

  screenLock.lockSession('lock-screen');

  const entry = db.prepare(
    "SELECT * FROM audit_logs WHERE action = 'session.lock' ORDER BY rowid DESC LIMIT 1"
  ).get();

  assert.ok(entry, 'an audit entry must be written');
  assert.strictEqual(entry.entity_type, 'Session');
  assert.strictEqual(entry.entity_id, sessionId);
  assert.strictEqual(entry.user_email, USER.email, 'must remain attributable to the user');
  assert.strictEqual(entry.user_role, USER.role);
  assert.match(entry.details, /lock-screen/, 'the originating event must be recorded');
});

test('the audit entry is hash-chained like any other', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });
  screenLock.lockSession('lock-screen');

  const entry = db.prepare(
    "SELECT * FROM audit_logs WHERE action = 'session.lock' ORDER BY rowid DESC LIMIT 1"
  ).get();
  assert.ok(/^[a-f0-9]{64}$/.test(entry.record_hash), 'must carry a chain hash');
  assert.ok(/^[a-f0-9]{64}$/.test(entry.record_hmac), 'must carry an HMAC');
});

test('the lock records no PHI', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });
  screenLock.lockSession('lock-screen');

  const entry = db.prepare(
    "SELECT * FROM audit_logs WHERE action = 'session.lock' ORDER BY rowid DESC LIMIT 1"
  ).get();
  assert.strictEqual(entry.patient_name, null, 'no patient identifier belongs on a lock event');
});

test('no email or session id reaches the application log', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });
  screenLock.lockSession('lock-screen');

  const serialized = JSON.stringify(logs);
  assert.ok(!serialized.includes(USER.email), `email must not be logged: ${serialized}`);
  assert.ok(!serialized.includes('s-lock'), `session id must not be logged: ${serialized}`);
});

console.log('\n=== OS event wiring ===');

test('subscribes to both lock-screen and suspend', () => {
  resetAll();
  const status = screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });

  assert.strictEqual(status.enabled, true, JSON.stringify(status));
  assert.deepStrictEqual([...status.events].sort(), ['lock-screen', 'suspend']);
  assert.ok(powerMonitorHandlers.has('lock-screen'));
  assert.ok(powerMonitorHandlers.has('suspend'));
});

test('does NOT subscribe to resume or unlock-screen', () => {
  // Re-authentication after an OS unlock is the required behaviour; silently
  // restoring the session would defeat the control.
  resetAll();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });
  assert.strictEqual(powerMonitorHandlers.has('resume'), false);
  assert.strictEqual(powerMonitorHandlers.has('unlock-screen'), false);
});

for (const event of ['lock-screen', 'suspend']) {
  test(`a real "${event}" event ends the session`, () => {
    resetAll();
    login();
    const win = makeWindow();
    screenLock.initializeScreenLock({ getMainWindow: () => win });

    const fired = emitOsEvent(event);

    assert.strictEqual(fired, 1, 'exactly one handler must be registered');
    assert.strictEqual(shared.validateSession(1), false, 'session must be gone');
    assert.strictEqual(win.sent[0].payload.reason, event);
  });
}

test('initialization is idempotent', () => {
  resetAll();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });

  // A duplicate registration would end the session twice and double-audit.
  assert.strictEqual(powerMonitorHandlers.get('lock-screen').length, 1);
  assert.strictEqual(powerMonitorHandlers.get('suspend').length, 1);
});

test('a platform that cannot report lock-screen still gets suspend', () => {
  // Some Linux desktops do not deliver lock-screen; that must degrade, not fail.
  resetAll();
  powerMonitorThrowsFor = 'lock-screen';

  const status = screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });

  assert.strictEqual(status.enabled, true, 'partial support is still enabled');
  assert.deepStrictEqual(status.events, ['suspend']);
});

test('getStatus reports the registration', () => {
  resetAll();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });
  const status = screenLock.getStatus();
  assert.strictEqual(status.enabled, true);
  assert.strictEqual(status.powerMonitorAvailable, true);
  assert.deepStrictEqual([...status.events].sort(), ['lock-screen', 'suspend']);
});

console.log('\n=== Failure modes must never break the OS transition ===');

test('locking with no session logged in is a safe no-op', () => {
  resetAll();
  const win = makeWindow();
  screenLock.initializeScreenLock({ getMainWindow: () => win });

  const countLocks = () =>
    db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'session.lock'").get().c;
  const before = countLocks();

  const result = screenLock.lockSession('lock-screen');

  assert.strictEqual(result.locked, false);
  // The renderer is still told, so a stale view returns to login.
  assert.strictEqual(win.sent.length, 1);
  assert.strictEqual(win.sent[0].payload.wasAuthenticated, false);
  assert.strictEqual(countLocks(), before, 'nothing to audit when nobody was logged in');
});

test('a destroyed window does not prevent the session ending', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow({ destroyed: true }) });

  const result = screenLock.lockSession('lock-screen');

  assert.strictEqual(result.locked, true, 'the lock must still take effect');
  assert.strictEqual(result.notified, false);
  assert.strictEqual(shared.validateSession(1), false);
});

test('a destroyed webContents does not prevent the session ending', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow({ contentsDestroyed: true }) });

  const result = screenLock.lockSession('lock-screen');
  assert.strictEqual(result.locked, true);
  assert.strictEqual(result.notified, false);
});

test('a send that throws does not prevent the session ending', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow({ throwOnSend: true }) });

  const result = screenLock.lockSession('lock-screen');
  assert.strictEqual(result.locked, true);
  assert.strictEqual(result.notified, false);
  assert.strictEqual(shared.validateSession(1), false);
});

test('a missing window accessor does not prevent the session ending', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({});

  const result = screenLock.lockSession('lock-screen');
  assert.strictEqual(result.locked, true);
  assert.strictEqual(shared.validateSession(1), false);
});

test('the OS handler never throws even if locking fails internally', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({
    getMainWindow: () => { throw new Error('window accessor exploded'); },
  });

  assert.doesNotThrow(() => emitOsEvent('lock-screen'), 'an OS transition must never see an exception');
  assert.strictEqual(shared.validateSession(1), false, 'the session must still be gone');
});

test('a failed session-row delete still clears in-memory state', () => {
  resetAll();
  login();
  screenLock.initializeScreenLock({ getMainWindow: () => makeWindow() });

  // Simulate a database that refuses the delete.
  const realGetDatabase = require.cache[initPath].exports.getDatabase;
  require.cache[initPath].exports.getDatabase = () => ({
    prepare: () => { throw new Error('database is locked'); },
  });

  try {
    const result = screenLock.lockSession('lock-screen');
    assert.strictEqual(result.locked, true, 'the in-memory clear is what enforces the lock');
    assert.strictEqual(shared.validateSession(1), false);
  } finally {
    require.cache[initPath].exports.getDatabase = realGetDatabase;
  }
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
