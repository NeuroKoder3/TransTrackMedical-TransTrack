/**
 * TransTrack — auto-update authorisation and signature configuration (M-22).
 *
 * `update:check`, `update:download` and `update:install` were registered with no
 * session validation whatsoever. `update:install` calls
 * `autoUpdater.quitAndInstall()`, so any code that could reach the IPC bridge —
 * including a compromised renderer with nobody signed in — could restart the
 * workstation into an installer.
 *
 * The other half of the finding is what the installer is trusted on. On Windows
 * electron-updater only checks the downloaded installer's Authenticode publisher
 * when the packaged app-update.yml carries a `publisherName`, which
 * electron-builder writes from `win.verifyUpdateCodeSignature`. Without it a
 * spoofed or compromised feed can serve arbitrary code. These tests assert both
 * the runtime gate and the build configuration it depends on.
 *
 * Run standalone: node tests/updateAuthorization.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-update-'));

const registeredHandlers = {};
const mockApp = {
  isPackaged: false,
  getPath: (k) => path.join(SANDBOX, String(k)),
  getVersion: () => '1.2.1-test',
  setAsDefaultProtocolClient: () => true,
  requestSingleInstanceLock: () => true,
  disableHardwareAcceleration: () => {},
  setPath: () => {},
  on: () => {},
  quit: () => {},
  exit: () => {},
  // Never resolves: the startup block inside app.whenReady() must not run.
  whenReady: () => new Promise(() => {}),
};

require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: mockApp,
    BrowserWindow: class { static getAllWindows() { return []; } },
    ipcMain: {
      handle: (channel, fn) => { registeredHandlers[channel] = fn; },
      on: () => {},
    },
    dialog: { showErrorBox: () => {}, showSaveDialog: async () => ({ canceled: true }) },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
    session: { defaultSession: { setPermissionRequestHandler: () => {}, webRequest: { onHeadersReceived: () => {} } } },
    crashReporter: { start: () => {} },
    safeStorage: { isEncryptionAvailable: () => false },
    powerMonitor: { on: () => {} },
    shell: {},
  },
};

// electron-updater is not installed in the plain-Node test environment and
// would try to reach a real feed if it were.
const updaterCalls = [];
require.cache[require.resolve('electron-updater')] = {
  id: 'electron-updater', filename: 'electron-updater', loaded: true,
  exports: {
    autoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      logger: null,
      on: () => {},
      checkForUpdates: async () => { updaterCalls.push('check'); return { updateInfo: { version: '9.9.9' } }; },
      downloadUpdate: async () => { updaterCalls.push('download'); return []; },
      quitAndInstall: () => { updaterCalls.push('install'); },
    },
  },
};

// validateSession() re-reads the session and the user from the database on
// every call, so the suite runs against a real (in-memory) one rather than
// stubbing the session check it depends on.
const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT, role TEXT, is_active INTEGER DEFAULT 1);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
`);

const initPath = require.resolve('../electron/database/init.cjs');
const realInit = require(initPath);
require.cache[initPath].exports = {
  ...realInit,
  getDatabase: () => db,
  initDatabase: async () => db,
};

const main = require('../electron/main.cjs');
const shared = require('../electron/ipc/shared.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function section(name) { cases.push({ section: name }); }

const ROLES = ['admin', 'coordinator', 'physician', 'user', 'viewer', 'regulator'];
for (const role of ROLES) {
  db.prepare('INSERT INTO users (id, org_id, email, role) VALUES (?, ?, ?, ?)')
    .run(`u-${role}`, 'ORG1', `${role}@test.local`, role);
  db.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run(`s-${role}`, `u-${role}`);
}

function signIn(role) {
  shared.setSessionState(
    `s-${role}`,
    { id: `u-${role}`, org_id: 'ORG1', email: `${role}@test.local`, role },
    Date.now() + 3600000,
    null
  );
}
function signOut() {
  shared.clearSession();
}

async function rejects(fn, pattern, message) {
  try {
    await fn();
  } catch (e) {
    assert.match(e.message, pattern, message);
    return e;
  }
  throw new Error(`${message}: expected a rejection`);
}

section('the update channels require an administrator');

let updater;

test('the three update channels are registered', () => {
  updater = main.initAutoUpdater();
  for (const channel of ['update:check', 'update:download', 'update:install']) {
    assert.strictEqual(typeof registeredHandlers[channel], 'function', `${channel} must be registered`);
  }
});

test('an unauthenticated caller cannot check, download or install', async () => {
  signOut();
  for (const channel of ['update:check', 'update:download', 'update:install']) {
    await rejects(() => registeredHandlers[channel]({}), /Session expired/, channel);
  }
  assert.deepStrictEqual(updaterCalls, [], 'nothing may reach the updater without a session');
});

test('a non-admin session cannot check, download or install', async () => {
  for (const role of ROLES.filter((r) => r !== 'admin')) {
    signIn(role);
    for (const channel of ['update:check', 'update:download', 'update:install']) {
      await rejects(
        () => registeredHandlers[channel]({}),
        /Administrator access required/,
        `${role} on ${channel}`
      );
    }
  }
  assert.deepStrictEqual(updaterCalls, [], 'no non-admin call may reach the updater');
});

section('an administrator is still refused when signatures are unverifiable');

test('download and install refuse on a build with no signature configuration', async () => {
  // mockApp.isPackaged is false, so verifyUpdaterSignatureConfiguration reports
  // that there is no signature to verify against.
  signIn('admin');
  await rejects(() => registeredHandlers['update:download']({}), /signature verification is not configured/, 'download');
  await rejects(() => registeredHandlers['update:install']({}), /signature verification is not configured/, 'install');
  assert.ok(!updaterCalls.includes('download'), 'no download may start without signature verification');
  assert.ok(!updaterCalls.includes('install'), 'no install may start without signature verification');
});

test('checking for an update is still allowed, so the site can see it exists', async () => {
  signIn('admin');
  const info = await registeredHandlers['update:check']({});
  assert.strictEqual(info.version, '9.9.9');
  assert.ok(updaterCalls.includes('check'));
});

section('what verifyUpdaterSignatureConfiguration actually proves');

test('an unpackaged build is reported as unverifiable', () => {
  const result = main.verifyUpdaterSignatureConfiguration();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.checks.packaged, false);
  assert.ok(result.problems.some((p) => /not packaged/.test(p)), JSON.stringify(result.problems));
});

test('on Windows a packaged build must carry a publisherName', () => {
  if (process.platform !== 'win32') {
    // The Windows branch reads process.resourcesPath, which only exists inside a
    // packaged Electron process. The configuration it depends on is asserted
    // directly against the builder config below instead.
    return;
  }
  mockApp.isPackaged = true;
  try {
    const result = main.verifyUpdaterSignatureConfiguration();
    assert.strictEqual(result.ok, false, 'a test process has no packaged app-update.yml');
    assert.ok(result.problems.some((p) => /publisherName|app-update\.yml/.test(p)));
  } finally {
    mockApp.isPackaged = false;
  }
});

section('the build configuration the runtime check depends on');

test('the enterprise builder config enables win.verifyUpdateCodeSignature', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'electron-builder.enterprise.json'), 'utf8')
  );
  assert.strictEqual(
    config.win?.verifyUpdateCodeSignature, true,
    'without this electron-builder omits publisherName and NsisUpdater skips the signature check'
  );
  assert.ok(config.win?.signtoolOptions?.sign, 'the installer must be signed for there to be a signature to verify');
  assert.strictEqual(
    config.publish?.provider, 'github',
    'the update feed provider is what the signature check protects; changing it needs review'
  );
});

test('the updater never downloads without being asked', () => {
  const { autoUpdater } = require('electron-updater');
  assert.strictEqual(
    autoUpdater.autoDownload, false,
    'autoDownload must stay off so a download is always an authorised act'
  );
  assert.strictEqual(
    autoUpdater.autoInstallOnAppQuit, false,
    'installs on quit must be disabled when signature verification is unavailable'
  );
});

(async () => {
  for (const c of cases) {
    if (c.section) { console.log(`\n=== ${c.section} ===`); continue; }
    try { await c.fn(); PASS++; console.log(`  ok  ${c.name}`); }
    catch (e) { FAIL++; failures.push({ name: c.name, error: e }); console.log(`  FAIL ${c.name}: ${e.message}`); }
  }

  updater?.stopScheduledChecks();
  db.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  if (FAIL > 0) {
    for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
    process.exit(1);
  }
})();
