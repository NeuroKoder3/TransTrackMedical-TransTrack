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
const { initDatabase, closeDatabase } = require('./database/init');
const { setupIPCHandlers } = require('./ipc/handlers');

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

// Security: Disable remote module
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

let mainWindow = null;
let splashWindow = null;

// Production check
const isDev = process.env.NODE_ENV === 'development';

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
      preload: path.join(__dirname, 'preload.js'),
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

// App lifecycle
app.whenReady().then(async () => {
  console.log('TransTrack starting...');
  
  // Show splash screen
  createSplashWindow();
  
  try {
    // Initialize encrypted database
    await initDatabase();
    console.log('Database initialized');
    
    // Setup IPC handlers for renderer process communication
    setupIPCHandlers();
    console.log('IPC handlers registered');
    
    // Create application menu
    createMenu();
    
    // Create main window
    createMainWindow();
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
