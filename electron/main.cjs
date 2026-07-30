// Main process entry point

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { initDatabase, closeDatabase } = require('./database/init.cjs');
const { setupIPCHandlers } = require('./ipc/handlers.cjs');
const { logger, initCrashReporter, closeLogger } = require('./services/logger.cjs');

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

// Single-instance lock — on Windows/Linux the second app launch triggered
// by `transtrack://...` is delivered to the first instance via the
// second-instance event below; without this lock, both would race.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

// Security hardening — OutOfBlinkCors intentionally NOT disabled

let mainWindow = null;
let splashWindow = null;

// Production check - detect dev mode by checking if app is packaged or if ELECTRON_DEV is set
// NODE_ENV=test is used by E2E tests to load dist/index.html without a dev server
const isDev = process.env.NODE_ENV !== 'test' &&
  (!app.isPackaged || process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === '1');

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

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
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
    show: false,
    title: 'TransTrack - Transplant Waitlist Management',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.cjs'),
      // Security settings
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
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

    const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
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

    ipcMain.handle('update:check', async () => {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo || null;
    });

    ipcMain.handle('update:download', async () => {
      await autoUpdater.downloadUpdate();
      return { success: true };
    });

    ipcMain.handle('update:install', () => {
      autoUpdater.quitAndInstall(false, true);
    });

    // Check for updates 30s after launch, then every 4 hours
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 30000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);

    logger.info('Auto-updater initialized');
  } catch (err) {
    logger.warn('Auto-updater not available (expected in dev)', { error: err.message });
  }
}

// App lifecycle
app.whenReady().then(async () => {
  initCrashReporter();
  logger.info('TransTrack starting...', {
    isDev,
    apiUrl: process.env.TRANSTRACK_API_URL || process.env.VITE_TRANSTRACK_API_URL || '(none — local IPC)',
  });

  createSplashWindow();

  try {
    await initDatabase();
    logger.info('Database initialized');

    setupIPCHandlers();
    logger.info('IPC handlers registered');

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
    dialog.showErrorBox('Startup Error', `Failed to initialize TransTrack: ${error.message}`);
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
module.exports = { APP_INFO };
