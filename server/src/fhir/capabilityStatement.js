'use strict';

/**
 * FHIR R4 (4.0.1) CapabilityStatement.
 *
 * Coverage matches the resources implemented in src/fhir/resources/index.js
 * and is aligned with USCDI v3 data classes.
 *
 * Includes the SMART on FHIR security extension (oauth-uris) and the
 * Bulk Data Access $export operation declarations so EHR clients can
 * discover us automatically.
 */

const { listSupported: listHl7Types } = require('../hl7/messageTypes');

function build({ baseUrl, requireAuth, smartIssuer, includeOperations = true }) {
  const security = requireAuth
    ? {
        cors: true,
        service: [
          {
            coding: [
              { system: 'http://terminology.hl7.org/CodeSystem/restful-security-service', code: 'SMART-on-FHIR' },
            ],
            text: 'OAuth2 SMART on FHIR (also accepts API Bearer JWT)',
          },
        ],
        extension: smartIssuer ? [
          {
            url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
            extension: [
              { url: 'authorize', valueUri: `${smartIssuer}/oauth2/authorize` },
              { url: 'token',     valueUri: `${smartIssuer}/oauth2/token` },
              { url: 'register',  valueUri: `${smartIssuer}/oauth2/register` },
              { url: 'introspect',valueUri: `${smartIssuer}/oauth2/introspect` },
              { url: 'revoke',    valueUri: `${smartIssuer}/oauth2/revoke` },
            ],
          },
        ] : undefined,
      }
    : undefined;

  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    publisher: 'TransTrack',
    kind: 'instance',
    software: { name: 'TransTrack FHIR', version: '0.2.0' },
    implementation: { description: 'TransTrack transplant operations API', url: baseUrl },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json', 'json'],
    rest: [
      {
        mode: 'server',
        security,
        resource: ALL_RESOURCES.map(r => resourceEntry(r)),
        interaction: [
          { code: 'transaction' },
          { code: 'search-system' },
        ],
        operation: includeOperations ? [
          { name: 'export', definition: 'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export' },
          { name: 'patient-export', definition: 'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/patient-export' },
          { name: 'group-export', definition: 'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/group-export' },
        ] : undefined,
      },
    ],
    messaging: [
      {
        documentation: 'HL7 v2.x message types accepted via the MLLP listener (not via this REST endpoint).',
        supportedMessage: listHl7Types().map(name => ({
          mode: 'receiver',
          definition: `urn:hl7-org:v2:${name.replace('^', ':')}`,
        })),
      },
    ],
  };
}

const ALL_RESOURCES = [
  ['Patient',             ['read','vread','search-type','create','update']],
  ['Observation',         ['read','search-type','create','update']],
  ['Encounter',           ['read','search-type','create','update']],
  ['MedicationRequest',   ['read','search-type','create','update']],
  ['AllergyIntolerance',  ['read','search-type','create']],
  ['CarePlan',            ['read','search-type','create','update']],
  ['CareTeam',            ['read','search-type','create','update']],
  ['Condition',           ['read','search-type','create','update']],
  ['Coverage',            ['read','search-type','create','update']],
  ['Device',              ['read','search-type','create','update']],
  ['DiagnosticReport',    ['read','search-type','create','update']],
  ['DocumentReference',   ['read','search-type','create','update']],
  ['Goal',                ['read','search-type','create','update']],
  ['Immunization',        ['read','search-type','create','update']],
  ['Location',            ['read','search-type','create','update']],
  ['Medication',          ['read','search-type','create','update']],
  ['MedicationDispense',  ['read','search-type','create','update']],
  ['MedicationStatement', ['read','search-type','create','update']],
  ['Organization',        ['read','search-type','create','update']],
  ['Practitioner',        ['read','search-type','create','update']],
  ['PractitionerRole',    ['read','search-type','create','update']],
  ['Procedure',           ['read','search-type','create','update']],
  ['Provenance',          ['read','search-type','create','update']],
  ['RelatedPerson',       ['read','search-type','create','update']],
  ['ServiceRequest',      ['read','search-type','create','update']],
  ['Specimen',            ['read','search-type','create','update']],
  ['Group',               ['read','search-type','create','update']],
  ['Subscription',        ['read','search-type','create','update']],
];

function resourceEntry([type, interactions]) {
  return {
    type,
    profile: profileFor(type),
    interaction: interactions.map(code => ({ code })),
    versioning: 'versioned',
    readHistory: false,
    updateCreate: true,
    conditionalCreate: false,
    conditionalRead: 'not-supported',
    conditionalUpdate: false,
    conditionalDelete: 'not-supported',
    searchParam: searchParamsFor(type),
    operation: opsFor(type),
  };
}

function profileFor(type) {
  // Prefer US Core profiles when an obvious mapping exists.
  const usCore = new Set([
    'Patient','Observation','Encounter','MedicationRequest','AllergyIntolerance',
    'CarePlan','CareTeam','Condition','Coverage','Device','DiagnosticReport',
    'DocumentReference','Goal','Immunization','Location','Medication',
    'Organization','Practitioner','PractitionerRole','Procedure','Provenance',
    'RelatedPerson','ServiceRequest','Specimen',
  ]);
  if (usCore.has(type)) {
    return `http://hl7.org/fhir/us/core/StructureDefinition/us-core-${type.toLowerCase()}`;
  }
  return `http://hl7.org/fhir/StructureDefinition/${type}`;
}

function opsFor(type) {
  if (type === 'Patient') return [
    { name: 'export', definition: 'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/patient-export' },
  ];
  if (type === 'Group') return [
    { name: 'export', definition: 'http://hl7.org/fhir/uv/bulkdata/OperationDefinition/group-export' },
  ];
  return undefined;
}

function searchParamsFor(type) {
  const common = [
    { name: '_id', type: 'token' },
    { name: '_lastUpdated', type: 'date' },
    { name: '_count', type: 'number' },
  ];
  switch (type) {
    case 'Patient':
      return common.concat([
        { name: 'identifier', type: 'token' },
        { name: 'name', type: 'string' },
        { name: 'family', type: 'string' },
        { name: 'given', type: 'string' },
        { name: 'birthdate', type: 'date' },
        { name: 'gender', type: 'token' },
      ]);
    case 'Observation':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'subject', type: 'reference' },
        { name: 'code', type: 'token' },
        { name: 'category', type: 'token' },
        { name: 'date', type: 'date' },
        { name: 'status', type: 'token' },
      ]);
    case 'Encounter':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'subject', type: 'reference' },
        { name: 'date', type: 'date' },
        { name: 'status', type: 'token' },
        { name: 'class', type: 'token' },
      ]);
    case 'MedicationRequest':
    case 'MedicationDispense':
    case 'MedicationStatement':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'subject', type: 'reference' },
        { name: 'status', type: 'token' },
        { name: 'medication', type: 'reference' },
      ]);
    case 'AllergyIntolerance':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'clinical-status', type: 'token' },
        { name: 'verification-status', type: 'token' },
      ]);
    case 'CarePlan':
    case 'CareTeam':
    case 'Goal':
    case 'ServiceRequest':
    case 'Procedure':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'subject', type: 'reference' },
        { name: 'status', type: 'token' },
      ]);
    case 'Condition':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'subject', type: 'reference' },
        { name: 'category', type: 'token' },
        { name: 'clinical-status', type: 'token' },
        { name: 'verification-status', type: 'token' },
        { name: 'code', type: 'token' },
      ]);
    case 'Coverage':
      return common.concat([
        { name: 'beneficiary', type: 'reference' },
        { name: 'patient', type: 'reference' },
        { name: 'status', type: 'token' },
        { name: 'payor', type: 'reference' },
      ]);
    case 'DiagnosticReport':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'subject', type: 'reference' },
        { name: 'category', type: 'token' },
        { name: 'code', type: 'token' },
        { name: 'date', type: 'date' },
        { name: 'status', type: 'token' },
      ]);
    case 'DocumentReference':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'subject', type: 'reference' },
        { name: 'type', type: 'token' },
        { name: 'category', type: 'token' },
        { name: 'status', type: 'token' },
        { name: 'period', type: 'date' },
      ]);
    case 'Device':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'identifier', type: 'token' },
        { name: 'type', type: 'token' },
      ]);
    case 'Immunization':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'date', type: 'date' },
        { name: 'status', type: 'token' },
        { name: 'vaccine-code', type: 'token' },
      ]);
    case 'Location':
    case 'Organization':
      return common.concat([
        { name: 'name', type: 'string' },
        { name: 'identifier', type: 'token' },
      ]);
    case 'Practitioner':
    case 'PractitionerRole':
      return common.concat([
        { name: 'identifier', type: 'token' },
        { name: 'name', type: 'string' },
      ]);
    case 'Provenance':
      return common.concat([
        { name: 'target', type: 'reference' },
        { name: 'recorded', type: 'date' },
        { name: 'agent', type: 'reference' },
      ]);
    case 'RelatedPerson':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'identifier', type: 'token' },
      ]);
    case 'Specimen':
      return common.concat([
        { name: 'subject', type: 'reference' },
        { name: 'patient', type: 'reference' },
        { name: 'type', type: 'token' },
        { name: 'status', type: 'token' },
      ]);
    case 'Subscription':
      return common.concat([
        { name: 'status', type: 'token' },
        { name: 'criteria', type: 'string' },
        { name: 'type', type: 'token' },
      ]);
    case 'Group':
      return common.concat([
        { name: 'identifier', type: 'token' },
        { name: 'type', type: 'token' },
        { name: 'actual', type: 'token' },
      ]);
    default:
      return common;
  }
}

module.exports = { build, ALL_RESOURCES };
