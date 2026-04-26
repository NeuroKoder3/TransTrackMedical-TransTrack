'use strict';

/**
 * Z-segment registry & extensibility hooks.
 *
 * Z-segments (Z00..ZZZ) are HL7 v2's vendor-extension namespace. Every
 * production EHR sends some, and refusing to parse them silently throws away
 * patient identifiers, encounter detail, and clinical context.
 *
 * This module supports two registration paths:
 *
 *   1. Built-in defaults for the most common vendors. These are conservative;
 *      they extract fields into a generic shape and never modify behaviour.
 *
 *   2. Per-org config, supplied via the hl7_vendor_profiles table. The
 *      ingest service loads the matching profile based on the message's
 *      sending application + facility and merges any z_segments map with
 *      these defaults, last-write-wins.
 *
 * No Z-segment ever fails the message — unknown segments are captured raw
 * into the extracted object so they remain queryable but do not block ACK.
 */

function pickFirst(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return pickFirst(value[0]);
  return value;
}
function pickAt(field, idx) {
  if (field === null || field === undefined) return null;
  if (!Array.isArray(field)) return idx === 0 ? field : null;
  return field[idx] !== undefined ? field[idx] : null;
}

// Built-in handlers, keyed by segment name (uppercase). Each receives the
// parsed segment ({ name, fields }) and must return a plain object.
const BUILTIN_Z_HANDLERS = {
  // Epic-style patient link / source-of-truth segment
  ZPD: (seg) => ({
    purpose: 'patient_link',
    epic_patient_id: pickAt(seg.fields[0], 0),
    cohort: pickFirst(seg.fields[1]),
    source: pickFirst(seg.fields[2]),
  }),

  // Cerner-style patient enterprise master ID
  ZID: (seg) => ({
    purpose: 'patient_link',
    enterprise_id: pickAt(seg.fields[0], 0),
    assigning_facility: pickAt(seg.fields[1], 0),
  }),

  // Visit-extension common to several vendors
  ZPV: (seg) => ({
    purpose: 'visit_extension',
    expected_los_days: pickFirst(seg.fields[0]),
    isolation_required: pickFirst(seg.fields[1]),
    transplant_candidate: pickFirst(seg.fields[2]),
    notes: pickFirst(seg.fields[3]),
  }),

  // Generic transplant-program extension
  ZTX: (seg) => ({
    purpose: 'transplant_extension',
    listed_organ: pickFirst(seg.fields[0]),
    listing_status: pickFirst(seg.fields[1]),
    listing_dt: pickFirst(seg.fields[2]),
    unos_id: pickFirst(seg.fields[3]),
    optn_region: pickFirst(seg.fields[4]),
    meld_score: pickFirst(seg.fields[5]),
    cpra: pickFirst(seg.fields[6]),
  }),

  // Generic financial summary
  ZFS: (seg) => ({
    purpose: 'financial_summary',
    payor_class: pickFirst(seg.fields[0]),
    self_pay_flag: pickFirst(seg.fields[1]),
    expected_amount: pickFirst(seg.fields[2]),
  }),

  // Catch-all: any other Z-segment becomes a raw capture
};

function rawCapture(seg) {
  return {
    purpose: 'raw_capture',
    name: seg.name,
    raw_fields: seg.fields,
  };
}

/**
 * Build a per-message handler map by merging defaults with org config.
 * vendorProfile.config.z_segments is expected to look like:
 *   {
 *     "ZAB": { "purpose": "custom_label",
 *              "fields": { "alpha": 0, "beta": 1, "gamma": [2, 0] } }
 *   }
 * where each "fields" entry is either a numeric (single field) or an
 * array [fieldIdx, componentIdx] (single component within a field).
 */
function buildHandlers(vendorProfile) {
  const handlers = { ...BUILTIN_Z_HANDLERS };
  const fromConfig = vendorProfile?.config?.z_segments;
  if (!fromConfig || typeof fromConfig !== 'object') return handlers;
  for (const [name, spec] of Object.entries(fromConfig)) {
    handlers[name.toUpperCase()] = (seg) => {
      const out = { purpose: spec.purpose || 'vendor_extension' };
      if (spec.fields && typeof spec.fields === 'object') {
        for (const [label, idx] of Object.entries(spec.fields)) {
          if (Array.isArray(idx)) out[label] = pickAt(seg.fields[idx[0]], idx[1] || 0);
          else if (typeof idx === 'number') out[label] = pickFirst(seg.fields[idx]);
        }
      } else {
        out.raw_fields = seg.fields;
      }
      return out;
    };
  }
  return handlers;
}

/**
 * Extract every Z-segment found in `segments` using the supplied handler map.
 * Returns { ZPD: {...}, ZTX: {...}, _other: [{name:'ZAB', purpose:'raw_capture',...}, ...] }
 */
function extractZSegments(segments, vendorProfile) {
  const handlers = buildHandlers(vendorProfile);
  const out = { _other: [] };
  for (const seg of segments) {
    if (!seg.name || !seg.name.startsWith('Z')) continue;
    const handler = handlers[seg.name];
    const parsed = handler ? handler(seg) : rawCapture(seg);
    if (handler) {
      // Multi-occurring Z-segments become arrays
      if (out[seg.name]) {
        out[seg.name] = Array.isArray(out[seg.name]) ? [...out[seg.name], parsed] : [out[seg.name], parsed];
      } else {
        out[seg.name] = parsed;
      }
    } else {
      out._other.push(parsed);
    }
  }
  return out;
}

module.exports = {
  BUILTIN_Z_HANDLERS,
  buildHandlers,
  extractZSegments,
};
