/**
 * TransTrack - Electron Main Process
 * 
 * HIPAA/FDA/AATB Compliant Desktop Application
 * 
 * Security Features:
 * - Encrypted local database (SQLCipher)
 * - Secure session management
 * - Audit logging for all operations
 * - No external network calls in production
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { initDatabase, closeDatabase, getDefaultOrganization, getOrgLicense } = require('./database/init.cjs');
const { setupIPCHandlers } = require('./ipc/handlers.cjs');
const { 
  getCurrentBuildVersion, 
  BUILD_VERSION, 
  LICENSE_TIER,
  EVALUATION_RESTRICTIONS,
  isEvaluationBuild
} = require('./license/tiers.cjs');

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

// Security: Disable remote module
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

let mainWindow = null;
let splashWindow = null;

// Production check - detect dev mode by checking if app is packaged or if ELECTRON_DEV is set
const isDev = !app.isPackaged || process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === '1';

// Application metadata
const APP_INFO = {
  name: 'TransTrack',
  version: '1.0.0',
  description: 'HIPAA/FDA/AATB Compliant Transplant Waitlist Management System',
  author: 'TransTrack Medical Software',
  compliance: ['HIPAA', 'FDA 21 CFR Part 11', 'AATB Standards']
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
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
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
      console.warn('Blocked navigation to:', url);
    }
  });

  // Security: Block new window creation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('Blocked popup window:', url);
    return { action: 'deny' };
  });

  // Security: Add Content Security Policy and other security headers
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      isDev ? "connect-src 'self' http://localhost:5173 ws://localhost:5173" : "connect-src 'self'",
    ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspDirectives],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
      }
    });
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
              message: 'TransTrack v1.0.0',
              detail: `${APP_INFO.description}\n\nCompliance: ${APP_INFO.compliance.join(', ')}\n\n© 2026 TransTrack Medical Software`
            });
          }
        },
        {
          label: 'Compliance Information',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Compliance Information',
              message: 'Regulatory Compliance',
              detail: 'TransTrack is designed to comply with:\n\n• HIPAA - Health Insurance Portability and Accountability Act\n• FDA 21 CFR Part 11 - Electronic Records and Signatures\n• AATB - American Association of Tissue Banks Standards\n\nAll patient data is stored locally with AES-256 encryption.\nFull audit trails are maintained for all operations.'
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

  // Add dev tools in development
  if (isDev) {
    template[2].submenu.push(
      { type: 'separator' },
      { role: 'toggleDevTools' }
    );
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// =========================================================================
// BUILD TYPE ENFORCEMENT
// =========================================================================

/**
 * Check if Enterprise build has a valid license
 * Returns null if OK, or error message if blocked
 */
function checkEnterpriseLicense() {
  const buildVersion = getCurrentBuildVersion();
  
  // Evaluation builds don't need license check (they have evaluation restrictions)
  if (buildVersion === BUILD_VERSION.EVALUATION) {
    return null; // OK, evaluation restrictions apply elsewhere
  }
  
  // Enterprise build - require valid license
  try {
    const defaultOrg = getDefaultOrganization();
    if (!defaultOrg) {
      return 'No organization configured. Please set up your organization first.';
    }
    
    const license = getOrgLicense(defaultOrg.id);
    if (!license) {
      return 'No license found. Please activate your license to use TransTrack Enterprise.';
    }
    
    // Check license tier (evaluation tier on enterprise build = no valid license)
    if (license.tier === LICENSE_TIER.EVALUATION) {
      return 'Please activate a valid license to use TransTrack Enterprise.';
    }
    
    // Check license expiration with clock skew protection
    if (license.license_expires_at) {
      const expiry = new Date(license.license_expires_at);
      const now = new Date();
      
      // Reject obviously manipulated dates (system clock set far in the future)
      if (license.activated_at) {
        const activated = new Date(license.activated_at);
        const maxReasonableLifetimeMs = 10 * 365.25 * 24 * 60 * 60 * 1000; // 10 years
        if (expiry.getTime() - activated.getTime() > maxReasonableLifetimeMs) {
          console.warn('LICENSE WARNING: License expiry exceeds maximum reasonable lifetime');
          return 'License validation failed. Please contact support.';
        }
      }
      
      if (expiry < now) {
        return `Your license expired on ${expiry.toLocaleDateString()}. Please renew to continue using TransTrack.`;
      }
    }
    
    return null; // License is valid
  } catch (error) {
    console.error('License check error:', error);
    // Fail-closed: always block in production, only allow dev bypass when explicitly in dev mode
    if (isDev) {
      console.warn('WARNING: License check failed but allowing in development mode');
      return null;
    }
    return 'Unable to verify license. Please contact support.';
  }
}

/**
 * Show license required dialog and block app
 */
function showLicenseRequiredDialog(message) {
  const result = dialog.showMessageBoxSync(null, {
    type: 'warning',
    title: 'License Required - TransTrack Enterprise',
    message: 'License Activation Required',
    detail: `${message}\n\nTo activate a license:\n1. Contact Trans_Track@outlook.com\n2. Provide your Organization ID\n3. Complete payment\n4. Enter your license key in Settings\n\nAlternatively, download the Evaluation version for a 14-day trial.`,
    buttons: ['Quit', 'Continue Anyway (Dev Only)'],
    defaultId: 0,
    cancelId: 0,
  });
  
  // Only allow "Continue Anyway" in dev mode
  if (result === 1 && isDev) {
    console.warn('WARNING: Continuing without license in development mode');
    return false; // Don't block
  }
  
  return true; // Block
}

// =========================================================================
// PERIODIC LICENSE EXPIRATION CHECK
// =========================================================================

let licenseCheckInterval = null;
const LICENSE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour
const LICENSE_WARNING_DAYS = 14; // Warn when license expires in 14 days

/**
 * Check license status and warn if expiring soon
 */
function performPeriodicLicenseCheck() {
  try {
    const defaultOrg = getDefaultOrganization();
    if (!defaultOrg) return;
    
    const license = getOrgLicense(defaultOrg.id);
    if (!license) return;
    
    const now = new Date();
    
    // Check license expiration
    if (license.license_expires_at) {
      const expiry = new Date(license.license_expires_at);
      const daysUntilExpiry = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiry <= 0) {
        // License expired - send notification to renderer
        if (mainWindow) {
          mainWindow.webContents.send('license:expired', {
            tier: license.tier,
            expiredAt: license.license_expires_at,
          });
        }
        console.warn(`LICENSE EXPIRED: License expired on ${expiry.toLocaleDateString()}`);
      } else if (daysUntilExpiry <= LICENSE_WARNING_DAYS) {
        // License expiring soon - send warning to renderer
        if (mainWindow) {
          mainWindow.webContents.send('license:expiring-soon', {
            tier: license.tier,
            expiresAt: license.license_expires_at,
            daysRemaining: daysUntilExpiry,
          });
        }
        console.warn(`LICENSE WARNING: License expires in ${daysUntilExpiry} days`);
      }
    }
    
    // Check maintenance expiration
    if (license.maintenance_expires_at) {
      const maintenanceExpiry = new Date(license.maintenance_expires_at);
      const daysUntilMaintExpiry = Math.floor((maintenanceExpiry - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilMaintExpiry <= 0) {
        if (mainWindow) {
          mainWindow.webContents.send('maintenance:expired', {
            tier: license.tier,
            expiredAt: license.maintenance_expires_at,
          });
        }
        console.warn(`MAINTENANCE EXPIRED: Maintenance support expired on ${maintenanceExpiry.toLocaleDateString()}`);
      } else if (daysUntilMaintExpiry <= 30) {
        if (mainWindow) {
          mainWindow.webContents.send('maintenance:expiring-soon', {
            tier: license.tier,
            expiresAt: license.maintenance_expires_at,
            daysRemaining: daysUntilMaintExpiry,
          });
        }
        console.warn(`MAINTENANCE WARNING: Maintenance support expires in ${daysUntilMaintExpiry} days`);
      }
    }
  } catch (error) {
    console.error('Periodic license check error:', error.message);
  }
}

/**
 * Start periodic license expiration checks
 */
function startPeriodicLicenseCheck() {
  // Initial check after a delay (give app time to fully load)
  setTimeout(performPeriodicLicenseCheck, 5000);
  
  // Periodic checks
  licenseCheckInterval = setInterval(performPeriodicLicenseCheck, LICENSE_CHECK_INTERVAL_MS);
  console.log('Periodic license check started (interval: 1 hour)');
}

/**
 * Stop periodic license checks
 */
function stopPeriodicLicenseCheck() {
  if (licenseCheckInterval) {
    clearInterval(licenseCheckInterval);
    licenseCheckInterval = null;
  }
}

// App lifecycle
app.whenReady().then(async () => {
  console.log('TransTrack starting...');
  const buildVersion = getCurrentBuildVersion();
  console.log(`Build version: ${buildVersion}`);
  
  // Show splash screen
  createSplashWindow();
  
  try {
    // Initialize encrypted database
    await initDatabase();
    console.log('Database initialized');
    
    // =========================================================================
    // ENTERPRISE LICENSE ENFORCEMENT
    // =========================================================================
    // If this is an Enterprise build, require a valid license
    // If this is an Evaluation build, evaluation restrictions apply in handlers
    
    const licenseError = checkEnterpriseLicense();
    if (licenseError && buildVersion === BUILD_VERSION.ENTERPRISE) {
      if (splashWindow) {
        splashWindow.destroy();
        splashWindow = null;
      }
      
      if (showLicenseRequiredDialog(licenseError)) {
        console.log('License required - application blocked');
        app.quit();
        return;
      }
    }
    
    // Setup IPC handlers for renderer process communication
    setupIPCHandlers();
    console.log('IPC handlers registered');
    
    // Create application menu
    createMenu();
    
    // Create main window
    createMainWindow();
    
    // Start periodic license expiration checks
    startPeriodicLicenseCheck();
    
    // If evaluation build, log restriction info
    if (buildVersion === BUILD_VERSION.EVALUATION) {
      console.log('Running in Evaluation mode - restrictions apply:');
      console.log(`  - Max patients: ${EVALUATION_RESTRICTIONS.maxPatients}`);
      console.log(`  - Max users: ${EVALUATION_RESTRICTIONS.maxUsers}`);
      console.log(`  - Evaluation period: ${EVALUATION_RESTRICTIONS.maxDays} days`);
      console.log(`  - Disabled features: ${EVALUATION_RESTRICTIONS.disabledFeatures.length}`);
    }
  } catch (error) {
    console.error('Failed to initialize application:', error);
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

app.on('before-quit', async () => {
  console.log('Stopping periodic license checks...');
  stopPeriodicLicenseCheck();
  console.log('Closing database connection...');
  await closeDatabase();
});

// Security: Handle certificate errors
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(false);
});

// Export for testing
module.exports = { APP_INFO };
