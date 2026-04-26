'use strict';

/**
 * CDS Hooks service registry.
 *
 * A CDS service is registered with:
 *   id          unique identifier (used in the URL: /cds-services/<id>)
 *   hook        one of: patient-view, order-select, order-sign, order-dispatch,
 *               appointment-book, encounter-start, encounter-discharge
 *   title       human-readable
 *   description longer description
 *   prefetch    map of FHIR-resource templates the EHR should fetch first
 *   handler     async (request) => { cards: [...] }
 *
 * The framework records every invocation in cds_service_invocations for
 * audit and tuning.
 */

const services = new Map();

function register(spec) {
  if (!spec.id || !spec.hook || typeof spec.handler !== 'function') {
    throw new Error('CDS service must have id, hook, and handler');
  }
  services.set(spec.id, spec);
}

function list() {
  return Array.from(services.values()).map(s => ({
    id: s.id,
    hook: s.hook,
    title: s.title || s.id,
    description: s.description || '',
    prefetch: s.prefetch || undefined,
  }));
}

function get(id) {
  return services.get(id) || null;
}

function clear() {
  services.clear();
}

// ---------------------------------------------------------------------------
// Card / suggestion helpers — per the CDS Hooks 1.1 spec
// ---------------------------------------------------------------------------

function card({ summary, indicator = 'info', detail, source, suggestions, links, selectionBehavior }) {
  return {
    summary,
    indicator,
    detail,
    source: source || { label: 'TransTrack' },
    suggestions: suggestions || undefined,
    selectionBehavior: selectionBehavior || (suggestions ? 'at-most-one' : undefined),
    links: links || undefined,
    uuid: require('crypto').randomUUID(),
  };
}

module.exports = { register, list, get, clear, card };
