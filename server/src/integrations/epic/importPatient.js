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
 *   - Clinical resources are ALSO materialised into native structured tables:
 *       Observation        → lab_results
 *       Condition          → patient_conditions
 *       MedicationRequest  → patient_medications
 *       AllergyIntolerance → patient_allergies
 *   - One audit log entry per import call: action `integration.epic.import`.
 *
 * Returns:
 *   {
 *     patient,              // the TransTrack patients row (post-upsert)
 *     created,              // boolean - true if a new patient was inserted
 *     stored: {             // counts of FHIR resources persisted (fhir_resources)
 *       observations, conditions, medicationRequests, allergies,
 *     },
 *     materialised: {       // counts written into native structured tables
 *       labResults, conditions, medications, allergies,
 *     },
 *     scopeGranted,         // scope string from Epic, if available
 *   }
 */

const patientService    = require('../../services/patientService');
const labResultService  = require('../../services/labResultService');
const conditionService  = require('../../services/conditionService');
const medicationService = require('../../services/medicationService');
const allergyService    = require('../../services/allergyService');
const audit             = require('../../services/auditService');
const fhirStorage       = require('../../fhir/storage');

// ---------------------------------------------------------------------------
// Patient normalisation helpers
// ---------------------------------------------------------------------------

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
    case 'male':    return 'M';
    case 'female':  return 'F';
    case 'other':   return 'O';
    case 'unknown': return 'U';
    default:        return null;
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
      first_name:    native.first_name    || existing.first_name,
      last_name:     native.last_name     || existing.last_name,
      middle_name:   native.middle_name   || existing.middle_name,
      date_of_birth: native.date_of_birth || existing.date_of_birth,
      sex:           native.sex           || existing.sex,
      phone:         native.phone         || existing.phone,
      email:         native.email         || existing.email,
    });
    return { row: updated || existing, created: false };
  }
  const row = await patientService.create(client, ctx, native);
  return { row, created: true };
}

// ---------------------------------------------------------------------------
// Helpers — store to fhir_resources AND materialise into native tables
// ---------------------------------------------------------------------------

function namespacedId(resource) {
  return resource?.id ? `epic-${resource.id}` : undefined;
}

async function storeToFhir(client, ctx, type, resource) {
  const id = namespacedId(resource);
  await fhirStorage.create(client, ctx, type, { ...resource, id });
  return id;
}

/**
 * Observations → fhir_resources + lab_results
 */
async function persistObservations(client, ctx, patientId, observations) {
  let fhirStored = 0;
  let nativeMaterialised = 0;

  for (const obs of observations || []) {
    if (!obs || obs.resourceType !== 'Observation') continue;
    await storeToFhir(client, ctx, 'Observation', obs);
    fhirStored++;

    const coding = obs.code?.coding?.[0];
    const value = obs.valueQuantity
      ? `${obs.valueQuantity.value}`
      : obs.valueString != null
        ? obs.valueString
        : obs.valueCodeableConcept?.text ?? null;

    if (coding && value != null) {
      await labResultService.create(client, ctx, {
        patient_id:      patientId,
        test_code:       coding.code,
        test_name:       coding.display || coding.code,
        value,
        units:           obs.valueQuantity?.unit || null,
        reference_range: (obs.referenceRange || [])[0]?.text || null,
        result_status:   obs.status || null,
        collected_at:    obs.effectiveDateTime || new Date().toISOString(),
        resulted_at:     obs.issued || null,
        source:          'FHIR_R4',
      });
      nativeMaterialised++;
    }
  }
  return { fhirStored, nativeMaterialised };
}

/**
 * Conditions → fhir_resources + patient_conditions
 */
async function persistConditions(client, ctx, patientId, conditions) {
  let fhirStored = 0;
  let nativeMaterialised = 0;

  for (const cond of conditions || []) {
    if (!cond || cond.resourceType !== 'Condition') continue;
    const fhirId = await storeToFhir(client, ctx, 'Condition', cond);
    fhirStored++;

    const coding  = cond.code?.coding?.[0];
    const display = coding?.display || cond.code?.text || 'Unknown condition';

    await conditionService.create(client, ctx, {
      patient_id:          patientId,
      code:                coding?.code || display,
      code_system:         coding?.system || null,
      display,
      clinical_status:     cond.clinicalStatus?.coding?.[0]?.code || null,
      verification_status: cond.verificationStatus?.coding?.[0]?.code || null,
      category:            cond.category?.[0]?.coding?.[0]?.code || null,
      onset_date:          cond.onsetDateTime?.substring(0, 10) || cond.onsetDate || null,
      abatement_date:      cond.abatementDateTime?.substring(0, 10) || cond.abatementDate || null,
      source:              'FHIR_R4',
      fhir_resource_id:    fhirId || null,
    });
    nativeMaterialised++;
  }
  return { fhirStored, nativeMaterialised };
}

/**
 * MedicationRequests → fhir_resources + patient_medications
 */
async function persistMedicationRequests(client, ctx, patientId, medicationRequests) {
  let fhirStored = 0;
  let nativeMaterialised = 0;

  for (const med of medicationRequests || []) {
    if (!med || med.resourceType !== 'MedicationRequest') continue;
    const fhirId = await storeToFhir(client, ctx, 'MedicationRequest', med);
    fhirStored++;

    const medCC  = med.medicationCodeableConcept;
    const coding = medCC?.coding?.[0];
    const medicationName = coding?.display || medCC?.text || 'Unknown medication';
    const dosage = (med.dosageInstruction || [])[0];

    await medicationService.create(client, ctx, {
      patient_id:       patientId,
      medication_code:  coding?.code || null,
      code_system:      coding?.system || null,
      medication_name:  medicationName,
      status:           med.status || null,
      intent:           med.intent || null,
      dosage_text:      dosage?.text || null,
      frequency:        dosage?.timing?.code?.text || null,
      route:            dosage?.route?.coding?.[0]?.display || dosage?.route?.text || null,
      authored_on:      med.authoredOn?.substring(0, 10) || null,
      prescriber:       med.requester?.display || null,
      source:           'FHIR_R4',
      fhir_resource_id: fhirId || null,
    });
    nativeMaterialised++;
  }
  return { fhirStored, nativeMaterialised };
}

/**
 * AllergyIntolerances → fhir_resources + patient_allergies
 */
async function persistAllergies(client, ctx, patientId, allergies) {
  let fhirStored = 0;
  let nativeMaterialised = 0;

  for (const allergy of allergies || []) {
    if (!allergy || allergy.resourceType !== 'AllergyIntolerance') continue;
    const fhirId = await storeToFhir(client, ctx, 'AllergyIntolerance', allergy);
    fhirStored++;

    const coding  = allergy.code?.coding?.[0];
    const display = coding?.display || allergy.code?.text || 'Unknown allergen';

    await allergyService.create(client, ctx, {
      patient_id:           patientId,
      code:                 coding?.code || null,
      code_system:          coding?.system || null,
      display,
      allergy_type:         allergy.type || null,
      category:             Array.isArray(allergy.category) ? allergy.category[0] : null,
      criticality:          allergy.criticality || null,
      clinical_status:      allergy.clinicalStatus?.coding?.[0]?.code || null,
      verification_status:  allergy.verificationStatus?.coding?.[0]?.code || null,
      reaction_description: allergy.reaction?.[0]?.description ||
                            allergy.reaction?.[0]?.manifestation?.[0]?.text || null,
      onset_date:           allergy.onsetDateTime?.substring(0, 10) || allergy.onsetDate || null,
      source:               'FHIR_R4',
      fhir_resource_id:     fhirId || null,
    });
    nativeMaterialised++;
  }
  return { fhirStored, nativeMaterialised };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bundle mode - persist a pre-fetched Epic bundle.
 */
async function importPatientFromBundle(client, ctx, bundle) {
  if (!bundle?.patient) {
    throw new Error('importPatientFromBundle: bundle.patient is required');
  }
  const { row: patient, created } = await persistPatient(client, ctx, bundle.patient);

  // Persist Patient FHIR resource so SMART/CDS clients can read it.
  const patientFhirId = `epic-${bundle.patient.id}`;
  await fhirStorage.create(client, ctx, 'Patient', {
    ...bundle.patient,
    id: patientFhirId,
    extension: [
      ...(bundle.patient.extension || []),
      { url: 'urn:transtrack:source-system',    valueString: 'epic-on-fhir-sandbox' },
      { url: 'urn:transtrack:native-patient-id', valueString: patient.id },
    ],
  });

  const [obsResult, condResult, medResult, allergyResult] = await Promise.all([
    persistObservations(client, ctx, patient.id, bundle.observations),
    persistConditions(client, ctx, patient.id, bundle.conditions),
    persistMedicationRequests(client, ctx, patient.id, bundle.medicationRequests),
    persistAllergies(client, ctx, patient.id, bundle.allergies),
  ]);

  const stored = {
    observations:       obsResult.fhirStored,
    conditions:         condResult.fhirStored,
    medicationRequests: medResult.fhirStored,
    allergies:          allergyResult.fhirStored,
  };
  const materialised = {
    labResults:  obsResult.nativeMaterialised,
    conditions:  condResult.nativeMaterialised,
    medications: medResult.nativeMaterialised,
    allergies:   allergyResult.nativeMaterialised,
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
      materialised,
      scope_granted: bundle.scopeGranted || null,
      source: 'epic-on-fhir',
    },
  });

  return { patient, created, stored, materialised, scopeGranted: bundle.scopeGranted || null };
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
  // exported for testing
  persistObservations,
  persistConditions,
  persistMedicationRequests,
  persistAllergies,
};
