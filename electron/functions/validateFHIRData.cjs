/**
 * TransTrack - FHIR R4 Structure Validation
 *
 * Validates FHIR R4 resources and bundles against the specification.
 * Performs structural validation (required fields, value sets, reference
 * integrity) without requiring an external FHIR library, keeping the
 * Electron bundle lean.
 *
 * Supported resource types: Patient, Condition, Observation, Bundle
 */

'use strict';

const FHIR_RESOURCE_TYPES = new Set([
  'Patient', 'Condition', 'Observation', 'Bundle',
  'Procedure', 'MedicationRequest', 'AllergyIntolerance',
  'DiagnosticReport', 'Encounter', 'Organization',
  'Practitioner', 'ServiceRequest', 'Specimen',
]);

const REQUIRED_FIELDS = {
  Patient: ['resourceType'],
  Condition: ['resourceType', 'subject'],
  Observation: ['resourceType', 'status', 'code'],
  Bundle: ['resourceType', 'type'],
  Procedure: ['resourceType', 'status', 'subject'],
  MedicationRequest: ['resourceType', 'status', 'intent', 'medication[x]', 'subject'],
  AllergyIntolerance: ['resourceType', 'patient'],
  DiagnosticReport: ['resourceType', 'status', 'code'],
  Encounter: ['resourceType', 'status', 'class'],
  Organization: ['resourceType'],
  Practitioner: ['resourceType'],
};

const OBSERVATION_STATUS_VALUES = new Set([
  'registered', 'preliminary', 'final', 'amended',
  'corrected', 'cancelled', 'entered-in-error', 'unknown',
]);

const BUNDLE_TYPE_VALUES = new Set([
  'document', 'message', 'transaction', 'transaction-response',
  'batch', 'batch-response', 'history', 'searchset', 'collection',
]);

const CONDITION_CLINICAL_STATUS = new Set([
  'active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved',
]);

function createValidationResult() {
  return { valid: true, errors: [], warnings: [] };
}

function addError(result, path, message) {
  result.valid = false;
  result.errors.push({ path, message });
}

function addWarning(result, path, message) {
  result.warnings.push({ path, message });
}

function validateReference(ref, path, result) {
  if (!ref) return;
  if (typeof ref !== 'object') {
    addError(result, path, 'Reference must be an object');
    return;
  }
  if (!ref.reference && !ref.identifier && !ref.display) {
    addWarning(result, path, 'Reference should have at least one of: reference, identifier, display');
  }
  if (ref.reference && typeof ref.reference !== 'string') {
    addError(result, path + '.reference', 'Reference.reference must be a string');
  }
}

function validateCodeableConcept(cc, path, result) {
  if (!cc) return;
  if (typeof cc !== 'object') {
    addError(result, path, 'CodeableConcept must be an object');
    return;
  }
  if (cc.coding) {
    if (!Array.isArray(cc.coding)) {
      addError(result, path + '.coding', 'coding must be an array');
    } else {
      cc.coding.forEach((coding, i) => {
        if (!coding.system && !coding.code) {
          addWarning(result, `${path}.coding[${i}]`, 'Coding should have system and code');
        }
      });
    }
  }
}

function validatePatient(resource, result) {
  if (resource.name) {
    if (!Array.isArray(resource.name)) {
      addError(result, 'Patient.name', 'name must be an array of HumanName');
    }
  }
  if (resource.gender && !['male', 'female', 'other', 'unknown'].includes(resource.gender)) {
    addError(result, 'Patient.gender', `Invalid gender: ${resource.gender}`);
  }
  if (resource.birthDate && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(resource.birthDate)) {
    addError(result, 'Patient.birthDate', 'birthDate must be YYYY, YYYY-MM, or YYYY-MM-DD');
  }
}

function validateCondition(resource, result) {
  validateReference(resource.subject, 'Condition.subject', result);
  if (resource.clinicalStatus) {
    validateCodeableConcept(resource.clinicalStatus, 'Condition.clinicalStatus', result);
    const code = resource.clinicalStatus?.coding?.[0]?.code;
    if (code && !CONDITION_CLINICAL_STATUS.has(code)) {
      addWarning(result, 'Condition.clinicalStatus', `Unexpected clinical status code: ${code}`);
    }
  }
  if (resource.code) {
    validateCodeableConcept(resource.code, 'Condition.code', result);
  }
}

function validateObservation(resource, result) {
  if (!OBSERVATION_STATUS_VALUES.has(resource.status)) {
    addError(result, 'Observation.status', `Invalid status: ${resource.status}. Must be one of: ${[...OBSERVATION_STATUS_VALUES].join(', ')}`);
  }
  validateCodeableConcept(resource.code, 'Observation.code', result);
  if (resource.subject) validateReference(resource.subject, 'Observation.subject', result);
}

function validateBundleEntry(entry, index, result) {
  const prefix = `Bundle.entry[${index}]`;
  if (!entry.resource && !entry.request) {
    addWarning(result, prefix, 'Entry should have resource or request');
  }
  if (entry.resource) {
    const entryResult = validateResource(entry.resource);
    for (const err of entryResult.errors) {
      addError(result, `${prefix}.resource.${err.path}`, err.message);
    }
    for (const warn of entryResult.warnings) {
      addWarning(result, `${prefix}.resource.${warn.path}`, warn.message);
    }
  }
}

function validateBundle(resource, result) {
  if (!BUNDLE_TYPE_VALUES.has(resource.type)) {
    addError(result, 'Bundle.type', `Invalid bundle type: ${resource.type}`);
  }
  if (resource.entry) {
    if (!Array.isArray(resource.entry)) {
      addError(result, 'Bundle.entry', 'entry must be an array');
    } else {
      resource.entry.forEach((entry, i) => validateBundleEntry(entry, i, result));
    }
  }
}

/**
 * Validate a single FHIR R4 resource.
 */
function validateResource(resource) {
  const result = createValidationResult();

  if (!resource || typeof resource !== 'object') {
    addError(result, '', 'Resource must be a non-null object');
    return result;
  }

  if (!resource.resourceType) {
    addError(result, 'resourceType', 'resourceType is required');
    return result;
  }

  if (!FHIR_RESOURCE_TYPES.has(resource.resourceType)) {
    addWarning(result, 'resourceType', `Unknown resource type: ${resource.resourceType}`);
  }

  // Check required fields
  const required = REQUIRED_FIELDS[resource.resourceType] || ['resourceType'];
  for (const field of required) {
    if (field.includes('[x]')) continue; // polymorphic, skip simple check
    if (resource[field] === undefined || resource[field] === null) {
      addError(result, `${resource.resourceType}.${field}`, `Required field '${field}' is missing`);
    }
  }

  // Type-specific validation
  switch (resource.resourceType) {
    case 'Patient': validatePatient(resource, result); break;
    case 'Condition': validateCondition(resource, result); break;
    case 'Observation': validateObservation(resource, result); break;
    case 'Bundle': validateBundle(resource, result); break;
  }

  return result;
}

/**
 * Validate a complete FHIR data payload (resource or bundle).
 * Returns { valid, errors[], warnings[], resourceType, resourceCount }
 */
function validateFHIRDataComplete(fhirData) {
  if (!fhirData) {
    return { valid: false, errors: [{ path: '', message: 'No FHIR data provided' }], warnings: [] };
  }

  let data = fhirData;
  if (typeof fhirData === 'string') {
    try {
      data = JSON.parse(fhirData);
    } catch (e) {
      return { valid: false, errors: [{ path: '', message: `Invalid JSON: ${e.message}` }], warnings: [] };
    }
  }

  const result = validateResource(data);

  return {
    ...result,
    resourceType: data.resourceType || 'unknown',
    resourceCount: data.resourceType === 'Bundle' && Array.isArray(data.entry) ? data.entry.length : 1,
  };
}

module.exports = {
  validateFHIRDataComplete,
  validateResource,
  FHIR_RESOURCE_TYPES,
};
