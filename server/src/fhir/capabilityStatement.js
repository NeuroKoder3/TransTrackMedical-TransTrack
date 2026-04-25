'use strict';

/**
 * FHIR R4 (4.0.1) CapabilityStatement.  The set of supported resources
 * mirrors the resources implemented in src/fhir/resources/*.
 */
function build({ baseUrl, requireAuth }) {
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    publisher: 'TransTrack',
    kind: 'instance',
    software: { name: 'TransTrack FHIR', version: '0.1.0' },
    implementation: { description: 'TransTrack transplant operations API', url: baseUrl },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json', 'json'],
    rest: [
      {
        mode: 'server',
        security: requireAuth
          ? {
              service: [
                {
                  coding: [
                    { system: 'http://terminology.hl7.org/CodeSystem/restful-security-service', code: 'OAuth' },
                  ],
                  text: 'OAuth2 Bearer JWT (RFC 6750)',
                },
              ],
            }
          : undefined,
        resource: [
          resource('Patient', ['read', 'vread', 'search-type', 'create', 'update']),
          resource('Observation', ['read', 'search-type', 'create']),
          resource('Encounter', ['read', 'search-type', 'create']),
          resource('MedicationRequest', ['read', 'search-type', 'create']),
          resource('AllergyIntolerance', ['read', 'search-type', 'create']),
        ],
      },
    ],
  };
}

function resource(type, interactions) {
  return {
    type,
    profile: `http://hl7.org/fhir/StructureDefinition/${type}`,
    interaction: interactions.map(code => ({ code })),
    versioning: 'versioned',
    readHistory: false,
    updateCreate: true,
    conditionalCreate: false,
    conditionalRead: 'not-supported',
    conditionalUpdate: false,
    conditionalDelete: 'not-supported',
    searchParam: searchParamsFor(type),
  };
}

function searchParamsFor(type) {
  const common = [
    { name: '_id', type: 'token' },
    { name: '_lastUpdated', type: 'date' },
  ];
  switch (type) {
    case 'Patient':
      return common.concat([
        { name: 'identifier', type: 'token' },
        { name: 'name', type: 'string' },
        { name: 'family', type: 'string' },
        { name: 'birthdate', type: 'date' },
      ]);
    case 'Observation':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'code', type: 'token' },
        { name: 'date', type: 'date' },
      ]);
    case 'Encounter':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'date', type: 'date' },
        { name: 'status', type: 'token' },
      ]);
    case 'MedicationRequest':
      return common.concat([
        { name: 'patient', type: 'reference' },
        { name: 'status', type: 'token' },
      ]);
    case 'AllergyIntolerance':
      return common.concat([
        { name: 'patient', type: 'reference' },
      ]);
    default:
      return common;
  }
}

module.exports = { build };
