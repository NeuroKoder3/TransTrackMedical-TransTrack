/**
 * SIEM / syslog audit-log forwarder.
 *
 * Per SRS TT-R026.  Forwards immutable audit-log rows to one or more
 * external collectors over UDP, TCP, or TLS, formatted as ArcSight CEF
 * (default), RFC 5424 syslog, or JSON.
 *
 * The forwarder is non-blocking, has bounded in-memory queues, and
 * never throws into the calling code path (write failures are recorded
 * on the destination row).
 */

'use strict';

const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const net = require('net');
const path = require('path');
const tls = require('tls');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');

const MAX_QUEUE_PER_DEST = 1000;
const HOSTNAME = require('os').hostname();

// per-destination state: { socket, queue, sending, backoffMs }
const destinationState = new Map();

// ---------------- destination CRUD ----------------

function listDestinations(orgId) {
  if (orgId) {
    return getDatabase().prepare(
      'SELECT * FROM siem_destinations WHERE org_id = ? ORDER BY name'
    ).all(orgId);
  }
  return getDatabase().prepare('SELECT * FROM siem_destinations ORDER BY org_id, name').all();
}

function getDestination(id, orgId) {
  return getDatabase().prepare(
    'SELECT * FROM siem_destinations WHERE id = ? AND org_id = ?'
  ).get(id, orgId);
}

function _isProductionEnv() {
  try {
    const { app } = require('electron');
    return app.isPackaged;
  } catch { return process.env.NODE_ENV === 'production'; }
}

function createDestination({ orgId, name, host, port, protocol = 'udp', format = 'cef',
  enabled = true, severityFilter = 'all', createdBy }) {
  if (!orgId) throw new Error('orgId required');
  if (!name) throw new Error('name required');
  if (!host) throw new Error('host required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1..65535');
  if (!['udp', 'tcp', 'tls'].includes(protocol)) throw new Error('Invalid protocol');
  if (!['cef', 'json', 'rfc5424'].includes(format)) throw new Error('Invalid format');

  // Production: require TLS unless explicitly overridden
  if (_isProductionEnv() && protocol !== 'tls') {
    if (process.env.TRANSTRACK_SIEM_ALLOW_PLAINTEXT !== '1') {
      throw new Error(
        `Protocol '${protocol}' is not permitted in production. Use 'tls' or set TRANSTRACK_SIEM_ALLOW_PLAINTEXT=1 to override.`
      );
    }
  }

  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO siem_destinations (
      id, org_id, name, host, port, protocol, format, enabled, severity_filter,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, orgId, name, host, port, protocol, format, enabled ? 1 : 0, severityFilter, createdBy ?? null);
  return getDestination(id, orgId);
}

function updateDestination({ id, orgId, fields }) {
  const allowed = ['name', 'host', 'port', 'protocol', 'format', 'enabled', 'severity_filter'];
  const sets = []; const params = [];
  for (const k of Object.keys(fields || {})) {
    if (allowed.includes(k)) {
      let v = fields[k];
      if (k === 'enabled') v = v ? 1 : 0;
      sets.push(`${k} = ?`); params.push(v);
    }
  }
  if (!sets.length) return getDestination(id, orgId);
  sets.push("updated_at = datetime('now')");
  params.push(id, orgId);
  getDatabase().prepare(
    `UPDATE siem_destinations SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`
  ).run(...params);
  // Drop cached socket so next forward re-resolves
  destinationState.delete(id);
  return getDestination(id, orgId);
}

function deleteDestination(id, orgId) {
  destinationState.delete(id);
  const r = getDatabase().prepare(
    'DELETE FROM siem_destinations WHERE id = ? AND org_id = ?'
  ).run(id, orgId);
  return { deleted: r.changes > 0 };
}

// ---------------- workforce identifiers ----------------

/**
 * How the acting user is identified in forwarded events.
 *
 * A SIEM sits outside the application's trust boundary and is usually operated
 * by a different team, often with a longer retention window than the audit trail
 * itself. Every forwarded row previously carried the clinician's mailbox
 * address, which is a directly identifying workforce identifier and, in a
 * transplant programme, is often enough on its own to say who was on shift and
 * which service they work in. Correlation across events is what a SIEM actually
 * needs, and a stable pseudonym provides that without exporting the identity.
 *
 * Set TRANSTRACK_SIEM_WORKFORCE_ID to change it:
 *   pseudonymous (default) — a stable salted HMAC of the address
 *   raw                    — the address itself; a deliberate opt-in for sites
 *                            whose SIEM playbooks key on the mailbox
 *   omit                   — no workforce identifier at all
 *
 * An unrecognised value falls back to pseudonymous rather than to raw, so a typo
 * cannot start exporting addresses.
 */
const WORKFORCE_ID_MODES = new Set(['pseudonymous', 'raw', 'omit']);
const WORKFORCE_ID_MODE_ENV = 'TRANSTRACK_SIEM_WORKFORCE_ID';
const WORKFORCE_SALT_ENV = 'TRANSTRACK_SIEM_WORKFORCE_SALT';
const WORKFORCE_SALT_FILENAME = '.transtrack-siem-pseudonym-salt';

let cachedWorkforceSalt = null;

function getWorkforceIdMode() {
  const configured = String(process.env[WORKFORCE_ID_MODE_ENV] || '').trim().toLowerCase();
  return WORKFORCE_ID_MODES.has(configured) ? configured : 'pseudonymous';
}

/**
 * The secret that makes the pseudonym non-reversible.
 *
 * Without a secret, a pseudonym is just a hash of an address and anyone holding
 * the staff directory can recover it by hashing every name. The salt is
 * therefore persisted (so a pseudonym stays stable across restarts and remains
 * correlatable in the SIEM) and kept 0600 in userData, sealed by OS secure
 * storage when a keyring is present.
 *
 * When no userData directory exists — plain-Node tooling and CI — a
 * process-lifetime salt is used. That loses cross-restart correlation but never
 * discloses more than the configured mode allows, which is the property that
 * matters here.
 */
function getWorkforceSalt() {
  if (cachedWorkforceSalt) return cachedWorkforceSalt;

  const configured = process.env[WORKFORCE_SALT_ENV];
  if (configured && configured.length >= 16) {
    cachedWorkforceSalt = Buffer.from(configured, 'utf8');
    return cachedWorkforceSalt;
  }

  let saltPath = null;
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      saltPath = path.join(app.getPath('userData'), WORKFORCE_SALT_FILENAME);
    }
  } catch { /* not running under Electron */ }

  if (saltPath) {
    try {
      cachedWorkforceSalt = readOrCreateWorkforceSalt(saltPath);
      return cachedWorkforceSalt;
    } catch { /* fall through to the ephemeral salt */ }
  }

  cachedWorkforceSalt = crypto.randomBytes(32);
  return cachedWorkforceSalt;
}

function readOrCreateWorkforceSalt(saltPath) {
  const { safeStorage } = require('electron');
  const sealed = safeStorage
    && typeof safeStorage.isEncryptionAvailable === 'function'
    && safeStorage.isEncryptionAvailable();

  try {
    const raw = fs.readFileSync(saltPath);
    if (sealed) {
      try {
        return Buffer.from(safeStorage.decryptString(raw), 'hex');
      } catch { /* written before a keyring existed; adopt the plaintext form */ }
    }
    const text = raw.toString('utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(text)) return Buffer.from(text, 'hex');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const salt = crypto.randomBytes(32);
  const hex = salt.toString('hex');
  const payload = sealed ? safeStorage.encryptString(hex) : Buffer.from(hex, 'utf8');
  try {
    const fd = fs.openSync(saltPath, 'wx', 0o600);
    try { fs.writeSync(fd, payload, 0, payload.length, 0); } finally { fs.closeSync(fd); }
  } catch (err) {
    // EEXIST means another starter won the race; its salt is authoritative,
    // because pseudonyms already forwarded were computed with it.
    if (err.code !== 'EEXIST') throw err;
    return readOrCreateWorkforceSalt(saltPath);
  }
  return salt;
}

/**
 * The identifier that stands in for the acting user in a forwarded event.
 * Truncated to 128 bits, which is far beyond collision range for a workforce
 * and keeps the field readable in a SIEM console.
 */
function workforceIdentifier(email) {
  if (!email) return '';
  const mode = getWorkforceIdMode();
  if (mode === 'omit') return '';
  if (mode === 'raw') return String(email);
  const digest = crypto
    .createHmac('sha256', getWorkforceSalt())
    .update(String(email).trim().toLowerCase())
    .digest('hex');
  return `wf-${digest.slice(0, 32)}`;
}

// ---------------- PHI redaction ----------------

/**
 * Redact PHI from a record before forwarding. Never send patient_name, and
 * never send the raw workforce address unless the deployment opted in.
 * Details are reduced to action+entityType+entityId only.
 */
function redactRecord(record) {
  return {
    ...record,
    patient_name: undefined,
    user_email: undefined,
    workforce_id: workforceIdentifier(record.user_email),
    details: record.action && record.entity_type
      ? `${record.action}:${record.entity_type}:${record.entity_id || 'n/a'}`
      : record.action || null,
  };
}

// ---------------- formatting ----------------

function escapeCef(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/\r?\n/g, ' ');
}

function toCef(record) {
  const r = redactRecord(record);
  const sev = mapSeverity(r.action);
  const ext = [
    `rt=${new Date(r.created_at).getTime()}`,
    `suser=${escapeCef(r.workforce_id || '')}`,
    `duser=${escapeCef(r.user_role || '')}`,
    `cs1Label=org_id`, `cs1=${escapeCef(r.org_id || '')}`,
    `cs2Label=entity_type`, `cs2=${escapeCef(r.entity_type || '')}`,
    `cs3Label=entity_id`, `cs3=${escapeCef(r.entity_id || '')}`,
    `cs4Label=request_id`, `cs4=${escapeCef(r.request_id || '')}`,
    `act=${escapeCef(r.action || '')}`,
    `msg=${escapeCef(r.details || '')}`,
  ].join(' ');
  const appVersion = (() => { try { return require('electron').app.getVersion(); } catch { return require('../../package.json').version; } })();
  return `CEF:0|TransTrack|TransTrack|${appVersion}|${escapeCef(r.action || 'audit')}|${escapeCef(r.action || 'audit')}|${sev}|${ext}`;
}

function toJson(record) {
  const r = redactRecord(record);
  return JSON.stringify({
    timestamp: r.created_at,
    host: HOSTNAME,
    product: 'TransTrack',
    org_id: r.org_id,
    // `user_id` is the correlatable identifier in every mode; `user_email` is
    // present only where the deployment explicitly asked for the address, so a
    // consumer that reads it is reading something the site chose to export.
    user_id: r.workforce_id || null,
    user_id_mode: getWorkforceIdMode(),
    user_email: getWorkforceIdMode() === 'raw' ? r.workforce_id : undefined,
    user_role: r.user_role,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    request_id: r.request_id,
    details: r.details,
  });
}

function toRfc5424(record) {
  const r = redactRecord(record);
  const pri = 14;
  const ts = new Date(r.created_at).toISOString();
  const appName = 'transtrack';
  const procid = process.pid;
  const msgid = String(r.action || 'audit').slice(0, 32);
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\]/g, '\\]');
  const sd = `[transtrack@53914 org="${esc(r.org_id)}" user="${esc(r.workforce_id)}" entity="${esc(r.entity_type)}" id="${esc(r.entity_id)}"]`;
  const msg = String(r.details || '').replace(/[\r\n]+/g, ' ');
  return `<${pri}>1 ${ts} ${HOSTNAME} ${appName} ${procid} ${msgid} ${sd} ${msg}`;
}

function safeParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

function mapSeverity(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('login_fail') || a.includes('lockout') || a.includes('breach')) return 8;
  if (a.includes('delete') || a.includes('disable')) return 6;
  if (a.includes('login') || a.includes('logout')) return 3;
  return 4;
}

function formatRecord(record, format) {
  if (format === 'cef') return toCef(record);
  if (format === 'json') return toJson(record);
  return toRfc5424(record);
}

// ---------------- transport ----------------

function getOrCreateState(dest) {
  let st = destinationState.get(dest.id);
  if (!st) {
    st = { socket: null, queue: [], sending: false, backoffMs: 0 };
    destinationState.set(dest.id, st);
  }
  return st;
}

function recordSuccess(destId) {
  try {
    getDatabase().prepare(
      "UPDATE siem_destinations SET last_success_at = datetime('now'), last_failure_reason = NULL WHERE id = ?"
    ).run(destId);
  } catch { /* ignore */ }
}

function recordFailure(destId, reason) {
  try {
    getDatabase().prepare(
      "UPDATE siem_destinations SET last_failure_at = datetime('now'), last_failure_reason = ?, dropped_count = dropped_count + 1 WHERE id = ?"
    ).run(String(reason || 'unknown').slice(0, 500), destId);
  } catch { /* ignore */ }
}

function ensureSocket(dest, st) {
  if (st.socket && !st.socket.destroyed) return st.socket;
  if (dest.protocol === 'udp') {
    const sock = dgram.createSocket('udp4');
    sock.on('error', (err) => { recordFailure(dest.id, err.message); try { sock.close(); } catch {} st.socket = null; });
    st.socket = sock;
  } else if (dest.protocol === 'tcp') {
    const sock = net.createConnection({ host: dest.host, port: dest.port });
    sock.on('error', (err) => { recordFailure(dest.id, err.message); try { sock.destroy(); } catch {} st.socket = null; });
    sock.on('close', () => { st.socket = null; });
    st.socket = sock;
  } else if (dest.protocol === 'tls') {
    const sock = tls.connect({ host: dest.host, port: dest.port, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    sock.on('error', (err) => { recordFailure(dest.id, err.message); try { sock.destroy(); } catch {} st.socket = null; });
    sock.on('close', () => { st.socket = null; });
    st.socket = sock;
  }
  return st.socket;
}

function send(dest, payload) {
  const st = getOrCreateState(dest);
  const data = Buffer.from(payload + '\n', 'utf8');
  const sock = ensureSocket(dest, st);
  if (!sock) return Promise.reject(new Error('no socket'));
  return new Promise((resolve) => {
    if (dest.protocol === 'udp') {
      sock.send(data, dest.port, dest.host, (err) => {
        if (err) { recordFailure(dest.id, err.message); resolve(false); }
        else { recordSuccess(dest.id); resolve(true); }
      });
    } else {
      sock.write(data, (err) => {
        if (err) { recordFailure(dest.id, err.message); resolve(false); }
        else { recordSuccess(dest.id); resolve(true); }
      });
    }
  });
}

/**
 * Forward a single audit row to all enabled destinations belonging to the
 * row's org_id. Non-blocking; errors are absorbed.
 */
function forwardAuditRow(row) {
  if (!row || !row.org_id) return;
  let dests;
  try {
    dests = getDatabase().prepare(
      'SELECT * FROM siem_destinations WHERE org_id = ? AND enabled = 1'
    ).all(row.org_id);
  } catch {
    return;
  }
  for (const d of dests) {
    try {
      const payload = formatRecord(row, d.format || 'cef');
      send(d, payload).catch(() => { /* swallow */ });
    } catch (err) {
      recordFailure(d.id, err.message);
    }
  }
}

function shutdown() {
  for (const [, st] of destinationState) {
    try { if (st.socket) st.socket.destroy ? st.socket.destroy() : st.socket.close && st.socket.close(); } catch {}
  }
  destinationState.clear();
}

/**
 * Send a synthetic test event to a destination so admins can verify
 * connectivity without having to wait for real audit traffic.
 */
async function testDestination(id, orgId) {
  const dest = getDestination(id, orgId);
  if (!dest) throw new Error('Destination not found');
  const sample = {
    org_id: orgId,
    user_email: 'siem-test@transtrack',
    user_role: 'system',
    action: 'siem_test',
    entity_type: 'SiemDestination',
    entity_id: id,
    patient_name: null,
    details: 'TransTrack SIEM connectivity test',
    request_id: uuidv4(),
    created_at: new Date().toISOString(),
  };
  const payload = formatRecord(sample, dest.format || 'cef');
  const ok = await send(dest, payload).catch(() => false);
  return { ok, sample_payload: payload };
}

module.exports = {
  listDestinations,
  getDestination,
  createDestination,
  updateDestination,
  deleteDestination,
  forwardAuditRow,
  testDestination,
  shutdown,
  getWorkforceIdMode,
  workforceIdentifier,
  // exported for tests
  toCef, toJson, toRfc5424, formatRecord, mapSeverity,
};
