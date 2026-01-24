import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    // Validate webhook authentication
    const authHeader = req.headers.get('Authorization');
    const webhookSecret = Deno.env.get('EHR_WEBHOOK_SECRET');
    
    if (!webhookSecret) {
      return Response.json({ 
        error: 'EHR webhook not configured. Contact administrator.' 
      }, { status: 503 });
    }

    // Simple bearer token auth
    if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const api = createClientFromRequest(req);

    const payload = await req.json();

    // Validate FHIR resource
    if (!payload.resourceType) {
      return Response.json({ 
        error: 'Invalid FHIR resource' 
      }, { status: 400 });
    }

    // Handle different FHIR resource types
    if (payload.resourceType === 'Bundle') {
      // Process bundle
      const entries = payload.entry || [];
      const results = {
        processed: 0,
        created: 0,
        updated: 0,
        failed: 0
      };

      for (const entry of entries) {
        if (entry.resource?.resourceType === 'Patient') {
          results.processed++;
          
          try {
            const fhirPatient = entry.resource;
            const patientId = fhirPatient.identifier?.[0]?.value;
            
            // Check if patient exists
            const existing = await api.asServiceRole.entities.Patient.filter({
              patient_id: patientId
            });

            const mappedData = {
              patient_id: patientId,
              first_name: fhirPatient.name?.[0]?.given?.[0] || '',
              last_name: fhirPatient.name?.[0]?.family || '',
              date_of_birth: fhirPatient.birthDate,
              phone: fhirPatient.telecom?.find(t => t.system === 'phone')?.value,
              email: fhirPatient.telecom?.find(t => t.system === 'email')?.value,
            };

            if (existing.length > 0) {
              await api.asServiceRole.entities.Patient.update(existing[0].id, mappedData);
              results.updated++;
            } else {
              await api.asServiceRole.entities.Patient.create(mappedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            console.error('Patient processing error:', error);
          }
        }
      }

      return Response.json({
        success: true,
        message: 'FHIR webhook processed',
        results
      });
    }

    return Response.json({
      success: true,
      message: 'FHIR resource received',
      resourceType: payload.resourceType
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});