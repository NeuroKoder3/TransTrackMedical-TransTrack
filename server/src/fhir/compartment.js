'use strict';

/**
 * FHIR R4 patient compartment enforcement.
 *
 * Source: HL7 FHIR R4 (v4.0.1) CompartmentDefinition/patient
 *   http://hl7.org/fhir/R4/compartmentdefinition-patient.html
 * Reviewed against R4 4.0.1, 2026-08-02. See docs/compliance/CLINICAL_SOURCES.md
 * for the controlled-source register entry (SRC-FHIR-R4-COMPARTMENT).
 *
 * A SMART on FHIR token carrying only `patient/`-level scopes is authorised for
 * exactly one patient — the launch-context patient. This module is the single
 * authority for deciding whether a stored resource falls inside that patient's
 * compartment, and it is applied at the storage layer so that no route can
 * forget it.
 *
 * Design rules:
 *   - Fail closed. A resource type that is not listed here is NOT in any
 *     patient compartment, so patient-scoped tokens are denied outright.
 *   - The same path map drives both the in-process check (single-resource
 *     read/update/delete) and the SQL predicate (search), so the two can not
 *     drift apart.
 */

/**
 * Map of resourceType -> JSONPath expressions (relative to the stored resource
 * body) that hold a reference linking the resource to a Patient.
 *
 * `$patient` is bound at query time to the string `Patient/<id>`; `$bare` is
 * bound to the raw id so that servers which store un-prefixed references or
 * `urn:uuid:` forms still resolve.
 */
const PATIENT_COMPARTMENT_PATHS = Object.freeze({
  // Patient is its own compartment root; handled by resource_id equality.
  Patient: [],

  AllergyIntolerance: ['$.patient.reference', '$.recorder.reference', '$.asserter.reference'],
  CarePlan: ['$.subject.reference'],
  CareTeam: ['$.subject.reference'],
  Condition: ['$.subject.reference'],
  Coverage: ['$.beneficiary.reference', '$.subscriber.reference', '$.policyHolder.reference'],
  Device: ['$.patient.reference'],
  DiagnosticReport: ['$.subject.reference'],
  DocumentReference: ['$.subject.reference'],
  Encounter: ['$.subject.reference'],
  Goal: ['$.subject.reference'],
  Immunization: ['$.patient.reference'],
  MedicationDispense: ['$.subject.reference'],
  MedicationRequest: ['$.subject.reference'],
  MedicationStatement: ['$.subject.reference'],
  Observation: ['$.subject.reference', '$.performer[*].reference'],
  Procedure: ['$.subject.reference', '$.performer[*].actor.reference'],
  Provenance: ['$.target[*].reference'],
  RelatedPerson: ['$.patient.reference'],
  ServiceRequest: ['$.subject.reference', '$.performer[*].reference'],
  Specimen: ['$.subject.reference'],
});

/**
 * Resource types the server supports that are deliberately NOT part of any
 * patient compartment (FHIR R4). Patient-scoped tokens can not reach them.
 * Listed explicitly so that adding a new resource type forces a decision.
 */
const NON_COMPARTMENT_TYPES = Object.freeze([
  'Group',
  'Location',
  'Medication',
  'Organization',
  'Practitioner',
  'PractitionerRole',
  'Subscription',
]);

function isPatientCompartmentType(type) {
  return Object.prototype.hasOwnProperty.call(PATIENT_COMPARTMENT_PATHS, type);
}

/** Candidate string forms a reference to `patientId` may legitimately take. */
function referenceForms(patientId) {
  return [`Patient/${patientId}`, String(patientId), `urn:uuid:${patientId}`];
}

function collectAtPath(node, segments) {
  if (node === null || node === undefined) return [];
  if (segments.length === 0) return [node];
  const [head, ...rest] = segments;
  if (head === '[*]') {
    if (!Array.isArray(node)) return [];
    return node.flatMap((item) => collectAtPath(item, rest));
  }
  if (typeof node !== 'object' || Array.isArray(node)) return [];
  return collectAtPath(node[head], rest);
}

/** Parse '$.performer[*].reference' into ['performer', '[*]', 'reference']. */
function parseJsonPath(expr) {
  return expr
    .replace(/^\$\./, '')
    .split('.')
    .flatMap((part) => {
      const m = part.match(/^([^[]+)\[\*\]$/);
      return m ? [m[1], '[*]'] : [part];
    });
}

/**
 * Definitive in-process compartment check for a single resource body.
 * Returns false for any type not in the compartment map (fail closed).
 */
function resourceBelongsToPatient(type, body, patientId) {
  if (!patientId) return false;
  if (type === 'Patient') {
    return String(body?.id) === String(patientId);
  }
  const paths = PATIENT_COMPARTMENT_PATHS[type];
  if (!paths || paths.length === 0) return false;
  const wanted = new Set(referenceForms(patientId));
  for (const expr of paths) {
    const values = collectAtPath(body, parseJsonPath(expr));
    for (const v of values) {
      if (typeof v === 'string' && wanted.has(v)) return true;
    }
  }
  return false;
}

/**
 * SQL predicate restricting a `fhir_resources` search to a patient compartment.
 *
 * Returns { sql, values } where `sql` is a boolean expression over the `body`
 * column and `values` are the parameters to append, starting at `nextIndex`.
 * Returns null when the type is not in any patient compartment — callers must
 * treat null as "deny", never as "no restriction".
 */
function searchPredicate(type, patientId, nextIndex) {
  if (!patientId || !isPatientCompartmentType(type)) return null;

  if (type === 'Patient') {
    return { sql: `resource_id = $${nextIndex}`, values: [String(patientId)] };
  }

  const paths = PATIENT_COMPARTMENT_PATHS[type];
  if (!paths || paths.length === 0) return null;

  // One bound variable set shared by every path expression for this type.
  const varsIndex = nextIndex;
  const clauses = paths.map(
    (expr) =>
      `jsonb_path_exists(body, '${expr} ? (@ == $p || @ == $b || @ == $u)'::jsonpath, $${varsIndex}::jsonb)`
  );
  const [p, b, u] = referenceForms(patientId);
  return {
    sql: `(${clauses.join(' OR ')})`,
    values: [JSON.stringify({ p, b, u })],
  };
}

module.exports = {
  PATIENT_COMPARTMENT_PATHS,
  NON_COMPARTMENT_TYPES,
  isPatientCompartmentType,
  resourceBelongsToPatient,
  searchPredicate,
  referenceForms,
};
