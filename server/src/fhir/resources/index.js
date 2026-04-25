'use strict';

/**
 * Per-resource hooks. Each entry exports:
 *   - validate(body)       : throws if the resource doesn't conform
 *   - postCreate(client, ctx, resource)  : optional materialise into native tables
 */

const { errors } = require('../../util/errors');
const patientService = require('../../services/patientService');
const labResultService = require('../../services/labResultService');

function requireField(obj, path, label) {
  const segs = path.split('.');
  let cur = obj;
  for (const s of segs) {
    if (cur == null) throw errors.badRequest(`${label} (${path}) is required`);
    cur = cur[s];
  }
  if (cur == null || cur === '') throw errors.badRequest(`${label} (${path}) is required`);
}

const Patient = {
  validate(body) {
    if (body.resourceType !== 'Patient') throw errors.badRequest('resourceType must be Patient');
    if (!Array.isArray(body.name) || body.name.length === 0) {
      throw errors.badRequest('Patient.name is required');
    }
    requireField(body.name[0], 'family', 'Patient.name[0].family');
  },
  async postCreate(client, ctx, body) {
    const ident = (body.identifier || [])[0];
    const mrn = ident?.value || null;
    const name = body.name?.[0] || {};
    const familyName = name.family;
    const givenName = (name.given || [])[0];
    const middleName = (name.given || [])[1];
    if (mrn) {
      const existing = await patientService.getByMrn(client, ctx, mrn);
      const payload = {
        first_name: givenName || 'UNKNOWN',
        last_name: familyName,
        middle_name: middleName,
        date_of_birth: body.birthDate,
        sex: body.gender,
        phone: (body.telecom || []).find(t => t.system === 'phone')?.value,
        email: (body.telecom || []).find(t => t.system === 'email')?.value,
      };
      if (existing) {
        await patientService.update(client, ctx, existing.id, payload);
      } else {
        await patientService.create(client, ctx, { mrn, ...payload });
      }
    }
  },
};

const Observation = {
  validate(body) {
    if (body.resourceType !== 'Observation') throw errors.badRequest('resourceType must be Observation');
    if (!body.code?.coding?.length) throw errors.badRequest('Observation.code.coding is required');
    if (!body.subject?.reference) throw errors.badRequest('Observation.subject.reference is required');
  },
  async postCreate(client, ctx, body) {
    const subject = body.subject?.reference || '';
    const fhirPatientId = subject.replace(/^Patient\//, '');
    const fhirPatient = await client.query(
      `SELECT body FROM fhir_resources
       WHERE org_id = $1 AND resource_type = 'Patient' AND resource_id = $2`,
      [ctx.orgId, fhirPatientId]
    );
    const mrn = fhirPatient.rows[0]?.body?.identifier?.[0]?.value;
    if (!mrn) return; // can't reconcile to a native patient
    const native = await patientService.getByMrn(client, ctx, mrn);
    if (!native) return;
    const coding = body.code.coding[0];
    const value = body.valueQuantity
      ? `${body.valueQuantity.value}`
      : body.valueString
      ? body.valueString
      : body.valueCodeableConcept?.text || null;
    if (value == null) return;
    await labResultService.create(client, ctx, {
      patient_id: native.id,
      test_code: coding.code,
      test_name: coding.display || coding.code,
      value,
      units: body.valueQuantity?.unit || null,
      reference_range: (body.referenceRange || [])[0]?.text || null,
      result_status: body.status || null,
      collected_at: body.effectiveDateTime || new Date().toISOString(),
      resulted_at: body.issued || null,
      source: 'FHIR_R4',
    });
  },
};

const Encounter = {
  validate(body) {
    if (body.resourceType !== 'Encounter') throw errors.badRequest('resourceType must be Encounter');
  },
};

const MedicationRequest = {
  validate(body) {
    if (body.resourceType !== 'MedicationRequest') throw errors.badRequest('resourceType must be MedicationRequest');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
  },
};

const AllergyIntolerance = {
  validate(body) {
    if (body.resourceType !== 'AllergyIntolerance') throw errors.badRequest('resourceType must be AllergyIntolerance');
    if (!body.patient?.reference) throw errors.badRequest('patient.reference required');
  },
};

module.exports = {
  Patient,
  Observation,
  Encounter,
  MedicationRequest,
  AllergyIntolerance,
};
