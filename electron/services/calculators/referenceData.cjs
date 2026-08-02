/**
 * Controlled reference-data registry for the clinical calculators.
 *
 * Finding H-10 recorded that the KDPI and EPTS percentile mappings were
 * hardcoded piecewise approximations pinned to a 2022 cohort with "no update
 * mechanism, no staleness warning, and no version stamp presented to the user",
 * so divergence from the OPTN calculator was guaranteed and silent.
 *
 * This module makes every externally-owned constant a versioned, provenanced
 * data file under ./reference/ rather than a literal in the algorithm. Each
 * file declares the controlled source it was transcribed from, the revision of
 * that source, when the transcription takes effect, and the date by which it
 * must be re-checked against the publisher.
 *
 * Behaviour:
 *   - A table that is absent is NOT silently substituted. Calculators that
 *     depend on it return { reason: 'REFERENCE_DATA_UNAVAILABLE' } and no
 *     score. Refusing to answer is the only safe response to a missing
 *     clinical constant.
 *   - A table past its reviewBy date still computes — a transplant centre must
 *     not lose a calculator overnight — but every result carries
 *     `reference.stale = true` with the overdue day count, the health check
 *     reports a degraded state, and tests/calculatorReferenceVectors.test.cjs
 *     fails the build. The divergence is therefore loud, which is the property
 *     the finding said was missing.
 *
 * The register of sources is docs/compliance/CLINICAL_SOURCES.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REFERENCE_DIR = path.join(__dirname, 'reference');

/** Table ids the calculators may ask for. Unknown ids are a programming error. */
const TABLE_IDS = Object.freeze({
  KDPI: 'optn-kdpi',
  EPTS: 'optn-epts',
  PELD: 'optn-peld',
});

const REQUIRED_META = ['tableId', 'sourceId', 'sourceTitle', 'sourceRevision', 'effectiveDate', 'reviewBy', 'status'];

const cache = new Map();

function parseDate(value) {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Load and validate one reference table.
 *
 * Returns a descriptor that is always safe to consume:
 *   { available, status, reason?, meta, data?, stale, daysOverdue }
 */
function loadTable(tableId, { now = new Date() } = {}) {
  const cached = cache.get(tableId);
  const file = path.join(REFERENCE_DIR, `${tableId}.json`);

  let parsed = cached;
  if (!parsed) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return {
        available: false,
        status: 'MISSING',
        reason: 'REFERENCE_DATA_UNAVAILABLE',
        tableId,
        message:
          `Reference table "${tableId}" is not installed. The calculator that ` +
          `depends on it will not produce a score until the controlled source ` +
          `is transcribed into ${path.relative(process.cwd(), file)}. ` +
          `See docs/compliance/CLINICAL_SOURCES.md.`,
        stale: false,
        daysOverdue: 0,
      };
    }
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        available: false,
        status: 'CORRUPT',
        reason: 'REFERENCE_DATA_UNREADABLE',
        tableId,
        message: `Reference table "${tableId}" is not valid JSON: ${err.message}`,
        stale: false,
        daysOverdue: 0,
      };
    }
    const missingMeta = REQUIRED_META.filter((k) => parsed[k] === undefined);
    if (missingMeta.length > 0) {
      return {
        available: false,
        status: 'INVALID',
        reason: 'REFERENCE_DATA_INVALID',
        tableId,
        message: `Reference table "${tableId}" is missing provenance fields: ${missingMeta.join(', ')}`,
        stale: false,
        daysOverdue: 0,
      };
    }
    cache.set(tableId, parsed);
  }

  const meta = {
    tableId: parsed.tableId,
    sourceId: parsed.sourceId,
    sourceTitle: parsed.sourceTitle,
    sourceUrl: parsed.sourceUrl || null,
    sourceRevision: parsed.sourceRevision,
    effectiveDate: parsed.effectiveDate,
    reviewBy: parsed.reviewBy,
    transcribedBy: parsed.transcribedBy || null,
    approximation: parsed.approximation === true,
    approximationNote: parsed.approximationNote || null,
  };

  // A table can declare itself unusable, which is how a formula whose
  // controlled coefficients the vendor may not redistribute is represented.
  if (parsed.status !== 'ACTIVE') {
    return {
      available: false,
      status: parsed.status,
      reason: 'REFERENCE_DATA_UNAVAILABLE',
      tableId,
      meta,
      message: parsed.statusReason || `Reference table "${tableId}" is not active.`,
      stale: false,
      daysOverdue: 0,
    };
  }

  const reviewBy = parseDate(parsed.reviewBy);
  const daysOverdue = reviewBy
    ? Math.max(0, Math.floor((now.getTime() - reviewBy.getTime()) / 86400000))
    : 0;

  return {
    available: true,
    status: 'ACTIVE',
    tableId,
    meta,
    data: parsed.data,
    stale: daysOverdue > 0,
    daysOverdue,
  };
}

/**
 * Provenance block attached to every calculator result so the value a clinician
 * sees always names the source revision it came from.
 */
function provenanceOf(table) {
  return {
    sourceId: table.meta?.sourceId ?? null,
    sourceRevision: table.meta?.sourceRevision ?? null,
    effectiveDate: table.meta?.effectiveDate ?? null,
    reviewBy: table.meta?.reviewBy ?? null,
    approximation: table.meta?.approximation ?? null,
    stale: table.stale,
    daysOverdue: table.daysOverdue,
  };
}

/** Every table's status, for the health check and the Compliance Center. */
function statusReport({ now = new Date() } = {}) {
  return Object.values(TABLE_IDS).map((id) => {
    const t = loadTable(id, { now });
    return {
      tableId: id,
      available: t.available,
      status: t.status,
      sourceRevision: t.meta?.sourceRevision ?? null,
      reviewBy: t.meta?.reviewBy ?? null,
      stale: t.stale,
      daysOverdue: t.daysOverdue,
      message: t.message || null,
    };
  });
}

/** Test seam — reference files are read once and memoised. */
function clearCache() {
  cache.clear();
}

module.exports = { TABLE_IDS, loadTable, provenanceOf, statusReport, clearCache, REFERENCE_DIR };
