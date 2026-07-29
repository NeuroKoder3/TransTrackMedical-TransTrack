'use strict';
/**
 * Launch Electron with remote-API env defaults for local Epic development.
 * Used by `npm run dev:electron` so TRANSTRACK_API_URL is never lost on Windows.
 */
const { spawn } = require('child_process');
const electron = require('electron');

process.env.ELECTRON_DEV = process.env.ELECTRON_DEV || '1';
process.env.TRANSTRACK_API_URL =
  process.env.TRANSTRACK_API_URL || 'http://localhost:8080';
process.env.VITE_TRANSTRACK_API_URL =
  process.env.VITE_TRANSTRACK_API_URL || process.env.TRANSTRACK_API_URL;

console.log('[electron-dev-remote] TRANSTRACK_API_URL=', process.env.TRANSTRACK_API_URL);

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
