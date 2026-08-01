/**
 * TransTrack — support bundle exporter.
 *
 * WHY THIS EXISTS
 *
 * `docs/PILOT_DEPLOYMENT_RUNBOOK.md` tells a site administrator to collect
 * diagnostics when something is wrong, and the health-check service already
 * produces a thorough snapshot. But there was no way to get any of it off the
 * machine: an administrator had to be walked through opening
 * `%APPDATA%\TransTrack Enterprise\logs\` by hand, or through running an IPC
 * call in DevTools. At a hospital that is often not permitted, and it makes the
 * first support interaction of a pilot an awkward one.
 *
 * This produces one file, on request, that can be attached to a ticket.
 *
 * THE HARD REQUIREMENT: NO PHI
 *
 * A support bundle leaves the safeguarded environment by definition, so it must
 * contain no patient data. That shapes the design:
 *
 *   • Only aggregate counts are collected, never records. "412 patients" is
 *     useful for support; a patient list is never necessary.
 *   • Structured content is redacted by field name through
 *     services/phiRedaction.cjs, rather than trusted because callers are
 *     supposed to have been careful.
 *   • Assembly is a pure function (`assembleBundle`) taking already-collected
 *     inputs, so the no-PHI property can be tested directly by feeding it
 *     deliberately PHI-laden input and asserting none survives.
 *
 * WHY FREE TEXT IS OMITTED BY DEFAULT
 *
 * Field-name redaction handles `{ mrn: ... }`. It cannot handle
 * `"Failed to update patient Jane Quibblesworth"`, because a patient name in
 * prose is not distinguishable from any other capitalised words — there is no
 * pattern that catches names without also destroying every message. Pattern
 * matching gets emails, SSNs and phone numbers; it will never get names.
 *
 * So free text is not redacted, it is withheld. By default every free-text
 * field (log `message`, error strings, operator notes, backup descriptions) is
 * replaced with a marker, which makes "this bundle contains no PHI" a property
 * of the format rather than a hope about upstream logging discipline. What
 * remains is still the bulk of what support needs: health status per component,
 * schema version, aggregate counts, backup inventory, platform and version, and
 * the level/timing/sequence of log events.
 *
 * `includeFreeText: true` opts in to full message bodies for a deep
 * investigation. That is a deliberate operator decision, the bundle records that
 * it was taken, and in that mode the bundle must be handled as PHI.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { redactLogLine, redactValue } = require('./phiRedaction.cjs');

const BUNDLE_VERSION = '1.0.0';

/** Log lines to include. Enough for a failure sequence, small enough to attach. */
const DEFAULT_LOG_LINES = 500;

/** Marker left in place of a withheld free-text value. */
const OMITTED = '[FREE_TEXT_OMITTED]';

/**
 * Field names whose values are operator- or developer-authored prose. Prose can
 * embed a patient name, and no pattern can reliably remove one, so these are
 * withheld rather than redacted unless free text is explicitly requested.
 */
const FREE_TEXT_KEYS = new Set([
  'message', 'msg', 'error', 'errormessage', 'stack', 'detail', 'details',
  'description', 'reason', 'note', 'notes', 'comment', 'comments',
  'summary', 'context', 'text', 'body', 'title',
]);

const normalizeKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

function isFreeTextKey(key) {
  return FREE_TEXT_KEYS.has(normalizeKey(key));
}

/**
 * Replace every free-text field value with a marker, at any depth.
 *
 * Applied after PHI redaction, so a field that is both (e.g. `note`) is caught
 * either way.
 */
function withholdFreeText(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return value;

  if (Array.isArray(value)) return value.map((v) => withholdFreeText(v, depth + 1));

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isFreeTextKey(k)) {
        // Keep a length hint: "there was a 240-character error here" is itself
        // diagnostic, and tells support whether requesting free text is worth it.
        out[k] = typeof v === 'string' && v.length > 0 ? `${OMITTED} (${v.length} chars)` : OMITTED;
      } else {
        out[k] = withholdFreeText(v, depth + 1);
      }
    }
    return out;
  }

  return value;
}

/**
 * Reduce one log line to its non-free-text skeleton.
 *
 * Structured lines keep level, timestamp and any identifying codes, which
 * preserves the sequence and shape of a failure. Unstructured lines carry no
 * safely separable structure at all, so only the fact of the line is kept.
 */
function skeletonLogLine(line) {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      const skeleton = {};
      for (const key of ['level', 'ts', 'timestamp', 'time', 'component', 'module', 'code', 'event', 'requestId', 'request_id']) {
        if (parsed[key] !== undefined) skeleton[key] = parsed[key];
      }
      if (parsed.message !== undefined) {
        skeleton.message = `${OMITTED} (${String(parsed.message).length} chars)`;
      }
      if (parsed.meta && typeof parsed.meta === 'object') {
        // Key names alone say which subsystem logged what, without any values.
        skeleton.metaKeys = Object.keys(parsed.meta);
      }
      return JSON.stringify(skeleton);
    } catch { /* fall through */ }
  }
  return `${OMITTED} (unstructured, ${trimmed.length} chars)`;
}

/**
 * Read the last N lines of a file without loading the whole thing.
 *
 * Log files are size-capped at 10 MB by logger.cjs, so a bounded tail read keeps
 * a diagnostics export from being the thing that exhausts memory on a struggling
 * machine.
 */
function readLogTail(filePath, maxLines = DEFAULT_LOG_LINES, maxBytes = 2 * 1024 * 1024) {
  if (!filePath) return [];

  // Open first, then measure the descriptor. The previous shape checked
  // existence and size by path and then opened it, which is a genuine race
  // here rather than a theoretical one: logger.cjs rotates these very files, so
  // the log could be renamed away between the check and the open. Reading
  // through a single descriptor guarantees the size and the bytes come from the
  // same file. 'r' never creates.
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    // Absent, rotated mid-collection, or unreadable. A diagnostics export must
    // degrade rather than fail — the rest of the bundle is still worth having.
    return [];
  }

  try {
    const { size } = fs.fstatSync(fd);
    const readBytes = Math.min(size, maxBytes);
    const start = size - readBytes;

    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, start);
    const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
    // A partial first line is likely if we started mid-file.
    if (start > 0 && lines.length > 0) lines.shift();
    return lines.slice(-maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Assemble a support bundle from already-collected inputs.
 *
 * Pure: no filesystem, no clock, no service lookups. Everything the bundle will
 * contain is passed in, which is what makes the no-PHI guarantee testable.
 *
 * @param {object} input
 * @param {string} input.generatedAt        ISO 8601
 * @param {object} input.app               { name, version, platform, arch, electron, node }
 * @param {object} [input.health]          output of healthCheck.getHealth()
 * @param {object} [input.migrationStatus] output of migrations.getMigrationStatus()
 * @param {string[]} [input.logLines]      raw log lines (redacted here)
 * @param {object[]} [input.backups]       backup metadata (reduced to non-PHI fields)
 * @param {object} [input.license]         license summary
 * @param {object} [input.counts]          aggregate row counts
 * @param {object} [input.environment]     non-secret configuration flags
 */
function assembleBundle(input = {}) {
  const {
    generatedAt,
    app = {},
    health = null,
    migrationStatus = null,
    logLines = [],
    backups = [],
    license = null,
    counts = null,
    environment = null,
    notes = null,
    includeFreeText = false,
  } = input;

  if (!generatedAt) throw new Error('assembleBundle: generatedAt is required');

  // Two passes: redact PHI-named fields, then withhold free text unless it was
  // explicitly requested. Order matters only for fields that are both.
  const clean = (value) => {
    if (value === null || value === undefined) return null;
    const redacted = redactValue(value);
    return includeFreeText ? redacted : withholdFreeText(redacted);
  };

  // Backups: keep only what diagnoses a contingency problem. Descriptions are
  // operator-authored prose and routinely name a patient, so they are dropped
  // outright in both modes — nothing in support diagnosis needs them.
  const safeBackups = (backups || []).map((b) => ({
    createdAt: b.createdAt ?? null,
    type: b.type ?? null,
    sizeBytes: b.stats?.fileSizeBytes ?? b.sizeBytes ?? null,
    checksumAlgorithm: b.checksumAlgorithm ?? null,
    checksumPresent: Boolean(b.checksum),
    patientCount: b.stats?.patientCount ?? null,
    auditCount: b.stats?.auditCount ?? null,
  }));

  const lines = includeFreeText
    ? (logLines || []).map(redactLogLine)
    : (logLines || []).map(skeletonLogLine);

  return {
    bundleVersion: BUNDLE_VERSION,
    generatedAt,
    // Stated in the artefact so a recipient does not have to ask, and so a
    // reviewer can audit the claim against this module.
    redactionPolicy: {
      mode: includeFreeText ? 'full-text' : 'no-free-text',
      // Only claimed false in the default mode, where it is a property of the
      // format. With free text included it cannot be claimed at all: a log
      // message may name a patient and no redactor can reliably detect that.
      containsPhi: includeFreeText ? 'unknown' : false,
      handleAsPhi: includeFreeText,
      method: 'services/phiRedaction.cjs — field-name redaction plus email/SSN/phone patterns',
      freeTextHandling: includeFreeText
        ? 'INCLUDED at operator request. Message bodies and error strings may contain patient identifiers. Handle this bundle as PHI.'
        : 'WITHHELD. Every free-text field is replaced with a marker, because a patient name in prose cannot be reliably detected.',
      appliedTo: ['health', 'migrations', 'counts', 'environment', 'license', 'notes', 'logTail'],
      neverIncluded: ['patient records', 'backup descriptions', 'credentials', 'encryption keys', 'database contents'],
    },
    app: {
      name: app.name ?? null,
      version: app.version ?? null,
      platform: app.platform ?? null,
      arch: app.arch ?? null,
      electron: app.electron ?? null,
      node: app.node ?? null,
      packaged: app.packaged ?? null,
    },
    health: clean(health),
    migrations: clean(migrationStatus),
    counts: clean(counts),
    license: clean(license),
    environment: clean(environment),
    backups: safeBackups,
    logTail: {
      lineCount: (logLines || []).length,
      freeTextIncluded: includeFreeText,
      lines,
    },
    notes: clean(notes),
  };
}

/** Stable serialisation plus a checksum so a bundle can be shown to be intact. */
function serializeBundle(bundle) {
  const json = JSON.stringify(bundle, null, 2);
  const checksum = crypto.createHash('sha256').update(json, 'utf8').digest('hex');
  return { json, checksum };
}

/**
 * Collect a bundle from the running application.
 *
 * Every source is individually guarded: a diagnostics export is most valuable
 * precisely when something is broken, so one unavailable subsystem must degrade
 * that section to an error string rather than fail the whole export.
 */
function collectBundle(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const safe = (label, fn) => {
    try { return fn(); } catch (e) { return { unavailable: e?.message || String(e), section: label }; }
  };

  let electronApp = null;
  try { ({ app: electronApp } = require('electron')); } catch { /* plain Node */ }

  const appInfo = safe('app', () => ({
    name: 'TransTrack',
    version: electronApp?.getVersion?.() ?? null,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? null,
    node: process.version,
    packaged: electronApp?.isPackaged ?? null,
  }));

  const health = safe('health', () => require('./healthCheck.cjs').getHealth());

  const migrationStatus = safe('migrations', () => {
    const { getMigrationStatus } = require('../database/migrations.cjs');
    const { getDatabase } = require('../database/init.cjs');
    return getMigrationStatus(getDatabase());
  });

  const counts = safe('counts', () => {
    const { getDatabase } = require('../database/init.cjs');
    const db = getDatabase();
    const count = (table) => {
      try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; } catch { return null; }
    };
    // Aggregates only — never a row from any of these tables.
    return {
      patients: count('patients'),
      users: count('users'),
      auditLogs: count('audit_logs'),
      organizations: count('organizations'),
      waitlistTransitions: count('waitlist_status_transitions'),
      iotaNotifications: count('iota_notifications'),
    };
  });

  const backups = safe('backups', () => {
    const svc = require('./disasterRecovery.cjs');
    return typeof svc.listBackups === 'function' ? svc.listBackups() : [];
  });

  const logLines = safe('logs', () => {
    const { getLogDir } = require('./logger.cjs');
    const file = path.join(getLogDir(), 'transtrack.log');
    return readLogTail(file, options.maxLogLines || DEFAULT_LOG_LINES);
  });

  const environment = safe('environment', () => ({
    // Names of set variables and coarse values only. No secrets: the presence of
    // a credential is diagnostic, its value never is.
    nodeEnv: process.env.NODE_ENV ?? null,
    backupDirConfigured: Boolean(process.env.TRANSTRACK_BACKUP_DIR),
    remoteApiConfigured: Boolean(process.env.TRANSTRACK_API_URL),
    signingConfigured: Boolean(process.env.CSC_LINK || process.env.ESIGNER_USERNAME),
    locale: process.env.LANG ?? null,
    timezoneOffsetMinutes: now.getTimezoneOffset(),
  }));

  return assembleBundle({
    generatedAt: now.toISOString(),
    app: appInfo,
    health,
    migrationStatus,
    counts,
    backups: Array.isArray(backups) ? backups : [],
    logLines: Array.isArray(logLines) ? logLines : [],
    environment,
    notes: options.notes ?? null,
    includeFreeText: options.includeFreeText === true,
  });
}

/**
 * Collect and write a bundle to disk.
 *
 * @returns {{ filePath: string, checksum: string, sizeBytes: number, generatedAt: string }}
 */
function writeBundle(destPath, options = {}) {
  if (!destPath) throw new Error('writeBundle: destPath is required');
  const bundle = collectBundle(options);
  const { json, checksum } = serializeBundle(bundle);

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, json, 'utf8');

  return {
    filePath: destPath,
    checksum,
    sizeBytes: Buffer.byteLength(json, 'utf8'),
    generatedAt: bundle.generatedAt,
  };
}

/** Conventional filename for a bundle, safe on every supported platform. */
function suggestFileName(now = new Date()) {
  return `transtrack-support-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

module.exports = {
  BUNDLE_VERSION,
  DEFAULT_LOG_LINES,
  OMITTED,
  FREE_TEXT_KEYS,
  isFreeTextKey,
  withholdFreeText,
  skeletonLogLine,
  readLogTail,
  assembleBundle,
  serializeBundle,
  collectBundle,
  writeBundle,
  suggestFileName,
};
