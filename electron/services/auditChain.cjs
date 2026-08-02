/**
 * TransTrack — Desktop audit trail: the single chained writer and verifier.
 *
 * WRITING
 *
 * `appendAuditRecord` is the only supported way to add a row to audit_logs.
 * Every row it writes carries the full tamper-evidence field set, and it throws
 * when it cannot. That is deliberate: an audit write that quietly degrades to a
 * row with no hash produces a record that looks like evidence and is not one,
 * and the operation it was supposed to evidence proceeds anyway. Callers are
 * expected to let that throw propagate so the originating operation fails
 * instead of completing unaudited.
 *
 * VERIFYING
 *
 * Four independent tamper-evidence layers are checked:
 *
 *   1. Hash chain (always present)
 *      record_hash = sha256(prev_hash || canonical_json(payload)), with the
 *      first row of each org chaining from 'GENESIS'. Detects any edit,
 *      reorder, or deletion of a row.
 *
 *   2. Keyed HMAC (present on rows written after migration 16)
 *      record_hmac = hmac_sha256(auditKey, prev_hash || canonical_json(payload))
 *      where auditKey lives in OS secure storage. The hash chain alone is
 *      unkeyed, so an attacker with write access to the database file could
 *      recompute it; the HMAC means they would also need the OS-protected key.
 *
 *   3. Per-org sequence (present on rows written after migration 19)
 *      A gap-detectable counter that is part of the signed payload. Ordering
 *      the replay by wall-clock created_at alone let a local administrator with
 *      control of the system clock influence where a row lands in the chain;
 *      the sequence is monotonic regardless of the clock.
 *
 *   4. Timestamp monotonicity
 *      created_at must not move backwards along the sequence. A regression is
 *      evidence the clock was moved, which is itself the thing worth catching.
 *
 * Rows predating a layer are reported as unverifiable/exempt for that layer
 * rather than as failures, so upgrading an existing installation does not
 * produce a spurious "tampered" verdict. A row with NO record_hash at all is
 * NOT in that category: it is reported as an integrity failure, because such a
 * row is outside the chain entirely and used to be silently filtered out of
 * verification.
 *
 * The canonical byte layout is owned by services/auditCanonical.cjs and shared
 * with electron/ipc/shared.cjs logAudit, which delegates here.
 */

'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database/init.cjs');
const auditCanonical = require('./auditCanonical.cjs');

/**
 * A created_at regression smaller than this is not treated as a clock move.
 * Rows written before the chained writer existed used SQLite's
 * `datetime('now')`, which truncates to whole seconds, so such a row can appear
 * up to a second earlier than an ISO-precision row written moments before it.
 */
const TIMESTAMP_TOLERANCE_MS = 1000;

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function loadHmacHelpers() {
  try {
    return require('./auditHmacKey.cjs');
  } catch {
    return null;
  }
}

/**
 * Which audit_logs columns this database actually has.
 *
 * Probed per call rather than cached: the schema changes under a long-lived
 * process (migrations run at startup, and tests recreate the table), and a
 * stale cache would silently drop the sequence or HMAC from a row.
 */
function auditColumns(db) {
  let names = [];
  try {
    names = db.prepare('PRAGMA table_info(audit_logs)').all().map((c) => c.name);
  } catch { /* table absent — treated as no optional columns */ }
  const set = new Set(names);
  return {
    has: (name) => set.has(name),
    hasHmac: set.has('record_hmac'),
    hasSeq: set.has('seq'),
  };
}

/**
 * Replay order.
 *
 * Sequence-exempt rows (written before migration 19) have no counter, so they
 * are replayed first in insertion order; sequenced rows follow in counter
 * order. `seq IS NULL` evaluates to 1 for the exempt rows, hence DESC.
 */
function chainOrderBy(cols) {
  return cols.hasSeq
    ? 'ORDER BY (seq IS NULL) DESC, seq ASC, created_at ASC, rowid ASC'
    : auditCanonical.CHAIN_ORDER_BY;
}

/** Reverse of chainOrderBy — used to find the row a new record chains from. */
function tailOrderBy(cols) {
  return cols.hasSeq
    ? 'ORDER BY (seq IS NULL) ASC, seq DESC, created_at DESC, rowid DESC'
    : 'ORDER BY created_at DESC, rowid DESC';
}

/**
 * Parse an audit timestamp to epoch milliseconds.
 *
 * Accepts both the ISO-8601 form the writer emits and SQLite's
 * `YYYY-MM-DD HH:MM:SS` form left by older direct inserts, which is UTC.
 * Returns null when the value is unparseable, in which case monotonicity is
 * simply not checked for that row rather than reported as a break.
 */
function parseAuditTime(value) {
  if (typeof value !== 'string' || value === '') return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Compute the keyed HMAC for an audit row, or null when no key is available.
 *
 * Never throws: the HMAC is a second layer over rows that are already hash
 * chained, and rows predating migration 16 have none, so its absence is
 * reported by verification rather than blocking the write.
 */
function computeHmacSafely(signedString) {
  try {
    const auditHmacKey = require('./auditHmacKey.cjs');
    return auditHmacKey.computeAuditHmac(signedString);
  } catch {
    return null;
  }
}

/**
 * Append one fully chained audit row.
 *
 * @param {object} record         org_id, action and the rest of the audit payload
 * @param {object} [options]
 * @param {object} [options.db]   database handle; defaults to the live database
 * @returns {{ id: string, seq: number|null, prevHash: string, recordHash: string }}
 * @throws  when the row cannot be written with its chain fields intact
 */
function appendAuditRecord(record, options = {}) {
  const db = options.db || getDatabase();
  if (!db) throw new Error('Audit write failed: database is not initialized');
  if (!record || !record.action) throw new Error('Audit write failed: action is required');

  const cols = auditColumns(db);
  const id = record.id || uuidv4();
  const orgId = record.org_id || 'SYSTEM';
  const createdAt = record.created_at || new Date().toISOString();

  const write = db.transaction(() => {
    let prevHash = auditCanonical.GENESIS;
    const prev = db.prepare(
      `SELECT record_hash FROM audit_logs
       WHERE org_id = ? AND record_hash IS NOT NULL
       ${tailOrderBy(cols)} LIMIT 1`
    ).get(orgId);
    if (prev?.record_hash) prevHash = prev.record_hash;

    // The counter is allocated from the org's current maximum inside this
    // transaction. TransTrack is single-process against a local database, so
    // the read and the insert cannot interleave with another writer.
    let seq = null;
    if (cols.hasSeq) {
      const maxSeq = db.prepare('SELECT MAX(seq) AS m FROM audit_logs WHERE org_id = ?').get(orgId);
      seq = (maxSeq?.m || 0) + 1;
    }

    const row = {
      org_id: orgId,
      action: record.action,
      entity_type: record.entity_type || null,
      entity_id: record.entity_id || null,
      patient_name: record.patient_name || null,
      details: record.details || null,
      user_email: record.user_email || null,
      user_role: record.user_role || null,
      seq,
    };
    const signedString = auditCanonical.buildSignedString(prevHash, row);
    const recordHash = sha256(signedString);
    const recordHmac = cols.hasHmac ? computeHmacSafely(signedString) : null;

    // Built from the columns this database actually has, so an older schema
    // narrows the row rather than failing the insert and losing the record.
    const columns = ['id', 'org_id', 'action', 'prev_hash', 'record_hash', 'created_at'];
    const values = [id, orgId, record.action, prevHash, recordHash, createdAt];
    const optional = (name, value) => {
      if (cols.has(name)) { columns.push(name); values.push(value); }
    };
    optional('entity_type', row.entity_type);
    optional('entity_id', row.entity_id);
    optional('patient_name', row.patient_name);
    optional('details', row.details);
    optional('user_id', record.user_id || null);
    optional('user_email', row.user_email);
    optional('user_role', row.user_role);
    optional('request_id', record.request_id || null);
    optional('ip_address', record.ip_address || null);
    optional('user_agent', record.user_agent || null);
    if (cols.hasHmac) { columns.push('record_hmac'); values.push(recordHmac); }
    if (cols.hasSeq) { columns.push('seq'); values.push(seq); }

    db.prepare(
      `INSERT INTO audit_logs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).run(...values);

    return { id, seq, prevHash, recordHash, recordHmac, createdAt, orgId };
  });

  try {
    return write();
  } catch (err) {
    throw new Error(`Audit write failed for action "${record.action}": ${err.message}`);
  }
}

/**
 * Does audit_logs carry the optional tamper-evidence columns?
 */
function selectColumns(db) {
  const cols = auditColumns(db);
  const selected = [auditCanonical.CHAIN_SELECT_COLUMNS, 'created_at'];
  if (cols.hasHmac) selected.push('record_hmac');
  if (cols.hasSeq) selected.push('seq');
  return { cols, sql: selected.join(', ') };
}

function failure(kind, row, state) {
  return {
    ok: false,
    verified: state.verified,
    brokenAt: row?.id ?? null,
    failure: kind,
    detail: state.detail || null,
    hmac: { checked: state.hmacChecked, unverifiable: state.hmacUnverifiable, available: state.hmacAvailable },
    sequence: {
      available: state.seqAvailable,
      checked: state.seqChecked,
      exempt: state.seqExempt,
      lastSeq: state.lastSeq,
    },
  };
}

/**
 * Verify the integrity of the audit trail for a given organization.
 *
 * @param {string} orgId
 * @param {object} [options]
 * @param {object} [options.db] database handle; defaults to the live database
 * @returns {{
 *   ok: boolean,
 *   verified: number,
 *   brokenAt?: string,
 *   failure?: 'hash_chain'|'hmac'|'missing_hash'|'sequence'|'timestamp',
 *   detail?: string|null,
 *   hmac: { checked: number, unverifiable: number, available: boolean },
 *   sequence: { available: boolean, checked: number, exempt: number, lastSeq: number|null }
 * }}
 */
function verifyAuditChain(orgId, options = {}) {
  if (!orgId) throw new Error('orgId required');
  const db = options.db || getDatabase();

  const { cols, sql } = selectColumns(db);

  // Deliberately unfiltered. Selecting only rows WHERE record_hash IS NOT NULL
  // made an unchained row invisible to verification instead of reporting it,
  // which is the opposite of what a tamper-evidence check is for.
  const rows = db.prepare(
    `SELECT ${sql} FROM audit_logs WHERE org_id = ? ${chainOrderBy(cols)}`
  ).all(orgId);

  const hmacHelpers = cols.hasHmac ? loadHmacHelpers() : null;
  const state = {
    verified: 0,
    hmacChecked: 0,
    hmacUnverifiable: 0,
    hmacAvailable: Boolean(hmacHelpers && hmacHelpers.getStatus().available),
    seqAvailable: cols.hasSeq,
    seqChecked: 0,
    seqExempt: 0,
    lastSeq: null,
    detail: null,
  };

  let prev = auditCanonical.GENESIS;
  let prevTime = null;

  for (const r of rows) {
    // Layer 0 — the row must be in the chain at all.
    if (!r.record_hash) {
      state.detail = 'row has no record_hash and is outside the hash chain';
      return failure('missing_hash', r, state);
    }

    // Layer 1 — per-org sequence. Checked before the hash so that a renumbered
    // row is reported as what it is: the sequence is part of the signed
    // payload, so renumbering breaks the hash too, and "sequence" is the more
    // actionable diagnosis of the two.
    if (cols.hasSeq) {
      if (r.seq === null || r.seq === undefined) {
        if (state.seqChecked > 0) {
          // Every write after the migration allocates a counter, so an
          // unsequenced row appearing after a sequenced one was not written by
          // this application.
          state.detail = 'unsequenced row appears after sequenced rows';
          return failure('sequence', r, state);
        }
        state.seqExempt += 1;
      } else {
        const expected = (state.lastSeq === null ? 0 : state.lastSeq) + 1;
        if (r.seq !== expected) {
          state.detail = `expected sequence ${expected}, found ${r.seq}`;
          return failure('sequence', r, state);
        }
        state.lastSeq = r.seq;
        state.seqChecked += 1;
      }
    }

    // Layer 2 — the clock must not run backwards along the chain.
    const rowTime = parseAuditTime(r.created_at);
    if (rowTime !== null && prevTime !== null && rowTime < prevTime - TIMESTAMP_TOLERANCE_MS) {
      state.detail = `created_at ${r.created_at} precedes the previous row`;
      return failure('timestamp', r, state);
    }
    if (rowTime !== null) prevTime = rowTime;

    const signedString = auditCanonical.buildSignedString(prev, r);

    // Layer 3 — unkeyed hash chain.
    if (r.prev_hash !== prev || r.record_hash !== sha256(signedString)) {
      return failure('hash_chain', r, state);
    }

    // Layer 4 — keyed HMAC, when both the row and the key are present.
    if (cols.hasHmac && r.record_hmac) {
      if (!state.hmacAvailable) {
        state.hmacUnverifiable += 1;
      } else {
        const expectedHmac = hmacHelpers.computeAuditHmac(signedString);
        if (!expectedHmac || !hmacHelpers.hmacMatches(expectedHmac, r.record_hmac)) {
          return failure('hmac', r, state);
        }
        state.hmacChecked += 1;
      }
    } else if (cols.hasHmac) {
      // Row written before the HMAC layer existed.
      state.hmacUnverifiable += 1;
    }

    prev = r.record_hash;
    state.verified += 1;
  }

  return {
    ok: true,
    verified: state.verified,
    hmac: { checked: state.hmacChecked, unverifiable: state.hmacUnverifiable, available: state.hmacAvailable },
    sequence: {
      available: state.seqAvailable,
      checked: state.seqChecked,
      exempt: state.seqExempt,
      lastSeq: state.lastSeq,
    },
  };
}

/**
 * Result of the most recent full verification, or null if none has run.
 *
 * Held in memory so healthCheck can report a detected break without replaying
 * the whole trail on every diagnostics call.
 */
let _lastVerification = null;

/**
 * Verify every organization's audit trail.
 *
 * Called at startup. A historical break must not stop the application — the
 * records that matter are already written and the site needs the app to
 * investigate — but it is recorded here and reported as a degraded state by
 * healthCheck rather than passing silently.
 */
function verifyAllOrganizations(options = {}) {
  const db = options.db || getDatabase();
  if (!db) throw new Error('Database not initialized');

  const orgIds = db.prepare('SELECT DISTINCT org_id FROM audit_logs').all().map((r) => r.org_id);
  const organizations = [];
  let verified = 0;

  for (const orgId of orgIds) {
    const result = verifyAuditChain(orgId, { db });
    verified += result.verified;
    organizations.push({
      orgId,
      ok: result.ok,
      verified: result.verified,
      ...(result.ok ? {} : { failure: result.failure, brokenAt: result.brokenAt, detail: result.detail }),
    });
  }

  const broken = organizations.filter((o) => !o.ok);
  _lastVerification = {
    checkedAtISO: new Date().toISOString(),
    ok: broken.length === 0,
    organizationsChecked: organizations.length,
    rowsVerified: verified,
    broken,
  };
  return _lastVerification;
}

function getLastVerification() {
  return _lastVerification;
}

module.exports = {
  appendAuditRecord,
  verifyAuditChain,
  verifyAllOrganizations,
  getLastVerification,
  parseAuditTime,
  TIMESTAMP_TOLERANCE_MS,
};
