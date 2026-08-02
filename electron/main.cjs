// Main process entry point

const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const path = require('path');
const { initDatabase, closeDatabase } = require('./database/init.cjs');
const { setupIPCHandlers } = require('./ipc/handlers.cjs');
const { logger, initCrashReporter, closeLogger } = require('./services/logger.cjs');
const securityPolicy = require('./config/securityPolicy.cjs');
const senderValidation = require('./ipc/senderValidation.cjs');
const shared = require('./ipc/shared.cjs');

// Register the custom URL protocol used as the OIDC SSO redirect target.
// Must run BEFORE app.whenReady() on every platform. See electron/auth/oidcDesktop.cjs.
const TRANSTRACK_PROTOCOL = 'transtrack';
if (process.defaultApp) {
  // When running from `npm run electron-dev`, process.argv[1] points to the
  // entry script and the call below has to pass it explicitly for the OS
  // to bind the protocol to the dev runner. In a packaged build there is
  // no second argument needed.
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(TRANSTRACK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(TRANSTRACK_PROTOCOL);
}

// E2E / hermetic runs get an isolated userData so parallel or sequential
// Electron launches do not share a locked SQLCipher DB or single-instance lock.
if (process.env.TRANSTRACK_USERDATA_DIR) {
  const fs = require('fs');
  fs.mkdirSync(process.env.TRANSTRACK_USERDATA_DIR, { recursive: true });
  app.setPath('userData', process.env.TRANSTRACK_USERDATA_DIR);
}

// Single-instance lock — on Windows/Linux the second app launch triggered
// by `transtrack://...` is delivered to the first instance via the
// second-instance event below; without this lock, both would race.
// Skip in NODE_ENV=test so Playwright can relaunch cleanly between files.
if (process.env.NODE_ENV !== 'test') {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

// Security hardening — OutOfBlinkCors intentionally NOT disabled

let mainWindow = null;
let splashWindow = null;

/**
 * Whether this process runs in development mode.
 *
 * Dev mode loads the renderer from http://localhost:5173 and applies a CSP that
 * permits `script-src 'unsafe-inline'` with a wide connect-src, because a Vite
 * dev server needs both. Those are the right trade-offs on a workstation and
 * unacceptable on an installed clinical system.
 *
 * A packaged build therefore ignores the escape hatch entirely: ELECTRON_DEV=1
 * or NODE_ENV=development set in the environment of a deployed application —
 * by a user, a login script, or anything that can set a variable in the
 * process's environment — must not be able to downgrade its content security
 * policy or point it at an attacker-controlled origin.
 *
 * NODE_ENV=test remains excluded from dev mode because the Playwright harness
 * needs a packaged-shaped run that loads dist/index.html from disk.
 *
 * An unpackaged run is a development run by definition, so the environment
 * variables no longer appear here at all: they only ever widened the condition
 * where it was already true, and narrowed nothing.
 */
const isDev = process.env.NODE_ENV !== 'test' && !app.isPackaged;

// Application metadata — version sourced from package.json (single source of truth)
const { version: PKG_VERSION } = require('../package.json');
const APP_INFO = {
  name: 'TransTrack',
  version: PKG_VERSION,
  description: 'Transplant Waitlist Management System (HIPAA Security Rule aligned, 21 CFR Part 11 architected)',
  author: 'TransTrack Medical Software',
  designAlignment: ['HIPAA Security Rule', '21 CFR Part 11', 'AATB Standards'],
  certificationDisclaimer: 'Design alignment statements describe product controls only and are not certifications. SOC 2, HITRUST, and 21 CFR Part 11 validation must be performed by the deploying organization with qualified auditors.'
};

// Values forwarded into the sandboxed preload via additionalArguments.
// A sandboxed preload cannot require() local modules, so securityPolicy.cjs
// (the single source of truth) is serialized here instead.
const SECURITY_POLICY_ARG = `--transtrack-security-policy=${JSON.stringify({
  IDLE_TIMEOUT_MS: securityPolicy.IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_MS: securityPolicy.SESSION_ABSOLUTE_MS,
  WARNING_BEFORE_MS: securityPolicy.WARNING_BEFORE_MS,
})}`;

// The preload resolves the remote API base URL from process.env, which is how
// Epic/remote mode is selected. That remains the primary source; this argument
// is a belt-and-braces fallback so the Epic Connection Hub cannot be affected
// by any difference in how the environment reaches a sandboxed renderer.
const API_BASE_URL_ARG = `--transtrack-api-base-url=${(
  process.env.TRANSTRACK_API_URL
  || process.env.VITE_TRANSTRACK_API_URL
  || ''
).replace(/^\uFEFF/, '').trim()}`;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      // Splash has no preload bridge and loads only a local static file, so
      // full sandboxing costs nothing here.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    // Show immediately in E2E so Playwright can attach; production keeps splash→show.
    show: process.env.NODE_ENV === 'test' || process.env.TRANSTRACK_E2E === '1',
    title: 'TransTrack - Transplant Waitlist Management',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Full OS-level renderer sandbox. The preload is written to run under
      // sandbox (no local require) and receives config via additionalArguments.
      sandbox: true,
      enableRemoteModule: false,
      nodeIntegrationInSubFrames: false,
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [SECURITY_POLICY_ARG, API_BASE_URL_ARG],
      // Security settings
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  });

  // Bind the IPC trust anchor to this window. Every ipcMain.handle call is
  // checked against it, so IPC from any other WebContents or frame is refused.
  senderValidation.registerTrustedWindow(mainWindow, { isDev });

  // Security: never allow <webview> to be attached, and strip any preload or
  // node privileges if one is somehow injected into the renderer.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    event.preventDefault();
    logger.warn('Blocked webview attach attempt');
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Only open devtools in true dev environment, NOT in packaged evaluation builds
    if (process.env.ELECTRON_DEV === '1' && !app.isPackaged) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    // Ensure no devtools access in production
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'file:' && !url.startsWith('http://localhost')) {
      event.preventDefault();
      logger.warn('Blocked navigation to external URL', { url });
    }
  });

  // Security: Block new window creation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('Blocked popup window', { url });
    return { action: 'deny' };
  });

  // Security: Content Security Policy and response headers.
  // IMPORTANT: replace any existing CSP header (do not stack policies).
  // Multiple CSPs are AND-ed — a strict HTML/meta policy without connect-src
  // will still block :8080 even if this header allows it.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const apiBase =
      process.env.TRANSTRACK_API_URL
      || process.env.VITE_TRANSTRACK_API_URL
      || 'http://localhost:8080';
    let apiOrigin = '';
    try { apiOrigin = new URL(apiBase).origin; } catch { /* ignore */ }

    // Dev: allow Vite (:5173), HMR websockets, API (:8080), and the /__api proxy.
    const connectSrc = isDev
      ? [
          "'self'",
          'http://localhost:*',
          'http://127.0.0.1:*',
          'ws://localhost:*',
          'ws://127.0.0.1:*',
          'http:',
          'https:',
          'ws:',
          'wss:',
        ]
      : ["'self'"];
    if (apiOrigin && !connectSrc.includes(apiOrigin)) connectSrc.push(apiOrigin);

    // The E2E harness needs 'unsafe-inline' for the instrumentation it injects,
    // but NODE_ENV is an environment variable and a packaged build must not be
    // talked into relaxing its script policy by one. Packaged always gets the
    // strict directive regardless of how the process was launched.
    const allowInlineScripts = !app.isPackaged && (isDev || process.env.NODE_ENV === 'test');
    const scriptSrc = allowInlineScripts
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self'";
    const cspDirectives = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSrc.join(' ')}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ];
    if (!isDev) cspDirectives.push('upgrade-insecure-requests');

    const headers = { ...details.responseHeaders };
    // Strip any prior CSP so we do not create an intersecting second policy.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    }
    headers['Content-Security-Policy'] = [cspDirectives.join('; ')];
    headers['X-Content-Type-Options'] = ['nosniff'];
    headers['X-Frame-Options'] = ['DENY'];
    headers['X-XSS-Protection'] = ['1; mode=block'];
    headers['Referrer-Policy'] = ['strict-origin-when-cross-origin'];
    headers['Permissions-Policy'] = ['camera=(), microphone=(), geolocation=(), payment=()'];

    callback({ responseHeaders: headers });
  });

  hardenSession(mainWindow.webContents.session);
}

/**
 * Deny every optional renderer capability. TransTrack is an offline records
 * system: it never needs camera, microphone, geolocation, notifications,
 * MIDI, USB/HID/Serial, or media access. Electron grants some of these by
 * default for file:// origins, so they must be explicitly refused.
 */
function hardenSession(targetSession) {
  if (!targetSession || targetSession.__transtrackHardened) return;
  targetSession.__transtrackHardened = true;

  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    logger.warn('Denied renderer permission request', { permission });
    callback(false);
  });

  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    logger.warn('Denied renderer permission check', { permission });
    return false;
  });

  // Refuse device selection outright (WebUSB / WebHID / Web Serial).
  targetSession.setDevicePermissionHandler(() => false);
  if (typeof targetSession.setBluetoothPairingHandler === 'function') {
    targetSession.setBluetoothPairingHandler((_details, callback) => callback({ cancelled: true }));
  }
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Export Data',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu-export')
        },
        {
          label: 'Import Data',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu-import')
        },
        { type: 'separator' },
        {
          label: 'Backup Database',
          click: async () => {
            const { filePath } = await dialog.showSaveDialog(mainWindow, {
              title: 'Backup Database',
              defaultPath: `transtrack-backup-${new Date().toISOString().split('T')[0]}.db`,
              filters: [{ name: 'Database Files', extensions: ['db'] }]
            });
            if (filePath) {
              mainWindow?.webContents.send('backup-database', filePath);
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About TransTrack',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About TransTrack',
              message: `TransTrack v${APP_INFO.version}`,
              detail: `${APP_INFO.description}\n\nDesign alignment: ${APP_INFO.designAlignment.join(', ')}\n\nNote: Alignment statements describe product design controls only and are not certifications.\n\n© 2026 TransTrack Medical Software`
            });
          }
        },
        {
          label: 'Compliance Information',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Compliance & Design Alignment',
              message: 'Regulatory Design Alignment',
              detail: 'TransTrack is architected to support controls required by:\n\n• HIPAA Security Rule (45 CFR §164.308 / .310 / .312)\n• 21 CFR Part 11 - Electronic Records and Signatures\n• AATB - American Association of Tissue Banks Standards\n\nAll patient data is stored locally with AES-256 encryption. Audit trails are immutable and enforced at the database trigger level.\n\nNOTE: These are design-control statements, not certifications. SOC 2, HITRUST, 21 CFR Part 11 validation and any FDA determinations must be performed by the deploying organization with qualified auditors.'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'View Audit Logs',
          click: () => mainWindow?.webContents.send('view-audit-logs')
        }
      ]
    }
  ];

  // Only add devtools menu item in true unpackaged development
  if (isDev && !app.isPackaged && process.env.ELECTRON_DEV === '1') {
    template[2].submenu.push(
      { type: 'separator' },
      { role: 'toggleDevTools' }
    );
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Auto-update

/**
 * Establish that an update cannot be installed without a valid code signature.
 *
 * electron-updater does not verify signatures because it is asked to: it does so
 * because the packaged application carries the configuration that makes it
 * possible. On Windows that configuration is `win.verifyUpdateCodeSignature`,
 * which causes electron-builder to write a `publisherName` into the packaged
 * `app-update.yml`; NsisUpdater compares the downloaded installer's Authenticode
 * publisher against that list and refuses to run it on a mismatch. With no
 * publisherName the check is skipped entirely and a compromised or spoofed feed
 * can serve an arbitrary installer that the app will execute with the
 * privileges of whoever is applying the update.
 *
 * macOS does not need an equivalent: Squirrel.Mac requires the update to be
 * signed by the same team identifier as the running application, enforced by the
 * OS. Linux AppImage/deb updates are verified by the distribution channel.
 *
 * So this asserts the two properties that are actually load-bearing here — the
 * build is packaged (an unpackaged build has no signature to compare against),
 * and on Windows the publisher name is present — and reports what it found. The
 * caller refuses to register the download and install channels when it fails,
 * which leaves the site on its current, working version: the safe outcome.
 *
 * @returns {{ ok: boolean, checks: object, problems: string[] }}
 */
function verifyUpdaterSignatureConfiguration() {
  const problems = [];
  const checks = { packaged: Boolean(app.isPackaged), platform: process.platform };

  if (!checks.packaged) {
    problems.push('build is not packaged, so there is no code signature to verify against');
  }

  if (process.platform === 'win32' && checks.packaged) {
    try {
      const fs = require('fs');
      const configPath = path.join(process.resourcesPath, 'app-update.yml');
      const config = fs.readFileSync(configPath, 'utf8');
      // A bare line-scan rather than a YAML dependency: the only question is
      // whether electron-builder emitted the key at all.
      checks.publisherNameConfigured = /^\s*publisherName\s*:/m.test(config);
      if (!checks.publisherNameConfigured) {
        problems.push(
          'app-update.yml has no publisherName, so NsisUpdater will not check the ' +
          'installer signature (set win.verifyUpdateCodeSignature in the builder config)'
        );
      }
    } catch (readErr) {
      checks.publisherNameConfigured = false;
      problems.push(`could not read app-update.yml to confirm signature verification: ${readErr.message}`);
    }
  }

  return { ok: problems.length === 0, checks, problems };
}

function initAutoUpdater() {
  try {
    const { autoUpdater } = require('electron-updater');

    autoUpdater.logger = {
      info: (msg) => logger.info(`[AutoUpdater] ${msg}`),
      warn: (msg) => logger.warn(`[AutoUpdater] ${msg}`),
      error: (msg) => logger.error(`[AutoUpdater] ${msg}`),
    };
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      logger.info('Update available', { version: info.version });
      if (mainWindow) {
        mainWindow.webContents.send('update:available', {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.info('Update downloaded', { version: info.version });
      if (mainWindow) {
        mainWindow.webContents.send('update:downloaded', { version: info.version });
      }
    });

    autoUpdater.on('error', (err) => {
      logger.error('Auto-update error', { error: err.message });
    });

    const signatureConfig = verifyUpdaterSignatureConfiguration();

    // Applying an update replaces the executable that holds the encryption key
    // and serves PHI, so it is an administrator action. All three channels were
    // registered with no session check at all, which meant a compromised
    // renderer could trigger a download and a restart-into-installer without
    // any account being signed in.
    ipcMain.handle('update:check', async () => {
      shared.requireAdmin('checking for application updates');
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo || null;
    });

    ipcMain.handle('update:download', async () => {
      const currentUser = shared.requireAdmin('downloading an application update');
      if (!signatureConfig.ok) {
        // FAIL CLOSED: without signature verification the downloaded installer
        // is whatever the feed served. Staying on the current version is the
        // safe failure.
        throw new Error(
          `Update download refused: signature verification is not configured (${signatureConfig.problems.join('; ')})`
        );
      }
      logger.info('Update download authorised', { by: currentUser.email });
      await autoUpdater.downloadUpdate();
      return { success: true };
    });

    ipcMain.handle('update:install', () => {
      const currentUser = shared.requireAdmin('installing an application update');
      if (!signatureConfig.ok) {
        throw new Error(
          `Update install refused: signature verification is not configured (${signatureConfig.problems.join('; ')})`
        );
      }
      logger.info('Update install authorised', { by: currentUser.email });
      autoUpdater.quitAndInstall(false, true);
    });

    if (!signatureConfig.ok) {
      // Never install something we cannot attribute, including on quit.
      autoUpdater.autoInstallOnAppQuit = false;
      logger.error('Auto-update installs disabled: signature verification is not configured', {
        checks: signatureConfig.checks,
        problems: signatureConfig.problems,
      });
    }

    // Background checks only ever surface an availability notice; downloading
    // and installing stay behind the administrator-gated channels above.
    const initialCheck = setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 30000);
    const periodicCheck = setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);

    logger.info('Auto-updater initialized', {
      signatureVerification: signatureConfig.ok ? 'enforced' : 'unavailable',
    });

    // Returned so the schedule can be stopped; the app itself never needs to,
    // but nothing that starts a timer should be impossible to stop.
    return {
      signatureConfig,
      stopScheduledChecks: () => {
        clearTimeout(initialCheck);
        clearInterval(periodicCheck);
      },
    };
  } catch (err) {
    logger.warn('Auto-updater not available (expected in dev)', { error: err.message });
    return null;
  }
}

// App lifecycle
// Defense in depth: apply the same restrictions to every WebContents that is
// ever created, including ones this file does not construct directly.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (attachEvent) => {
    attachEvent.preventDefault();
    logger.warn('Blocked webview attach on new WebContents');
  });
  contents.setWindowOpenHandler(({ url }) => {
    logger.warn('Blocked popup window on new WebContents', { url });
    return { action: 'deny' };
  });
});

app.whenReady().then(async () => {
  initCrashReporter();
  hardenSession(session.defaultSession);
  logger.info('TransTrack starting...', {
    isDev,
    apiUrl: process.env.TRANSTRACK_API_URL || process.env.VITE_TRANSTRACK_API_URL || '(none — local IPC)',
  });

  // Splash has no preload bridge — skip it in E2E so Playwright always
  // attaches to the main window that exposes electronAPI.
  const skipSplash = process.env.NODE_ENV === 'test' || process.env.TRANSTRACK_E2E === '1';
  if (!skipSplash) {
    createSplashWindow();
  }

  try {
    await initDatabase();
    logger.info('Database initialized');

    setupIPCHandlers();
    logger.info('IPC handlers registered');

    // Detective control: report tampering with the security-critical main
    // process files. Never fatal — see services/integrityMonitor.cjs.
    try {
      const integrityMonitor = require('./services/integrityMonitor.cjs');
      const integrity = integrityMonitor.initializeIntegrityMonitor();
      if (integrity.status === 'ok') {
        logger.info('Application integrity verified', { checked: integrity.checked });
      } else if (integrity.baselineCreated) {
        logger.info('Application integrity baseline established', { checked: integrity.checked });
      } else {
        logger.error('Application integrity check reported drift', {
          status: integrity.status,
          reason: integrity.reason || null,
          modified: integrity.modified,
          missing: integrity.missing,
          added: integrity.added,
        });
      }
    } catch (integrityErr) {
      logger.warn('Integrity monitor unavailable', { error: integrityErr.message });
    }

    // Detective control: replay the audit hash chain for every organization.
    // A break is historical by the time we see it, so blocking startup would
    // only deny the site the tool it needs to investigate — but it is a
    // reportable integrity incident, so it is logged at error level and
    // surfaced by healthCheck as a degraded state rather than passing quietly.
    try {
      const auditChain = require('./services/auditChain.cjs');
      const chain = auditChain.verifyAllOrganizations();
      if (chain.ok) {
        logger.info('Audit chain verified', {
          organizations: chain.organizationsChecked,
          rows: chain.rowsVerified,
        });
      } else {
        logger.error('AUDIT CHAIN INTEGRITY FAILURE — the audit trail has been altered', {
          organizations: chain.organizationsChecked,
          broken: chain.broken,
        });
      }
    } catch (chainErr) {
      logger.error('Audit chain verification could not run', { error: chainErr.message });
    }

    // Treat an OS screen lock or suspend as an immediate end of session, so a
    // live authenticated session never sits behind a workstation lock screen.
    try {
      const screenLock = require('./services/screenLock.cjs');
      const lockStatus = screenLock.initializeScreenLock({ getMainWindow: () => mainWindow });
      if (lockStatus.enabled) {
        logger.info('Screen lock session control active', { events: lockStatus.events });
      } else {
        logger.warn('Screen lock session control inactive', { reason: lockStatus.reason });
      }
    } catch (lockErr) {
      logger.warn('Screen lock integration unavailable', { error: lockErr.message });
    }

    // Start automated backup schedule
    try {
      const { startAutoBackupSchedule } = require('./services/disasterRecovery.cjs');
      startAutoBackupSchedule();
    } catch (backupErr) {
      logger.error('Failed to start automated backup schedule', { error: backupErr.message });
    }

    if (app.isPackaged) {
      initAutoUpdater();
    }

    createMenu();
    createMainWindow();
  } catch (error) {
    logger.fatal('Failed to initialize application', { error: error.message, stack: error.stack });
    // Modal error boxes hang forever under xvfb/Playwright — never block E2E.
    if (process.env.NODE_ENV !== 'test' && process.env.TRANSTRACK_E2E !== '1') {
      dialog.showErrorBox('Startup Error', `Failed to initialize TransTrack: ${error.message}`);
    }
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS protocol handler: the OS hands us the URL via `open-url`.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

// Windows/Linux: a second `transtrack://...` invocation lands here.
app.on('second-instance', (_event, argv /*, _workingDir */) => {
  // The protocol URL is somewhere in argv on Windows; scan defensively.
  const url = argv.find((a) => typeof a === 'string' && a.startsWith(`${TRANSTRACK_PROTOCOL}://`));
  if (url) handleProtocolUrl(url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/**
 * Centralized protocol-URL dispatcher. Currently the only registered
 * scheme is `transtrack://auth/callback` for OIDC SSO; add new ones
 * here as needed.
 */
async function handleProtocolUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== `${TRANSTRACK_PROTOCOL}:`) return;
    if (u.host === 'auth' && u.pathname === '/callback') {
      const oidc = require('./auth/oidcDesktop.cjs');
      const identity = await oidc.completeFlow(url);
      // Hand off to the auth handler module to find/create the matching
      // local user and mint a session.
      const ssoHandler = require('./ipc/handlers/ssoCallback.cjs');
      const sessionInfo = await ssoHandler.finalizeSso(identity);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:ssoCompleted', { ok: true, ...sessionInfo });
      }
      return;
    }
    logger.warn('Unhandled protocol URL', { url });
  } catch (err) {
    logger.error('Protocol URL handler failed', { error: err.message });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:ssoCompleted', { ok: false, error: err.message });
    }
  }
}

// Fail-closed: log uncaught exceptions and exit immediately.
process.on('uncaughtException', (err) => {
  try { logger.fatal('Uncaught exception — exiting', { error: err.message, stack: err.stack }); } catch { /* ignore */ }
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  try { logger.error('Unhandled promise rejection', { reason: String(reason) }); } catch { /* ignore */ }
});

app.on('before-quit', async () => {
  logger.info('Application shutting down...');
  try {
    const { stopAutoBackupSchedule } = require('./services/disasterRecovery.cjs');
    stopAutoBackupSchedule();
  } catch { /* ignore */ }
  await closeDatabase();
  closeLogger();
});

// Security: Handle certificate errors
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(false);
});

// Export for testing
module.exports = { APP_INFO, initAutoUpdater, verifyUpdaterSignatureConfiguration };
