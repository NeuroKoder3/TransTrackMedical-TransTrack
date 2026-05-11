'use strict';

const { withTransaction, query } = require('../db/pool');

/**
 * HL7 vendor profile service. Each org may register one or more vendor
 * profiles describing how the EHR speaks HL7 v2.
 *
 * findFor() is called from the MLLP listener on each inbound message and
 * must be cheap. We cache the active profiles per org for 60 seconds.
 */

/**
 * Reject patterns with nested quantifiers or backreferences that
 * can cause catastrophic backtracking (ReDoS).
 */
function isSafeRegex(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 200) return false;
  if (/(\*|\+|\{)\s*(\*|\+|\{)/.test(pattern)) return false;
  if (/(\.\*){3,}/.test(pattern)) return false;
  return true;
}

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // orgId -> { ts, profiles: [] }

async function loadActive(orgId) {
  const now = Date.now();
  const cur = cache.get(orgId);
  if (cur && now - cur.ts < CACHE_TTL_MS) return cur.profiles;
  // Use a fresh transaction with the orgId so RLS lets us read.
  const profiles = await withTransaction({ orgId }, async (client) => {
    const r = await client.query(
      `SELECT id, vendor_name, sending_app_pattern, mrn_authority, config
       FROM hl7_vendor_profiles
       WHERE org_id = $1 AND is_active = TRUE
       ORDER BY vendor_name ASC`,
      [orgId]
    );
    return r.rows;
  });
  cache.set(orgId, { ts: now, profiles });
  return profiles;
}

function invalidate(orgId) {
  cache.delete(orgId);
}

/**
 * Find the first profile whose sending_app_pattern matches the inbound
 * sending application (MSH-3) and (optionally) facility.
 */
async function findFor(ctx, sendingApp, sendingFacility) {
  if (!ctx?.orgId) return null;
  const profiles = await loadActive(ctx.orgId);
  if (!profiles.length) return null;
  const haystack = `${sendingApp || ''}|${sendingFacility || ''}`;
  for (const p of profiles) {
    try {
      if (!isSafeRegex(p.sending_app_pattern)) continue;
      const re = new RegExp(p.sending_app_pattern, 'i');
      if (re.test(sendingApp || '') || re.test(haystack)) return p;
    } catch (_e) {
      // ignore bad regex; admin should fix
    }
  }
  return null;
}

async function list(ctx) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `SELECT id, vendor_name, sending_app_pattern, mrn_authority, config, is_active,
              created_at, updated_at
       FROM hl7_vendor_profiles
       WHERE org_id = $1
       ORDER BY vendor_name ASC`,
      [ctx.orgId]
    );
    return r.rows;
  });
}

async function create(ctx, input) {
  return withTransaction(ctx, async (client) => {
    const r = await client.query(
      `INSERT INTO hl7_vendor_profiles
         (org_id, vendor_name, sending_app_pattern, mrn_authority, config, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, vendor_name, sending_app_pattern, mrn_authority, config, is_active`,
      [
        ctx.orgId,
        input.vendor_name,
        input.sending_app_pattern,
        input.mrn_authority || null,
        JSON.stringify(input.config || {}),
        input.is_active !== false,
      ]
    );
    invalidate(ctx.orgId);
    return r.rows[0];
  });
}

async function update(ctx, id, input) {
  return withTransaction(ctx, async (client) => {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(input)) {
      if (!['vendor_name','sending_app_pattern','mrn_authority','config','is_active'].includes(k)) continue;
      vals.push(k === 'config' ? JSON.stringify(v) : v);
      sets.push(`${k} = $${vals.length}`);
    }
    if (!sets.length) {
      const r = await client.query(
        `SELECT id, vendor_name, sending_app_pattern, mrn_authority, config, is_active
         FROM hl7_vendor_profiles WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, id]
      );
      return r.rows[0] || null;
    }
    vals.push(ctx.orgId, id);
    const r = await client.query(
      `UPDATE hl7_vendor_profiles SET ${sets.join(', ')}
       WHERE org_id = $${vals.length - 1} AND id = $${vals.length}
       RETURNING id, vendor_name, sending_app_pattern, mrn_authority, config, is_active`,
      vals
    );
    invalidate(ctx.orgId);
    return r.rows[0] || null;
  });
}

async function remove(ctx, id) {
  return withTransaction(ctx, async (client) => {
    await client.query(
      `DELETE FROM hl7_vendor_profiles WHERE org_id = $1 AND id = $2`,
      [ctx.orgId, id]
    );
    invalidate(ctx.orgId);
    return { deleted: true };
  });
}

/**
 * Seed the defaults for the major US EHRs. Idempotent.
 */
async function seedDefaults(ctx) {
  return withTransaction(ctx, async (client) => {
    const seeds = [
      {
        vendor: 'Epic',
        pattern: '^EPIC.*|^Hyperspace.*|.*\\|EPIC',
        mrn: 'EPIC',
        config: {
          z_segments: {
            ZPD: { purpose: 'patient_link', fields: { epic_patient_id: [0, 0], cohort: 1 } },
            ZTX: { purpose: 'transplant_extension', fields: { listed_organ: 0, listing_status: 1, unos_id: 3 } },
          },
          adt_facility_field: 'MSH-4',
          notes: 'Epic Bridges/IRIS HL7 dialect.',
        },
      },
      {
        vendor: 'Oracle Health (Cerner)',
        pattern: '^MILLENNIUM.*|^CERNER.*|.*\\|CERNER',
        mrn: 'CERNER',
        config: {
          z_segments: {
            ZID: { purpose: 'patient_link', fields: { enterprise_id: [0, 0], facility: [1, 0] } },
          },
          notes: 'Cerner Millennium / OHC HL7 dialect.',
        },
      },
      {
        vendor: 'Meditech',
        pattern: '^MEDITECH.*|^MEDI.*|.*\\|MEDITECH',
        mrn: 'MEDITECH',
        config: {
          notes: 'Meditech Magic / 6.x / Expanse HL7 dialect.',
        },
      },
      {
        vendor: 'Allscripts / Veradigm',
        pattern: '^SUNRISE.*|^TouchWorks.*|^Allscripts.*|.*\\|ALLSCRIPTS',
        mrn: 'ALLSCRIPTS',
        config: {
          notes: 'Allscripts/Veradigm HL7 dialect.',
        },
      },
      {
        vendor: 'athenahealth',
        pattern: '^ATHENA.*|.*\\|ATHENA',
        mrn: 'ATHENA',
        config: {
          notes: 'athenahealth HL7 dialect.',
        },
      },
      {
        vendor: 'NextGen',
        pattern: '^NEXTGEN.*|.*\\|NEXTGEN',
        mrn: 'NEXTGEN',
        config: { notes: 'NextGen HL7 dialect.' },
      },
      {
        vendor: 'eClinicalWorks',
        pattern: '^ECW.*|^eClinicalWorks.*|.*\\|ECW',
        mrn: 'ECW',
        config: { notes: 'eClinicalWorks HL7 dialect.' },
      },
    ];
    let inserted = 0;
    for (const s of seeds) {
      const exists = await client.query(
        `SELECT id FROM hl7_vendor_profiles WHERE org_id = $1 AND vendor_name = $2`,
        [ctx.orgId, s.vendor]
      );
      if (exists.rows.length) continue;
      await client.query(
        `INSERT INTO hl7_vendor_profiles
           (org_id, vendor_name, sending_app_pattern, mrn_authority, config, is_active)
         VALUES ($1,$2,$3,$4,$5,TRUE)`,
        [ctx.orgId, s.vendor, s.pattern, s.mrn, JSON.stringify(s.config)]
      );
      inserted++;
    }
    invalidate(ctx.orgId);
    return { seeded: inserted, total: seeds.length };
  });
}

// Suppress unused-import warning
void query;

module.exports = { findFor, list, create, update, remove, seedDefaults, invalidate };
