import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const api = createClientFromRequest(req);
    
    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, integration_id, fields_to_sync } = await req.json();

    // Get patient and integration details
    const patient = await api.entities.Patient.get(patient_id);
    const integration = await api.entities.EHRIntegration.get(integration_id);

    if (!patient || !integration) {
      return Response.json({ error: 'Patient or integration not found' }, { status: 404 });
    }

    if (!integration.enable_bidirectional_sync) {
      return Response.json({ 
        error: 'Bidirectional sync not enabled for this integration' 
      }, { status: 400 });
    }

    const startTime = Date.now();
    const syncedFields = [];
    const errors = [];

    // Generate FHIR bundle for selected fields
    const response = await api.functions.invoke('exportToFHIR', {
      patient_id: patient.id,
      resource_types: ['Patient', 'Observation', 'Condition']
    });

    const fhirBundle = response.data.fhir_bundle;

    // Filter resources based on fields_to_sync
    const fieldsToSync = fields_to_sync || integration.sync_fields_to_ehr || [];
    
    if (fieldsToSync.length === 0) {
      return Response.json({ 
        error: 'No fields configured for sync' 
      }, { status: 400 });
    }

    // Prepare authentication headers
    let authHeaders = {};
    const apiKey = Deno.env.get(`EHR_API_KEY_${integration.id}`);
    
    if (integration.auth_type === 'bearer_token' && apiKey) {
      authHeaders['Authorization'] = `Bearer ${apiKey}`;
    } else if (integration.auth_type === 'basic_auth' && apiKey) {
      authHeaders['Authorization'] = `Basic ${apiKey}`;
    }

    authHeaders['Content-Type'] = 'application/fhir+json';
    authHeaders['Accept'] = 'application/fhir+json';

    // Push to EHR system
    let ehrResponse;
    try {
      const pushResponse = await fetch(integration.endpoint_url, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(fhirBundle)
      });

      ehrResponse = {
        status: pushResponse.status,
        statusText: pushResponse.statusText,
        body: await pushResponse.text()
      };

      if (!pushResponse.ok) {
        errors.push(`EHR system returned ${pushResponse.status}: ${pushResponse.statusText}`);
      } else {
        syncedFields.push(...fieldsToSync);
        
        // Update integration stats
        await api.entities.EHRIntegration.update(integration.id, {
          total_exports: (integration.total_exports || 0) + 1,
          last_export_date: new Date().toISOString()
        });
      }
    } catch (fetchError) {
      errors.push(`Network error: ${fetchError.message}`);
      ehrResponse = { error: fetchError.message };
    }

    const syncDuration = Date.now() - startTime;

    // Log the sync
    const syncLog = await api.entities.EHRSyncLog.create({
      sync_direction: 'outbound',
      integration_id: integration.id,
      patient_id: patient.id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      fhir_resource_type: 'Bundle',
      fields_synced: syncedFields,
      status: errors.length === 0 ? 'success' : 'failed',
      error_message: errors.join('; ') || null,
      ehr_response: ehrResponse,
      triggered_by: 'manual',
      sync_duration_ms: syncDuration
    });

    // Audit log
    await api.entities.AuditLog.create({
      action: 'update',
      entity_type: 'Patient',
      entity_id: patient.id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      details: `Data pushed to EHR ${integration.integration_name}: ${syncedFields.length} fields synced`,
      user_email: user.email,
      user_role: user.role,
    });

    return Response.json({
      success: errors.length === 0,
      synced_fields: syncedFields,
      errors,
      sync_log_id: syncLog.id,
      ehr_response: ehrResponse
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});