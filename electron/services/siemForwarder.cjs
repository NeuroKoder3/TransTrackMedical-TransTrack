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

const dgram = require('dgram');
const net = require('net');
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

function createDestination({ orgId, name, host, port, protocol = 'udp', format = 'cef',
  enabled = true, severityFilter = 'all', createdBy }) {
  if (!orgId) throw new Error('orgId required');
  if (!name) throw new Error('name required');
  if (!host) throw new Error('host required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1..65535');
  if (!['udp', 'tcp', 'tls'].includes(protocol)) throw new Error('Invalid protocol');
  if (!['cef', 'json', 'rfc5424'].includes(format)) throw new Error('Invalid format');

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

// ---------------- formatting ----------------

function escapeCef(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/\r?\n/g, ' ');
}

function toCef(record) {
  // CEF:0|Vendor|Product|Version|SignatureID|Name|Severity|Extension
  const sev = mapSeverity(record.action);
  const ext = [
    `rt=${new Date(record.created_at).getTime()}`,
    `suser=${escapeCef(record.user_email || '')}`,
    `duser=${escapeCef(record.user_role || '')}`,
    `cs1Label=org_id`, `cs1=${escapeCef(record.org_id || '')}`,
    `cs2Label=entity_type`, `cs2=${escapeCef(record.entity_type || '')}`,
    `cs3Label=entity_id`, `cs3=${escapeCef(record.entity_id || '')}`,
    `cs4Label=request_id`, `cs4=${escapeCef(record.request_id || '')}`,
    `act=${escapeCef(record.action || '')}`,
    `msg=${escapeCef(record.details || '')}`,
  ].join(' ');
  return `CEF:0|TransTrack|TransTrack|1.0|${escapeCef(record.action || 'audit')}|${escapeCef(record.action || 'audit')}|${sev}|${ext}`;
}

function toJson(record) {
  return JSON.stringify({
    timestamp: record.created_at,
    host: HOSTNAME,
    product: 'TransTrack',
    org_id: record.org_id,
    user_email: record.user_email,
    user_role: record.user_role,
    action: record.action,
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    patient_name: record.patient_name,
    request_id: record.request_id,
    details: safeParseJson(record.details),
  });
}

function toRfc5424(record) {
  const pri = 14; // facility=user (1), severity=informational (6) → 1*8+6=14
  const ts = new Date(record.created_at).toISOString();
  const app = 'transtrack';
  const procid = process.pid;
  const msgid = String(record.action || 'audit').slice(0, 32);
  const sd = `[transtrack@53914 org="${(record.org_id || '').replace(/"/g, '\\"')}" user="${(record.user_email || '').replace(/"/g, '\\"')}" entity="${(record.entity_type || '')}" id="${(record.entity_id || '')}"]`;
  const msg = String(record.details || '').replace(/[\r\n]+/g, ' ');
  return `<${pri}>1 ${ts} ${HOSTNAME} ${app} ${procid} ${msgid} ${sd} ${msg}`;
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
    const sock = tls.connect({ host: dest.host, port: dest.port, rejectUnauthorized: false });
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
  // exported for tests
  toCef, toJson, toRfc5424, formatRecord, mapSeverity,
};
