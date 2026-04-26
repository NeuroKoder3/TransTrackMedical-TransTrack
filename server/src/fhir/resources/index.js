'use strict';

/**
 * Per-resource FHIR R4 hooks. Each entry exports:
 *   - validate(body)             throws if the resource doesn't conform
 *   - postCreate?(client, ctx, body)   optional materialise into native tables
 *
 * The set of resources here was chosen to cover ONC USCDI v3 (United States
 * Core Data for Interoperability), which is the data class set every U.S.
 * EHR is required to expose under ONC HTI-1. Validation here is intentionally
 * shallow — we enforce the structural minimums that downstream code depends on
 * (resourceType, required references) and let the client speak any
 * conformant profile beyond that.
 *
 * Each resource also has a corresponding `searchParam` block in
 * src/fhir/capabilityStatement.js so it shows up in /metadata.
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

function expectType(body, type) {
  if (body.resourceType !== type) throw errors.badRequest(`resourceType must be ${type}`);
}

// ============================================================================
// Existing resources (preserved)
// ============================================================================

const Patient = {
  validate(body) {
    expectType(body, 'Patient');
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
      if (existing) await patientService.update(client, ctx, existing.id, payload);
      else await patientService.create(client, ctx, { mrn, ...payload });
    }
  },
};

const Observation = {
  validate(body) {
    expectType(body, 'Observation');
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
    if (!mrn) return;
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
    expectType(body, 'Encounter');
    if (body.status && typeof body.status !== 'string') throw errors.badRequest('Encounter.status must be a string');
  },
};

const MedicationRequest = {
  validate(body) {
    expectType(body, 'MedicationRequest');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
  },
};

const AllergyIntolerance = {
  validate(body) {
    expectType(body, 'AllergyIntolerance');
    if (!body.patient?.reference) throw errors.badRequest('patient.reference required');
  },
};

// ============================================================================
// USCDI v3 expansion
// ============================================================================

const CarePlan = {
  validate(body) {
    expectType(body, 'CarePlan');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
    if (!body.status) throw errors.badRequest('status required');
  },
};

const CareTeam = {
  validate(body) {
    expectType(body, 'CareTeam');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
  },
};

const Condition = {
  validate(body) {
    expectType(body, 'Condition');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
    if (!body.code?.coding?.length && !body.code?.text) {
      throw errors.badRequest('code.coding or code.text required');
    }
  },
};

const Coverage = {
  validate(body) {
    expectType(body, 'Coverage');
    if (!body.beneficiary?.reference) throw errors.badRequest('beneficiary.reference required');
    if (!body.status) throw errors.badRequest('status required');
  },
};

const Device = {
  validate(body) {
    expectType(body, 'Device');
    if (!body.identifier?.length && !body.udiCarrier?.length) {
      throw errors.badRequest('identifier or udiCarrier required');
    }
  },
};

const DiagnosticReport = {
  validate(body) {
    expectType(body, 'DiagnosticReport');
    if (!body.status) throw errors.badRequest('status required');
    if (!body.code?.coding?.length && !body.code?.text) {
      throw errors.badRequest('code required');
    }
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
  },
};

const DocumentReference = {
  validate(body) {
    expectType(body, 'DocumentReference');
    if (!body.status) throw errors.badRequest('status required');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
    if (!Array.isArray(body.content) || body.content.length === 0) {
      throw errors.badRequest('content required');
    }
  },
};

const Goal = {
  validate(body) {
    expectType(body, 'Goal');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
    if (!body.lifecycleStatus) throw errors.badRequest('lifecycleStatus required');
    if (!body.description?.text && !body.description?.coding?.length) {
      throw errors.badRequest('description required');
    }
  },
};

const Immunization = {
  validate(body) {
    expectType(body, 'Immunization');
    if (!body.status) throw errors.badRequest('status required');
    if (!body.patient?.reference) throw errors.badRequest('patient.reference required');
    if (!body.vaccineCode?.coding?.length && !body.vaccineCode?.text) {
      throw errors.badRequest('vaccineCode required');
    }
  },
};

const Location = {
  validate(body) {
    expectType(body, 'Location');
    if (!body.name && !body.identifier?.length) {
      throw errors.badRequest('name or identifier required');
    }
  },
};

const Medication = {
  validate(body) {
    expectType(body, 'Medication');
    if (!body.code?.coding?.length && !body.code?.text) {
      throw errors.badRequest('code required');
    }
  },
};

const MedicationDispense = {
  validate(body) {
    expectType(body, 'MedicationDispense');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
    if (!body.status) throw errors.badRequest('status required');
  },
};

const MedicationStatement = {
  validate(body) {
    expectType(body, 'MedicationStatement');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
    if (!body.status) throw errors.badRequest('status required');
  },
};

const Organization = {
  validate(body) {
    expectType(body, 'Organization');
    if (!body.name && !body.identifier?.length) {
      throw errors.badRequest('name or identifier required');
    }
  },
};

const Practitioner = {
  validate(body) {
    expectType(body, 'Practitioner');
    if (!Array.isArray(body.name) || body.name.length === 0) {
      throw errors.badRequest('name required');
    }
  },
};

const PractitionerRole = {
  validate(body) {
    expectType(body, 'PractitionerRole');
    if (!body.practitioner?.reference) throw errors.badRequest('practitioner.reference required');
  },
};

const Procedure = {
  validate(body) {
    expectType(body, 'Procedure');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
    if (!body.status) throw errors.badRequest('status required');
    if (!body.code?.coding?.length && !body.code?.text) {
      throw errors.badRequest('code required');
    }
  },
};

const Provenance = {
  validate(body) {
    expectType(body, 'Provenance');
    if (!Array.isArray(body.target) || body.target.length === 0) {
      throw errors.badRequest('target required');
    }
    if (!body.recorded) throw errors.badRequest('recorded required');
  },
};

const RelatedPerson = {
  validate(body) {
    expectType(body, 'RelatedPerson');
    if (!body.patient?.reference) throw errors.badRequest('patient.reference required');
  },
};

const ServiceRequest = {
  validate(body) {
    expectType(body, 'ServiceRequest');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
    if (!body.status) throw errors.badRequest('status required');
    if (!body.intent) throw errors.badRequest('intent required');
  },
};

const Specimen = {
  validate(body) {
    expectType(body, 'Specimen');
    if (!body.subject?.reference) throw errors.badRequest('subject.reference required');
  },
};

const Group = {
  validate(body) {
    expectType(body, 'Group');
    if (typeof body.actual !== 'boolean') throw errors.badRequest('actual (boolean) required');
    if (!body.type) throw errors.badRequest('type required');
  },
};

const Subscription = {
  validate(body) {
    expectType(body, 'Subscription');
    if (!body.status) throw errors.badRequest('status required');
    if (!body.criteria) throw errors.badRequest('criteria required');
    if (!body.channel?.type) throw errors.badRequest('channel.type required');
    const allowed = ['rest-hook', 'websocket', 'message', 'email', 'sms'];
    if (!allowed.includes(body.channel.type)) {
      throw errors.badRequest(`channel.type must be one of: ${allowed.join(', ')}`);
    }
    if (body.channel.type === 'rest-hook' && !body.channel.endpoint) {
      throw errors.badRequest('channel.endpoint is required for rest-hook subscriptions');
    }
  },
  async postCreate(client, ctx, body) {
    // Mirror into fhir_subscriptions registry
    const headers = (body.channel.header || []).reduce((m, h) => {
      const idx = h.indexOf(':');
      if (idx > 0) m[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      return m;
    }, {});
    await client.query(
      `INSERT INTO fhir_subscriptions
         (org_id, fhir_resource_id, status, criteria, channel_type, endpoint,
          payload_mime, header, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (org_id, fhir_resource_id) DO UPDATE
         SET status=EXCLUDED.status, criteria=EXCLUDED.criteria,
             channel_type=EXCLUDED.channel_type, endpoint=EXCLUDED.endpoint,
             payload_mime=EXCLUDED.payload_mime, header=EXCLUDED.header,
             reason=EXCLUDED.reason`,
      [
        ctx.orgId,
        body.id,
        body.status === 'requested' ? 'active' : body.status,
        body.criteria,
        body.channel.type,
        body.channel.endpoint || null,
        body.channel.payload || 'application/fhir+json',
        JSON.stringify(headers),
        body.reason || null,
      ]
    );
  },
};

module.exports = {
  // Original (kept for backwards compatibility)
  Patient,
  Observation,
  Encounter,
  MedicationRequest,
  AllergyIntolerance,
  // USCDI v3 expansion
  CarePlan,
  CareTeam,
  Condition,
  Coverage,
  Device,
  DiagnosticReport,
  DocumentReference,
  Goal,
  Immunization,
  Location,
  Medication,
  MedicationDispense,
  MedicationStatement,
  Organization,
  Practitioner,
  PractitionerRole,
  Procedure,
  Provenance,
  RelatedPerson,
  ServiceRequest,
  Specimen,
  // Bulk Data + Subscriptions support
  Group,
  Subscription,
};
