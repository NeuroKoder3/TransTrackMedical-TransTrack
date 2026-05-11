import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';
import { createLogger, generateRequestId, safeErrorResponse } from './lib/logger.ts';

const logger = createLogger('pushToEHR');

Deno.serve(async (req) => {
  const requestId = generateRequestId();

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

    // Validate endpoint URL to prevent SSRF
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(integration.endpoint_url);
    } catch {
      return Response.json({ error: 'Invalid integration endpoint URL' }, { status: 400 });
    }
    if (endpointUrl.protocol !== 'https:' && endpointUrl.protocol !== 'http:') {
      return Response.json({ error: 'Unsupported endpoint protocol' }, { status: 400 });
    }
    const hostname = endpointUrl.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
        hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') || hostname.endsWith('.internal')) {
      return Response.json({ error: 'Endpoint resolves to restricted address' }, { status: 400 });
    }

    let ehrResponse;
    try {
      const pushResponse = await fetch(endpointUrl.toString(), {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(fhirBundle)
      });

      ehrResponse = {
        status: pushResponse.status,
        statusText: pushResponse.statusText,
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
    });
  } catch (error) {
    logger.error('EHR push failed', error, { request_id: requestId });
    return safeErrorResponse(requestId, 'EHR data push failed. Contact support.');
  }
});