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

// ---------------------------------------------------------------------------
// Optional remote sink (Sentry-style POST). Activated by env var SENTRY_DSN
// (or TRANSTRACK_REMOTE_LOG_URL for self-hosted SIEM-bridge endpoints). If
// unset, the logger is purely local-disk and behaves exactly as before.
//
// We do NOT take a hard dependency on @sentry/electron — adding a heavy
// runtime dep to a HIPAA-aligned medical app is a deliberate decision the
// deploying organisation should opt into, and Sentry's own SDK requires a
// BAA before being used with PHI. This hook keeps the app vendor-neutral
// and ships any payloads via plain fetch with no PHI in the body (only
// level + message + meta keys the caller passed in).
// ---------------------------------------------------------------------------
const REMOTE_LOG_URL =
  process.env.SENTRY_DSN || process.env.TRANSTRACK_REMOTE_LOG_URL || null;
const REMOTE_LOG_LEVELS = new Set(
  (process.env.TRANSTRACK_REMOTE_LOG_LEVELS || 'error,fatal')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);

const SAFE_META_KEYS = new Set(['error', 'code', 'component', 'action', 'duration']);
const MAX_REMOTE_MSG_LEN = 256;

function _buildRemotePayload(level, message, meta) {
  const safeMsg = typeof message === 'string'
    ? message.slice(0, MAX_REMOTE_MSG_LEN)
    : String(message || '').slice(0, MAX_REMOTE_MSG_LEN);

  const safeMeta = {};
  if (meta && typeof meta === 'object') {
    for (const key of Object.keys(meta)) {
      if (!SAFE_META_KEYS.has(key)) continue;
      const val = meta[key];
      if (typeof val === 'string') safeMeta[key] = val.slice(0, 128);
      else if (typeof val === 'number' || typeof val === 'boolean') safeMeta[key] = val;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    level: String(level),
    message: safeMsg,
    meta: Object.keys(safeMeta).length > 0 ? safeMeta : undefined,
    product: 'TransTrack',
    platform: process.platform,
    pid: process.pid,
  };
}

function _shipRemote(level, message, meta) {
  if (!REMOTE_LOG_URL || !REMOTE_LOG_LEVELS.has(level)) return;
  if (typeof fetch !== 'function') return;
  // Fire-and-forget; never throw out of the logger.
  try {
    const payload = _buildRemotePayload(level, message, meta);
    fetch(REMOTE_LOG_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* swallow */ });
  } catch { /* swallow */ }
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
  _shipRemote(level, message, meta);
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
