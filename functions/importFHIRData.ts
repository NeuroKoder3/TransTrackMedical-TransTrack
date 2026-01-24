import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const api = createClientFromRequest(req);
    
    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fhir_bundle, source_system, auto_create, auto_update } = await req.json();

    if (!fhir_bundle || !fhir_bundle.resourceType) {
      return Response.json({ 
        error: 'Invalid FHIR data. Expected a FHIR Bundle resource.' 
      }, { status: 400 });
    }

    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
      warnings: []
    };

    // Extract Patient resources from bundle
    const entries = fhir_bundle.entry || [];
    const patientResources = entries
      .filter(entry => entry.resource?.resourceType === 'Patient')
      .map(entry => entry.resource);

    for (const fhirPatient of patientResources) {
      results.processed++;
      
      try {
        // Validate FHIR resource
        const validationResponse = await api.functions.invoke('validateFHIRData', {
          fhir_resource: fhirPatient,
          resource_type: 'Patient'
        });

        const validation = validationResponse.data;

        // Collect warnings
        if (validation.warnings && validation.warnings.length > 0) {
          results.warnings.push(...validation.warnings.map(w => ({
            patient_id: fhirPatient.identifier?.[0]?.value,
            ...w
          })));
        }

        // Skip import if validation failed with errors
        if (!validation.valid && validation.errors && validation.errors.length > 0) {
          results.failed++;
          results.errors.push({
            resource_id: fhirPatient.id,
            resource_type: 'Patient',
            patient_id: fhirPatient.identifier?.[0]?.value,
            validation_errors: validation.errors
          });
          continue;
        }

        // Map FHIR Patient to TransTrack Patient
        const transTrackPatient = mapFHIRToTransTrack(fhirPatient, entries);

        // Check if patient already exists by patient_id or identifier
        const existingPatients = await api.entities.Patient.filter({
          patient_id: transTrackPatient.patient_id
        });

        if (existingPatients.length > 0 && auto_update) {
          // Update existing patient
          await api.entities.Patient.update(existingPatients[0].id, transTrackPatient);
          results.updated++;
          
          // Recalculate priority
          await api.functions.invoke('calculatePriorityAdvanced', {
            patient_id: existingPatients[0].id
          });
        } else if (existingPatients.length === 0 && auto_create) {
          // Create new patient
          const newPatient = await api.entities.Patient.create(transTrackPatient);
          results.created++;
          
          // Calculate initial priority
          await api.functions.invoke('calculatePriorityAdvanced', {
            patient_id: newPatient.id
          });

          // Trigger notification rules
          await api.functions.invoke('checkNotificationRules', {
            patient_id: newPatient.id,
            event_type: 'create',
          });
        } else {
          // Skip - patient exists but auto_update is false
          results.failed++;
          results.errors.push({
            patient_id: transTrackPatient.patient_id,
            reason: 'Patient exists and auto_update is disabled'
          });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          patient_id: fhirPatient.identifier?.[0]?.value || 'unknown',
          error: error.message
        });
      }
    }

    // Create import record
    const importRecord = await api.entities.EHRImport.create({
      import_type: 'manual_upload',
      source_system: source_system || 'Unknown',
      records_processed: results.processed,
      records_created: results.created,
      records_updated: results.updated,
      records_failed: results.failed,
      error_details: results.errors,
      imported_by: user.email,
      status: results.failed === 0 ? 'success' : 
              results.created + results.updated > 0 ? 'partial' : 'failed',
      fhir_version: fhir_bundle.meta?.versionId || 'R4'
    });

    // Log the import
    await api.entities.AuditLog.create({
      action: 'create',
      entity_type: 'EHRImport',
      entity_id: importRecord.id,
      details: `FHIR import completed: ${results.created} created, ${results.updated} updated, ${results.failed} failed`,
      user_email: user.email,
      user_role: user.role,
    });

    return Response.json({
      success: true,
      results,
      import_id: importRecord.id
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// FHIR to TransTrack mapping function
function mapFHIRToTransTrack(fhirPatient, bundleEntries) {
  const patient = {
    // Basic demographics
    patient_id: fhirPatient.identifier?.[0]?.value || `FHIR-${Date.now()}`,
    first_name: fhirPatient.name?.[0]?.given?.[0] || '',
    last_name: fhirPatient.name?.[0]?.family || '',
    date_of_birth: fhirPatient.birthDate || '',
    phone: fhirPatient.telecom?.find(t => t.system === 'phone')?.value || '',
    email: fhirPatient.telecom?.find(t => t.system === 'email')?.value || '',
  };

  // Extract blood type from Observation resources
  const observations = bundleEntries
    .filter(e => e.resource?.resourceType === 'Observation' && 
                 e.resource?.subject?.reference === `Patient/${fhirPatient.id}`)
    .map(e => e.resource);

  const bloodTypeObs = observations.find(obs => 
    obs.code?.coding?.some(c => c.code === '883-9' || c.display?.includes('Blood'))
  );
  
  if (bloodTypeObs?.valueCodeableConcept?.coding?.[0]?.code) {
    patient.blood_type = bloodTypeObs.valueCodeableConcept.coding[0].code;
  }

  // Extract HLA typing
  const hlaObs = observations.find(obs =>
    obs.code?.coding?.some(c => c.display?.includes('HLA'))
  );
  
  if (hlaObs?.valueString) {
    patient.hla_typing = hlaObs.valueString;
  }

  // Extract weight and height
  const weightObs = observations.find(obs =>
    obs.code?.coding?.some(c => c.code === '29463-7' || c.display?.includes('weight'))
  );
  if (weightObs?.valueQuantity?.value) {
    patient.weight_kg = weightObs.valueQuantity.value;
  }

  const heightObs = observations.find(obs =>
    obs.code?.coding?.some(c => c.code === '8302-2' || c.display?.includes('height'))
  );
  if (heightObs?.valueQuantity?.value) {
    patient.height_cm = heightObs.valueQuantity.value;
  }

  // Extract MELD score
  const meldObs = observations.find(obs =>
    obs.code?.coding?.some(c => c.display?.includes('MELD'))
  );
  if (meldObs?.valueInteger || meldObs?.valueQuantity?.value) {
    patient.meld_score = meldObs.valueInteger || meldObs.valueQuantity.value;
  }

  // Extract conditions/diagnoses
  const conditions = bundleEntries
    .filter(e => e.resource?.resourceType === 'Condition' &&
                 e.resource?.subject?.reference === `Patient/${fhirPatient.id}`)
    .map(e => e.resource);

  if (conditions.length > 0) {
    const primaryCondition = conditions.find(c => c.category?.[0]?.coding?.[0]?.code === 'encounter-diagnosis');
    if (primaryCondition?.code?.text) {
      patient.diagnosis = primaryCondition.code.text;
    }

    // Collect other conditions as comorbidities
    const otherConditions = conditions
      .filter(c => c !== primaryCondition)
      .map(c => c.code?.text)
      .filter(Boolean);
    
    if (otherConditions.length > 0) {
      patient.comorbidities = otherConditions.join('; ');
    }
  }

  // Extract medications from MedicationStatement resources
  const medications = bundleEntries
    .filter(e => e.resource?.resourceType === 'MedicationStatement' &&
                 e.resource?.subject?.reference === `Patient/${fhirPatient.id}`)
    .map(e => e.resource);

  if (medications.length > 0) {
    const medList = medications
      .map(m => m.medicationCodeableConcept?.text || m.medicationReference?.display)
      .filter(Boolean);
    
    if (medList.length > 0) {
      patient.medications = medList.join(', ');
    }
  }

  // Extract emergency contact
  const emergencyContact = fhirPatient.contact?.find(c =>
    c.relationship?.some(r => r.coding?.some(code => code.code === 'C'))
  );
  
  if (emergencyContact) {
    patient.emergency_contact_name = emergencyContact.name?.text || 
      `${emergencyContact.name?.given?.[0]} ${emergencyContact.name?.family}`;
    patient.emergency_contact_phone = emergencyContact.telecom?.find(t => t.system === 'phone')?.value;
  }

  return patient;
}