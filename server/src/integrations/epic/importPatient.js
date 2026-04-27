'use strict';

/**
 * Import a single patient (and the USCDI-core data around them) from
 * Epic on FHIR into TransTrack.
 *
 * Two execution modes:
 *
 *   1. Server-fetch:  caller passes an Epic client (see ./client.js) plus the
 *                     Epic Patient ID. We pull demographics, labs, problems,
 *                     medications, and allergies from Epic, then persist.
 *   2. Bundle:        caller passes a pre-fetched bundle (same shape that
 *                     fetchPatientBundle returns). We just persist. Useful
 *                     for the smoke test or for SMART apps that already
 *                     have the data client-side.
 *
 * Persistence:
 *   - native `patients` row, upserted by (org_id, mrn). MRN comes from
 *     identifier with system containing "MRN" (case-insensitive), or the
 *     first identifier value otherwise. If no identifier is present, the
 *     Epic Patient resource id is used as the MRN.
 *   - FHIR resources are written to `fhir_resources` via fhir/storage.create.
 *     Resource ids are namespaced as `epic-<original-id>` to avoid colliding
 *     with native FHIR rows.
 *   - One audit log entry per import call: action `integration.epic.import`.
 *
 * Returns:
 *   {
 *     patient,              // the TransTrack patients row (post-upsert)
 *     created,              // boolean - true if a new patient was inserted
 *     stored: {             // counts of FHIR resources persisted
 *       observations, conditions, medicationRequests, allergies,
 *     },
 *     scopeGranted,         // scope string from Epic, if available
 *   }
 */

const patientService = require('../../services/patientService');
const audit = require('../../services/auditService');
const fhirStorage = require('../../fhir/storage');

function pickName(patient) {
  const n =
    (patient?.name || []).find((x) => x.use === 'official') ||
    patient?.name?.[0] ||
    {};
  const family = n.family || 'UNKNOWN';
  const given = Array.isArray(n.given) && n.given.length ? n.given : [];
  return {
    first_name: given[0] || 'UNKNOWN',
    middle_name: given.slice(1).join(' ') || null,
    last_name: family,
  };
}

function pickMrn(patient) {
  const ids = Array.isArray(patient?.identifier) ? patient.identifier : [];
  const mrn = ids.find((i) => {
    const sys = (i.system || '').toLowerCase();
    const code = i.type?.coding?.[0]?.code || '';
    return (
      sys.includes('mrn') ||
      sys.includes('medicalrecordnumber') ||
      code === 'MR' ||
      code === 'MRN'
    );
  });
  if (mrn?.value) return mrn.value;
  if (ids[0]?.value) return ids[0].value;
  if (patient?.id) return `epic-${patient.id}`;
  return null;
}

function pickPhone(patient) {
  const t = (patient?.telecom || []).find(
    (x) => x.system === 'phone' && (x.use === 'home' || x.use === 'mobile' || !x.use),
  );
  return t?.value || null;
}

function pickEmail(patient) {
  const t = (patient?.telecom || []).find((x) => x.system === 'email');
  return t?.value || null;
}

function mapGender(g) {
  switch ((g || '').toLowerCase()) {
    case 'male':   return 'M';
    case 'female': return 'F';
    case 'other':  return 'O';
    case 'unknown': return 'U';
    default: return null;
  }
}

function normalizePatient(patient) {
  if (!patient || patient.resourceType !== 'Patient') {
    throw new Error('normalizePatient: not a FHIR Patient resource');
  }
  const { first_name, middle_name, last_name } = pickName(patient);
  return {
    mrn: pickMrn(patient),
    first_name,
    middle_name,
    last_name,
    date_of_birth: patient.birthDate || null,
    sex: mapGender(patient.gender),
    phone: pickPhone(patient),
    email: pickEmail(patient),
    notes:
      `Imported from Epic on FHIR (Patient/${patient.id}) on ` +
      `${new Date().toISOString()}.`,
  };
}

async function persistPatient(client, ctx, patient) {
  const native = normalizePatient(patient);
  if (!native.mrn) {
    throw new Error('Epic Patient resource has no usable identifier / MRN');
  }
  const existing = await patientService.getByMrn(client, ctx, native.mrn);
  if (existing) {
    const updated = await patientService.update(client, ctx, existing.id, {
      first_name: native.first_name || existing.first_name,
      last_name: native.last_name || existing.last_name,
      middle_name: native.middle_name || existing.middle_name,
      date_of_birth: native.date_of_birth || existing.date_of_birth,
      sex: native.sex || existing.sex,
      phone: native.phone || existing.phone,
      email: native.email || existing.email,
    });
    return { row: updated || existing, created: false };
  }
  const row = await patientService.create(client, ctx, native);
  return { row, created: true };
}

async function persistFhirCollection(client, ctx, type, resources) {
  let n = 0;
  for (const r of resources || []) {
    if (!r || r.resourceType !== type) continue;
    const namespacedId = r.id ? `epic-${r.id}` : undefined;
    await fhirStorage.create(client, ctx, type, { ...r, id: namespacedId });
    n += 1;
  }
  return n;
}

/**
 * Bundle mode - persist a pre-fetched Epic bundle.
 */
async function importPatientFromBundle(client, ctx, bundle) {
  if (!bundle?.patient) {
    throw new Error('importPatientFromBundle: bundle.patient is required');
  }
  const { row: patient, created } = await persistPatient(
    client,
    ctx,
    bundle.patient,
  );

  // Persist Patient FHIR resource as well so SMART/CDS clients can read it.
  const patientFhirId = `epic-${bundle.patient.id}`;
  await fhirStorage.create(client, ctx, 'Patient', {
    ...bundle.patient,
    id: patientFhirId,
    extension: [
      ...(bundle.patient.extension || []),
      {
        url: 'urn:transtrack:source-system',
        valueString: 'epic-on-fhir-sandbox',
      },
      {
        url: 'urn:transtrack:native-patient-id',
        valueString: patient.id,
      },
    ],
  });

  const stored = {
    observations: await persistFhirCollection(
      client, ctx, 'Observation', bundle.observations,
    ),
    conditions: await persistFhirCollection(
      client, ctx, 'Condition', bundle.conditions,
    ),
    medicationRequests: await persistFhirCollection(
      client, ctx, 'MedicationRequest', bundle.medicationRequests,
    ),
    allergies: await persistFhirCollection(
      client, ctx, 'AllergyIntolerance', bundle.allergies,
    ),
  };

  await audit.record(client, ctx, {
    action: 'integration.epic.import',
    entityType: 'patient',
    entityId: patient.id,
    patientName: `${patient.last_name}, ${patient.first_name}`,
    details: {
      epic_patient_id: bundle.patient.id,
      created,
      mrn: patient.mrn,
      stored,
      scope_granted: bundle.scopeGranted || null,
      source: 'epic-on-fhir',
    },
  });

  return {
    patient,
    created,
    stored,
    scopeGranted: bundle.scopeGranted || null,
  };
}

/**
 * Server-fetch mode - have the supplied Epic client pull the bundle, then
 * delegate to bundle mode for persistence.
 */
async function importPatientFromEpic(client, ctx, epicClient, epicPatientId) {
  if (!epicClient || typeof epicClient.fetchPatientBundle !== 'function') {
    throw new Error(
      'importPatientFromEpic: epicClient with fetchPatientBundle is required',
    );
  }
  const bundle = await epicClient.fetchPatientBundle(epicPatientId);
  return importPatientFromBundle(client, ctx, bundle);
}

module.exports = {
  normalizePatient,
  pickMrn,
  pickName,
  importPatientFromBundle,
  importPatientFromEpic,
};
