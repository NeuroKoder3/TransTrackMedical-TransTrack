/**
 * TransTrack - Structured Logger & Crash Reporter
 *
 * Provides JSON-structured log output that persists to a rotating log file
 * in userData. In production Electron builds, console output is invisible;
 * this logger writes to disk so crashes and errors can be diagnosed.
 *
 * Also registers Electron's crashReporter for native crash minidumps.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app, crashReporter } = require('electron');

const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_LOG_FILES = 5;

let logStream = null;
let logDir = null;

function getLogDir() {
  if (logDir) return logDir;
  logDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function getLogFilePath() {
  return path.join(getLogDir(), 'transtrack.log');
}

function rotateIfNeeded() {
  const logPath = getLogFilePath();
  try {
    if (!fs.existsSync(logPath)) return;
    const stats = fs.statSync(logPath);
    if (stats.size < MAX_LOG_SIZE_BYTES) return;

    // Rotate: shift existing logs
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const older = `${logPath}.${i}`;
      const newer = i === 1 ? logPath : `${logPath}.${i - 1}`;
      if (fs.existsSync(newer)) {
        fs.renameSync(newer, older);
      }
    }
  } catch {
    // Non-fatal
  }
}

function ensureStream() {
  if (logStream) return logStream;
  rotateIfNeeded();
  logStream = fs.createWriteStream(getLogFilePath(), { flags: 'a' });
  return logStream;
}

function formatEntry(level, message, meta = {}) {
  return JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg: message,
    pid: process.pid,
    ...meta,
  }) + '\n';
}

function write(level, message, meta) {
  const entry = formatEntry(level, message, meta);
  try {
    ensureStream().write(entry);
  } catch {
    // Last resort — stdout
    process.stdout.write(entry);
  }
  // Mirror to console in dev
  if (!app.isPackaged) {
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`[${level.toUpperCase()}] ${message}`, meta && Object.keys(meta).length ? meta : '');
  }
}

const logger = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  fatal: (msg, meta) => write('fatal', msg, meta),
};

function initCrashReporter() {
  crashReporter.start({
    productName: 'TransTrack',
    companyName: 'TransTrack Medical Software',
    submitURL: '', // No remote submission — minidumps stored locally
    uploadToServer: false,
    compress: true,
  });

  // Capture unhandled exceptions and rejections
  process.on('uncaughtException', (err) => {
    logger.fatal('Uncaught exception', { error: err.message, stack: err.stack });
    // Attempt to flush before crashing
    try { logStream?.end(); } catch { /* best effort */ }
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error('Unhandled promise rejection', { error: msg, stack });
  });

  logger.info('Crash reporter initialized', {
    crashDumpsDir: app.getPath('crashDumps'),
  });
}

function closeLogger() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

module.exports = {
  logger,
  initCrashReporter,
  closeLogger,
  getLogDir,
};
