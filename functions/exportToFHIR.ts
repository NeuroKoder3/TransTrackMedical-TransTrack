import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const api = createClientFromRequest(req);
    
    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, resource_types } = await req.json();

    const patient = await api.entities.Patient.get(patient_id);
    
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const fhirBundle = {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: new Date().toISOString(),
      entry: []
    };

    // Always include Patient resource
    const fhirPatient = {
      resourceType: 'Patient',
      id: patient.id,
      identifier: [
        {
          system: 'https://transtrack.app/patient-id',
          value: patient.patient_id
        }
      ],
      name: [
        {
          use: 'official',
          family: patient.last_name,
          given: [patient.first_name]
        }
      ],
      telecom: [
        ...(patient.phone ? [{
          system: 'phone',
          value: patient.phone,
          use: 'home'
        }] : []),
        ...(patient.email ? [{
          system: 'email',
          value: patient.email
        }] : [])
      ],
      birthDate: patient.date_of_birth,
      contact: patient.emergency_contact_name ? [
        {
          relationship: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
                  code: 'C',
                  display: 'Emergency Contact'
                }
              ]
            }
          ],
          name: {
            text: patient.emergency_contact_name
          },
          telecom: patient.emergency_contact_phone ? [
            {
              system: 'phone',
              value: patient.emergency_contact_phone
            }
          ] : []
        }
      ] : []
    };

    fhirBundle.entry.push({
      fullUrl: `Patient/${patient.id}`,
      resource: fhirPatient
    });

    // Add Observations for clinical data
    if (!resource_types || resource_types.includes('Observation')) {
      const observations = [];

      // Blood Type Observation
      if (patient.blood_type) {
        observations.push({
          resourceType: 'Observation',
          id: `${patient.id}-bloodtype`,
          status: 'final',
          category: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                  code: 'laboratory',
                  display: 'Laboratory'
                }
              ]
            }
          ],
          code: {
            coding: [
              {
                system: 'http://loinc.org',
                code: '883-9',
                display: 'ABO group [Type] in Blood'
              }
            ],
            text: 'Blood Type'
          },
          subject: {
            reference: `Patient/${patient.id}`
          },
          effectiveDateTime: patient.last_evaluation_date || new Date().toISOString(),
          valueCodeableConcept: {
            coding: [
              {
                system: 'http://snomed.info/sct',
                code: patient.blood_type,
                display: patient.blood_type
              }
            ],
            text: patient.blood_type
          }
        });
      }

      // MELD Score Observation
      if (patient.meld_score) {
        observations.push({
          resourceType: 'Observation',
          id: `${patient.id}-meld`,
          status: 'final',
          category: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                  code: 'survey',
                  display: 'Survey'
                }
              ]
            }
          ],
          code: {
            coding: [
              {
                system: 'http://loinc.org',
                code: '88374-7',
                display: 'MELD score'
              }
            ],
            text: 'MELD Score'
          },
          subject: {
            reference: `Patient/${patient.id}`
          },
          effectiveDateTime: patient.last_evaluation_date || new Date().toISOString(),
          valueInteger: Math.round(patient.meld_score)
        });
      }

      // LAS Score Observation
      if (patient.las_score) {
        observations.push({
          resourceType: 'Observation',
          id: `${patient.id}-las`,
          status: 'final',
          code: {
            text: 'Lung Allocation Score'
          },
          subject: {
            reference: `Patient/${patient.id}`
          },
          effectiveDateTime: patient.last_evaluation_date || new Date().toISOString(),
          valueQuantity: {
            value: patient.las_score,
            unit: 'score'
          }
        });
      }

      // TransTrack Priority Score as custom Observation
      if (patient.priority_score !== undefined) {
        observations.push({
          resourceType: 'Observation',
          id: `${patient.id}-priority`,
          status: 'final',
          category: [
            {
              coding: [
                {
                  system: 'https://transtrack.app/observation-category',
                  code: 'transplant-priority',
                  display: 'Transplant Priority'
                }
              ]
            }
          ],
          code: {
            text: 'Transplant Priority Score'
          },
          subject: {
            reference: `Patient/${patient.id}`
          },
          effectiveDateTime: patient.updated_date || new Date().toISOString(),
          valueQuantity: {
            value: patient.priority_score,
            unit: 'score',
            system: 'https://transtrack.app/priority-score',
            code: 'priority-score'
          },
          note: patient.priority_score_breakdown ? [
            {
              text: `Breakdown: Medical Urgency=${patient.priority_score_breakdown.weighted_scores?.medical_urgency?.toFixed(1)}, Time=${patient.priority_score_breakdown.weighted_scores?.time_on_waitlist?.toFixed(1)}, Organ Score=${patient.priority_score_breakdown.weighted_scores?.organ_specific?.toFixed(1)}`
            }
          ] : []
        });
      }

      // HLA Typing
      if (patient.hla_typing) {
        observations.push({
          resourceType: 'Observation',
          id: `${patient.id}-hla`,
          status: 'final',
          code: {
            text: 'HLA Typing'
          },
          subject: {
            reference: `Patient/${patient.id}`
          },
          effectiveDateTime: patient.last_evaluation_date || new Date().toISOString(),
          valueString: patient.hla_typing
        });
      }

      observations.forEach(obs => {
        fhirBundle.entry.push({
          fullUrl: `Observation/${obs.id}`,
          resource: obs
        });
      });
    }

    // Add Conditions
    if (!resource_types || resource_types.includes('Condition')) {
      const conditions = [];

      // Primary diagnosis
      if (patient.diagnosis) {
        conditions.push({
          resourceType: 'Condition',
          id: `${patient.id}-diagnosis`,
          clinicalStatus: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
                code: patient.waitlist_status === 'transplanted' ? 'resolved' : 'active',
                display: patient.waitlist_status === 'transplanted' ? 'Resolved' : 'Active'
              }
            ]
          },
          verificationStatus: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
                code: 'confirmed',
                display: 'Confirmed'
              }
            ]
          },
          category: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/condition-category',
                  code: 'encounter-diagnosis',
                  display: 'Encounter Diagnosis'
                }
              ]
            }
          ],
          code: {
            text: patient.diagnosis
          },
          subject: {
            reference: `Patient/${patient.id}`
          },
          recordedDate: patient.created_date
        });
      }

      // Waitlist status as a Condition
      conditions.push({
        resourceType: 'Condition',
        id: `${patient.id}-waitlist`,
        clinicalStatus: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
              code: patient.waitlist_status === 'active' ? 'active' : 'inactive',
              display: patient.waitlist_status === 'active' ? 'Active' : 'Inactive'
            }
          ]
        },
        category: [
          {
            coding: [
              {
                system: 'https://transtrack.app/condition-category',
                code: 'transplant-waitlist',
                display: 'Transplant Waitlist'
              }
            ]
          }
        ],
        code: {
          text: `${patient.organ_needed} Transplant Waitlist - ${patient.waitlist_status}`
        },
        subject: {
          reference: `Patient/${patient.id}`
        },
        onsetDateTime: patient.date_added_to_waitlist,
        note: [
          {
            text: `Medical Urgency: ${patient.medical_urgency}, Priority Score: ${patient.priority_score?.toFixed(1) || 'N/A'}`
          }
        ]
      });

      conditions.forEach(condition => {
        fhirBundle.entry.push({
          fullUrl: `Condition/${condition.id}`,
          resource: condition
        });
      });
    }

    return Response.json({
      success: true,
      fhir_bundle: fhirBundle,
      resource_count: fhirBundle.entry.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});