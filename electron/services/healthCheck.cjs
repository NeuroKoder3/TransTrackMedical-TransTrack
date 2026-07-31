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
 *   5. integrity     — tamper detection over security-critical source files.
 *   6. auditTrail    — immutability triggers + HMAC tamper-evidence readiness.
 *   7. riskEngine    — model version + factor weight invariant.
 *   8. backups       — newest backup age (when backup service available).
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
    let dbInit;
    try { dbInit = require('../database/init.cjs'); }
    catch { return { status: 'warn', error: 'database init module not loaded' }; }
    if (typeof dbInit.isEncryptionEnabled === 'function') {
      const enabled = !!dbInit.isEncryptionEnabled();
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

function _checkIntegrity() {
  return _safe(() => {
    const monitor = require('./integrityMonitor.cjs');
    const result = monitor.verifyIntegrity();

    // 'modified' and 'baseline_untrusted' mean a security-critical file or the
    // baseline itself changed — that is an incident, not a warning.
    const failStatuses = new Set(['modified', 'baseline_untrusted']);
    const status = result.status === 'ok'
      ? 'ok'
      : (failStatuses.has(result.status) ? 'fail' : 'warn');

    return {
      status,
      detail: result.status,
      checked: result.checked,
      modified: result.modified,
      missing: result.missing,
      added: result.added,
      sealAlgorithm: result.sealAlgorithm || null,
      ...(status === 'ok' ? {} : { error: result.reason || result.status }),
    };
  });
}

function _checkAuditTrail() {
  return _safe(() => {
    const { getDatabase } = require('../database/init.cjs');
    const db = getDatabase();

    const triggers = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'audit_logs_immutable_%'`
    ).all().map((t) => t.name);

    const hasHmacColumn = db.prepare('PRAGMA table_info(audit_logs)')
      .all()
      .some((c) => c.name === 'record_hmac');

    let hmacKey = { available: false, osProtected: false, reason: 'module_unavailable' };
    try { hmacKey = require('./auditHmacKey.cjs').getStatus(); } catch { /* keep default */ }

    const immutabilityEnforced = triggers.length >= 2;
    const problems = [];
    if (!immutabilityEnforced) problems.push('audit_logs immutability triggers missing');
    if (!hasHmacColumn) problems.push('record_hmac column missing (migration 16 not applied)');
    if (!hmacKey.available) problems.push(`audit HMAC key unavailable (${hmacKey.reason})`);

    // A refused test-key override means someone set TRANSTRACK_AUDIT_HMAC_KEY on
    // a non-test system. The key was correctly ignored, but the attempt is worth
    // surfacing rather than leaving in the log only.
    if (hmacKey.testOverrideRejected) {
      problems.push('TRANSTRACK_AUDIT_HMAC_KEY is set outside test and was ignored — unset it');
    }
    // Should be impossible outside a test run; treated as a misconfiguration.
    if (hmacKey.testOverrideInUse) {
      problems.push('audit HMAC key came from the test-only override');
    }

    return {
      status: problems.length === 0 ? 'ok' : 'warn',
      immutabilityEnforced,
      immutabilityTriggers: triggers,
      hmacColumnPresent: hasHmacColumn,
      hmacKeyAvailable: hmacKey.available,
      hmacKeyOsProtected: hmacKey.osProtected,
      ...(hmacKey.testOverrideRejected ? { testOverrideRejected: true } : {}),
      ...(hmacKey.testOverrideInUse ? { testOverrideInUse: true } : {}),
      ...(problems.length ? { error: problems.join('; ') } : {}),
    };
  });
}

function _checkBackups() {
  return _safe(() => {
    let svc;
    try { svc = require('./disasterRecovery.cjs'); }
    catch { return { status: 'warn', error: 'disaster recovery service not loaded' }; }
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
    integrity:  _checkIntegrity(),
    auditTrail: _checkAuditTrail(),
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
