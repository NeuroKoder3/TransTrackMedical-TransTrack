/**
 * TransTrack - Structured Error Logger
 *
 * Provides structured JSON logging with request IDs for all IPC handlers.
 * Logs are written to disk for compliance audit trail and stored in a
 * rotating file structure under the app's userData directory.
 *
 * HIPAA 164.312(b) - Audit Controls
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB per log file
const MAX_LOG_FILES = 30; // Keep 30 rotated files

const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'ssn', 'social_security',
  'credit_card', 'api_key', 'token', 'secret', 'encryption_key',
]);

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFilePath() {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `transtrack-${date}.log`);
}

function rotateIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size < MAX_LOG_SIZE) return;

    const rotatedPath = `${filePath}.${Date.now()}`;
    fs.renameSync(filePath, rotatedPath);

    // Clean up old rotated files
    const logFiles = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log') || f.includes('.log.'))
      .map(f => ({ name: f, path: path.join(LOG_DIR, f), mtime: fs.statSync(path.join(LOG_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    for (let i = MAX_LOG_FILES; i < logFiles.length; i++) {
      try { fs.unlinkSync(logFiles[i].path); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore rotation errors */ }
}

function redactSensitive(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redactSensitive);

  const redacted = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      redacted[key] = redactSensitive(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function writeLog(entry) {
  try {
    ensureLogDir();
    const filePath = getLogFilePath();
    rotateIfNeeded(filePath);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  } catch (_) {
    // Fallback to console if file write fails
    console.error('[LOG WRITE FAILED]', JSON.stringify(entry));
  }
}

function generateRequestId() {
  return crypto.randomUUID();
}

function createLogger(context) {
  return {
    info(message, data) {
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        context,
        message,
        ...redactSensitive(data || {}),
      };
      writeLog(entry);
    },

    warn(message, data) {
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'WARN',
        context,
        message,
        ...redactSensitive(data || {}),
      };
      writeLog(entry);
      console.warn(`[${context}] ${message}`);
    },

    error(message, error, data) {
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        context,
        message,
        error_message: error instanceof Error ? error.message : String(error || ''),
        error_stack: error instanceof Error ? error.stack : undefined,
        ...redactSensitive(data || {}),
      };
      writeLog(entry);
      console.error(`[${context}] ${message}:`, error instanceof Error ? error.message : error);
    },

    audit(action, details) {
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'AUDIT',
        context,
        action,
        ...redactSensitive(details || {}),
      };
      writeLog(entry);
    },
  };
}

/**
 * Wrap an IPC handler with structured error logging and request ID tracking.
 *
 * @param {string} handlerName - Name of the IPC channel
 * @param {Function} handler - The actual handler function
 * @returns {Function} Wrapped handler
 */
function wrapHandler(handlerName, handler) {
  const log = createLogger(handlerName);

  return async (...args) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const result = await handler(...args);
      log.info('Handler completed', {
        request_id: requestId,
        duration_ms: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      log.error('Handler failed', error, {
        request_id: requestId,
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  };
}

module.exports = {
  generateRequestId,
  createLogger,
  wrapHandler,
  LOG_DIR,
};
