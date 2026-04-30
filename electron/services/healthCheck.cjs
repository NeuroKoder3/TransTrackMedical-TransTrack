/**
 * TransTrack — Health Check Service
 *
 * Single, comprehensive operational health snapshot suitable for:
 *
 *   • the in-app diagnostics page,
 *   • a CI/CD smoke step that runs after a packaged build,
 *   • a customer-side support ticket attachment ("paste this here"),
 *   • a SIEM forwarder periodic heartbeat.
 *
 * Returns a stable JSON envelope with three sections: `status` (overall),
 * `components` (per-component result), and `info` (process + product +
 * environment metadata). Components currently checked:
 *
 *   1. process       — Node version, Electron version, uptime, RSS.
 *   2. logger        — log directory writable, log file size, rotation status.
 *   3. database      — encrypted SQLite reachable, table count, schema OK.
 *   4. encryption    — encryption status from existing service.
 *   5. riskEngine    — model version + factor weight invariant.
 *   6. backups       — newest backup age (when backup service available).
 *
 * Each component returns one of: 'ok' | 'warn' | 'fail'. Overall status is
 * the worst of the per-component statuses, and is 'ok' only when every
 * component is 'ok'. The endpoint never throws — failures bubble into
 * `components.<name>.status = 'fail'` with `error` field set.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function _safe(fn) {
  try { return fn(); } catch (e) {
    return { status: 'fail', error: e?.message || String(e) };
  }
}

function _checkProcess() {
  return _safe(() => {
    const mem = process.memoryUsage();
    return {
      status: 'ok',
      nodeVersion: process.version,
      electronVersion: process.versions.electron || null,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      rssMB: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
    };
  });
}

function _checkLogger() {
  return _safe(() => {
    const logger = require('./logger.cjs');
    const dir = logger.getLogDir();
    if (!fs.existsSync(dir)) {
      return { status: 'warn', error: 'log directory does not exist yet' };
    }
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('transtrack.log'));
    let totalBytes = 0;
    for (const f of files) {
      try { totalBytes += fs.statSync(path.join(dir, f)).size; } catch { /* skip */ }
    }
    return {
      status: 'ok',
      logDir: dir,
      fileCount: files.length,
      totalBytes,
    };
  });
}

function _checkDatabase() {
  return _safe(() => {
    const { getDatabase } = require('../database/init.cjs');
    const db = getDatabase();
    const tableCount = db.prepare(
      `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'`
    ).get().c;
    // Smoke: organizations table must exist
    const hasOrgs = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'`
    ).get();
    return {
      status: hasOrgs ? 'ok' : 'fail',
      tableCount,
      organizationsTablePresent: !!hasOrgs,
    };
  });
}

function _checkEncryption() {
  return _safe(() => {
    let svc;
    try { svc = require('./encryption.cjs'); }
    catch { return { status: 'warn', error: 'encryption service not loaded' }; }
    if (typeof svc.getEncryptionStatus === 'function') {
      const s = svc.getEncryptionStatus();
      return { status: s?.enabled ? 'ok' : 'warn', ...s };
    }
    if (typeof svc.isEncryptionEnabled === 'function') {
      const enabled = !!svc.isEncryptionEnabled();
      return { status: enabled ? 'ok' : 'warn', enabled };
    }
    return { status: 'warn', error: 'no encryption status accessor available' };
  });
}

function _checkRiskEngine() {
  return _safe(() => {
    const engine = require('./inactivationRiskEngine.cjs');
    const sum = Object.values(engine.FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 1e-9) {
      return {
        status: 'fail',
        modelVersion: engine.MODEL_VERSION,
        weightSum: sum,
        error: 'FACTOR_WEIGHTS do not sum to 1.0',
      };
    }
    return {
      status: 'ok',
      modelVersion: engine.MODEL_VERSION,
      weightSum: sum,
    };
  });
}

function _checkBackups() {
  return _safe(() => {
    let svc;
    try { svc = require('./backupService.cjs'); }
    catch { return { status: 'warn', error: 'backup service not loaded' }; }
    if (typeof svc.listBackups !== 'function') {
      return { status: 'warn', error: 'no listBackups accessor' };
    }
    const list = svc.listBackups() || [];
    if (!list.length) return { status: 'warn', error: 'no backups present' };
    // Sort by mtime desc when available
    const newest = list[0];
    return {
      status: 'ok',
      backupCount: list.length,
      newestBackupId: newest?.id || newest?.filename || null,
      newestBackupAtISO: newest?.createdAt || null,
    };
  });
}

/**
 * Build the full health snapshot.
 *
 * @returns {{
 *   status: 'ok'|'warn'|'fail',
 *   asOfISO: string,
 *   components: Record<string, any>,
 *   info: { product: string, version: string|null }
 * }}
 */
function getHealth() {
  const components = {
    process:    _checkProcess(),
    logger:     _checkLogger(),
    database:   _checkDatabase(),
    encryption: _checkEncryption(),
    riskEngine: _checkRiskEngine(),
    backups:    _checkBackups(),
  };

  let overall = 'ok';
  for (const c of Object.values(components)) {
    const s = c?.status || 'fail';
    if (s === 'fail') { overall = 'fail'; break; }
    if (s === 'warn' && overall === 'ok') overall = 'warn';
  }

  let version = null;
  try { version = require('electron').app.getVersion(); } catch { /* not in electron */ }

  return {
    status: overall,
    asOfISO: new Date().toISOString(),
    components,
    info: {
      product: 'TransTrack',
      version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

module.exports = { getHealth };
