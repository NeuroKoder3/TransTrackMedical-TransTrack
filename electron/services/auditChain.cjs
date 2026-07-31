/**
 * TransTrack — Desktop audit trail integrity verification.
 *
 * Two independent tamper-evidence layers are checked:
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
 * The canonical byte layout is owned by services/auditCanonical.cjs and shared
 * with the writer in electron/ipc/shared.cjs.
 *
 * Rows predating a layer are reported as unverifiable for that layer rather
 * than as failures, so upgrading an existing installation does not produce a
 * spurious "tampered" verdict.
 */

'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../database/init.cjs');
const auditCanonical = require('./auditCanonical.cjs');

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
 * Does audit_logs carry the record_hmac column?
 * Probed per call because the schema can change under a long-lived process.
 */
function selectColumns(db) {
  let hasHmac = false;
  try {
    hasHmac = db.prepare('PRAGMA table_info(audit_logs)')
      .all()
      .some((c) => c.name === 'record_hmac');
  } catch { /* treat as absent */ }
  return {
    hasHmac,
    sql: hasHmac
      ? `${auditCanonical.CHAIN_SELECT_COLUMNS}, record_hmac`
      : auditCanonical.CHAIN_SELECT_COLUMNS,
  };
}

/**
 * Verify the integrity of the audit trail for a given organization.
 *
 * @param {string} orgId
 * @returns {{
 *   ok: boolean,
 *   verified: number,
 *   brokenAt?: string,
 *   failure?: 'hash_chain'|'hmac',
 *   hmac: { checked: number, unverifiable: number, available: boolean }
 * }}
 */
function verifyAuditChain(orgId) {
  if (!orgId) throw new Error('orgId required');
  const db = getDatabase();

  const { hasHmac, sql } = selectColumns(db);

  const rows = db.prepare(
    `SELECT ${sql}
     FROM audit_logs
     WHERE org_id = ? AND record_hash IS NOT NULL
     ${auditCanonical.CHAIN_ORDER_BY}`
  ).all(orgId);

  const hmacHelpers = hasHmac ? loadHmacHelpers() : null;
  const hmacAvailable = Boolean(hmacHelpers && hmacHelpers.getStatus().available);

  let prev = auditCanonical.GENESIS;
  let verified = 0;
  let hmacChecked = 0;
  let hmacUnverifiable = 0;

  for (const r of rows) {
    const signedString = auditCanonical.buildSignedString(prev, r);

    // Layer 1 — unkeyed hash chain.
    if (r.prev_hash !== prev || r.record_hash !== sha256(signedString)) {
      return {
        ok: false,
        verified,
        brokenAt: r.id,
        failure: 'hash_chain',
        hmac: { checked: hmacChecked, unverifiable: hmacUnverifiable, available: hmacAvailable },
      };
    }

    // Layer 2 — keyed HMAC, when both the row and the key are present.
    if (hasHmac && r.record_hmac) {
      if (!hmacAvailable) {
        hmacUnverifiable += 1;
      } else {
        const expectedHmac = hmacHelpers.computeAuditHmac(signedString);
        if (!expectedHmac || !hmacHelpers.hmacMatches(expectedHmac, r.record_hmac)) {
          return {
            ok: false,
            verified,
            brokenAt: r.id,
            failure: 'hmac',
            hmac: { checked: hmacChecked, unverifiable: hmacUnverifiable, available: hmacAvailable },
          };
        }
        hmacChecked += 1;
      }
    } else if (hasHmac) {
      // Row written before the HMAC layer existed.
      hmacUnverifiable += 1;
    }

    prev = r.record_hash;
    verified += 1;
  }

  return {
    ok: true,
    verified,
    hmac: { checked: hmacChecked, unverifiable: hmacUnverifiable, available: hmacAvailable },
  };
}

module.exports = { verifyAuditChain };
