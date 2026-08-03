'use strict';

/**
 * PHI-free summaries of a CDS Hooks exchange (H-12).
 *
 * A CDS Hooks request body contains the patient context and every prefetched
 * FHIR resource; a response contains card summary/detail text that routinely
 * quotes patient data. Neither can be stored in an audit table without
 * creating a second unredacted clinical record.
 *
 * These builders keep only what an operator needs to answer "did this hook
 * fire, against what shape of data, and what came back": names of keys,
 * resource types, counts, sizes and indicators. No field value from the
 * request or response is copied through, and free text is never copied.
 */

/** FHIR resource type of one prefetch entry, whether it is a resource or a Bundle. */
function prefetchResourceTypes(prefetch) {
  const counts = {};
  const bump = (type, n = 1) => {
    if (typeof type !== 'string' || !/^[A-Za-z]+$/.test(type)) return;
    counts[type] = (counts[type] || 0) + n;
  };
  for (const value of Object.values(prefetch || {})) {
    if (!value || typeof value !== 'object') continue;
    if (value.resourceType === 'Bundle') {
      const entries = Array.isArray(value.entry) ? value.entry : [];
      for (const e of entries) bump(e?.resource?.resourceType);
      if (entries.length === 0) bump('Bundle');
      continue;
    }
    bump(value.resourceType);
  }
  return counts;
}

function byteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value) || '', 'utf8');
  } catch {
    return null;
  }
}

/**
 * Summarise the inbound CDS Hooks request. Records the shape of the payload,
 * never its values.
 */
function summariseRequest(body) {
  const b = body || {};
  const context = b.context && typeof b.context === 'object' ? b.context : {};
  const draftOrders = context.draftOrders;
  return {
    hook: typeof b.hook === 'string' ? b.hook : null,
    contextKeys: Object.keys(context).sort(),
    prefetchKeys: Object.keys(b.prefetch || {}).sort(),
    prefetchResourceTypes: prefetchResourceTypes(b.prefetch),
    draftOrderCount: Array.isArray(draftOrders?.entry) ? draftOrders.entry.length : 0,
    hasFhirAuthorization: !!b.fhirAuthorization,
    requestBytes: byteLength(b),
  };
}

/**
 * Summarise the outbound CDS Hooks response. Card summary and detail are
 * clinician-facing prose about a specific patient and are excluded; the
 * indicator, source label and counts are not.
 */
function summariseResponse(response) {
  const cards = Array.isArray(response?.cards) ? response.cards : [];
  const indicators = {};
  const sources = new Set();
  let suggestionCount = 0;
  let linkCount = 0;
  for (const card of cards) {
    const indicator = typeof card?.indicator === 'string' ? card.indicator : 'unknown';
    indicators[indicator] = (indicators[indicator] || 0) + 1;
    if (typeof card?.source?.label === 'string') sources.add(card.source.label);
    if (Array.isArray(card?.suggestions)) suggestionCount += card.suggestions.length;
    if (Array.isArray(card?.links)) linkCount += card.links.length;
  }
  return {
    cardCount: cards.length,
    cardIndicators: indicators,
    cardSources: [...sources].sort(),
    suggestionCount,
    linkCount,
    systemActionCount: Array.isArray(response?.systemActions) ? response.systemActions.length : 0,
    responseBytes: byteLength(response),
  };
}

module.exports = { summariseRequest, summariseResponse, prefetchResourceTypes };
