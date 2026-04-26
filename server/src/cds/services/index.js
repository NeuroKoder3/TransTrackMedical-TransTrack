'use strict';

/**
 * Sample/built-in CDS services. These demonstrate the framework and
 * provide immediate value for transplant workflows. Production deployments
 * are expected to register additional services via the registry API.
 */

const registry = require('../registry');
const { withTransaction } = require('../../db/pool');

// ---------------------------------------------------------------------------
// patient-view: transplant-candidate banner
// Fires whenever the EHR opens a patient chart. If the patient is on our
// waitlist, surface their priority score, MELD/LAS, and current status.
// ---------------------------------------------------------------------------
registry.register({
  id: 'transplant-candidate-summary',
  hook: 'patient-view',
  title: 'Transplant candidate summary',
  description: 'Surfaces transplant waitlist status and priority for the open patient.',
  prefetch: {
    patient: 'Patient/{{context.patientId}}',
  },
  async handler(req) {
    const patientId = req.context?.patientId;
    if (!patientId) return { cards: [] };
    // Patient may be referenced via FHIR id or MRN; try both.
    const cards = [];
    const mrn = (req.prefetch?.patient?.identifier || [])[0]?.value || patientId;
    const native = await withTransaction(reqAuth(req), async (client) => {
      const r = await client.query(
        `SELECT id, first_name, last_name, mrn, organ_needed,
                waitlist_status, medical_urgency, priority_score,
                meld_score, las_score, blood_type
         FROM patients WHERE org_id = $1 AND (mrn = $2 OR id::text = $2)
         LIMIT 1`,
        [reqAuth(req).orgId, mrn]
      );
      return r.rows[0] || null;
    });
    if (!native) return { cards: [] };
    const detailLines = [
      `**Organ needed:** ${native.organ_needed || 'not set'}`,
      `**Waitlist status:** ${native.waitlist_status}`,
      `**Medical urgency:** ${native.medical_urgency}`,
      `**Priority score:** ${native.priority_score ?? 'n/a'}`,
      native.meld_score ? `**MELD:** ${native.meld_score}` : null,
      native.las_score ? `**LAS:** ${native.las_score}` : null,
      `**Blood type:** ${native.blood_type || 'n/a'}`,
    ].filter(Boolean).join('\n');
    cards.push(registry.card({
      summary: `Transplant candidate (${native.organ_needed || 'organ TBD'})`,
      indicator: native.medical_urgency === 'critical' ? 'critical'
               : native.medical_urgency === 'high' ? 'warning' : 'info',
      detail: detailLines,
      source: { label: 'TransTrack', url: 'https://transtrack.local' },
    }));
    return { cards };
  },
});

// ---------------------------------------------------------------------------
// order-select: nephrotoxic-medication advisory for transplant candidates
// Fires when the clinician is selecting an order in CPOE.
// ---------------------------------------------------------------------------
registry.register({
  id: 'nephrotoxic-medication-advisory',
  hook: 'order-select',
  title: 'Nephrotoxic medication advisory (transplant candidates)',
  description: 'Warns when ordering common nephrotoxic agents on a kidney transplant candidate.',
  prefetch: {
    patient: 'Patient/{{context.patientId}}',
    medications: 'MedicationRequest?patient={{context.patientId}}&status=active',
  },
  async handler(req) {
    const patientId = req.context?.patientId;
    if (!patientId) return { cards: [] };
    const ordered = (req.context?.draftOrders?.entry || [])
      .map(e => e.resource)
      .filter(r => r?.resourceType === 'MedicationRequest');
    if (!ordered.length) return { cards: [] };
    const NEPHROTOXIC = new Set(['gentamicin','tobramycin','amikacin','vancomycin',
      'amphotericin b','cisplatin','methotrexate','ibuprofen','naproxen','ketorolac',
      'tacrolimus','cyclosporine','foscarnet']);
    const flagged = ordered.filter(o => {
      const name = (o.medicationCodeableConcept?.text
        || o.medicationCodeableConcept?.coding?.[0]?.display
        || '').toLowerCase();
      return Array.from(NEPHROTOXIC).some(d => name.includes(d));
    });
    if (!flagged.length) return { cards: [] };
    const native = await withTransaction(reqAuth(req), async (client) => {
      const r = await client.query(
        `SELECT id, organ_needed, waitlist_status FROM patients
         WHERE org_id = $1 AND (mrn = $2 OR id::text = $2) LIMIT 1`,
        [reqAuth(req).orgId, patientId]
      );
      return r.rows[0] || null;
    });
    if (!native || (native.organ_needed || '').toLowerCase() !== 'kidney') {
      return { cards: [] };
    }
    return {
      cards: flagged.map(med => registry.card({
        summary: `Nephrotoxic medication on kidney transplant candidate`,
        indicator: 'warning',
        detail: `${med.medicationCodeableConcept?.text || 'this medication'} is potentially nephrotoxic. ` +
                `Confirm dose adjustment for renal function and consider therapeutic drug monitoring.`,
        source: { label: 'TransTrack' },
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// order-sign: HLA antibody screen reminder before transplant-related orders
// ---------------------------------------------------------------------------
registry.register({
  id: 'hla-screening-reminder',
  hook: 'order-sign',
  title: 'HLA antibody screening reminder',
  description: 'Reminds clinicians to verify recent HLA antibody screening before transplant-relevant orders.',
  prefetch: {
    patient: 'Patient/{{context.patientId}}',
  },
  async handler(req) {
    const patientId = req.context?.patientId;
    if (!patientId) return { cards: [] };
    const native = await withTransaction(reqAuth(req), async (client) => {
      const p = await client.query(
        `SELECT id, organ_needed FROM patients
         WHERE org_id = $1 AND (mrn = $2 OR id::text = $2) LIMIT 1`,
        [reqAuth(req).orgId, patientId]
      );
      if (!p.rows[0]) return null;
      const recent = await client.query(
        `SELECT collected_at FROM lab_results
         WHERE org_id = $1 AND patient_id = $2
           AND test_name ILIKE '%HLA%antibody%'
         ORDER BY collected_at DESC LIMIT 1`,
        [reqAuth(req).orgId, p.rows[0].id]
      );
      return { patient: p.rows[0], lastHla: recent.rows[0]?.collected_at || null };
    });
    if (!native?.patient) return { cards: [] };
    const ageMonths = native.lastHla
      ? (Date.now() - new Date(native.lastHla).getTime()) / (1000 * 60 * 60 * 24 * 30)
      : 999;
    if (ageMonths < 3) return { cards: [] };
    return {
      cards: [registry.card({
        summary: native.lastHla
          ? `HLA antibody screen is ${Math.round(ageMonths)} months old`
          : 'No HLA antibody screen on file',
        indicator: ageMonths > 6 ? 'warning' : 'info',
        detail: 'Per protocol, HLA antibody screening should be repeated every 3 months for ' +
                'active waitlist candidates.',
        source: { label: 'TransTrack' },
      })],
    };
  },
});

function reqAuth(req) {
  return req.__auth || {};
}

module.exports = { registry };
