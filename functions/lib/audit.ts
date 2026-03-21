/**
 * TransTrack - HIPAA-Compliant Audit Trail
 *
 * Provides comprehensive WHO/WHAT/WHEN/WHERE/WHY audit logging
 * as required by HIPAA 164.312(b).
 *
 * Generates a SHA-256 hash of each audit record for immutability verification.
 */

type AuditAction = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'EXPORT' | 'MATCH' | 'CALCULATE';
type AccessType = 'DIRECT' | 'INCIDENTAL' | 'EMERGENCY_ACCESS' | 'SYSTEM';

interface AuditUser {
  email: string;
  role: string;
  id?: string;
}

interface HIPAAAuditEntry {
  action: string;
  entity_type: string;
  entity_id: string;
  patient_name?: string;
  details: string;
  user_email: string;
  user_role: string;
  hipaa_action: AuditAction;
  access_type: AccessType;
  access_justification?: string;
  outcome: 'SUCCESS' | 'FAILURE';
  error_message?: string;
  data_modified?: string;
  request_id?: string;
  record_hash?: string;
}

async function computeRecordHash(data: Record<string, unknown>): Promise<string> {
  const serialized = JSON.stringify(data, Object.keys(data).sort());
  const encoded = new TextEncoder().encode(serialized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a HIPAA-compliant audit log entry via the API.
 */
export async function createHIPAAAuditLog(
  api: { entities: { AuditLog: { create: (data: Record<string, unknown>) => Promise<unknown> } } },
  params: {
    action: AuditAction;
    entityType: string;
    entityId: string;
    patientName?: string;
    details: string;
    user: AuditUser;
    accessType?: AccessType;
    accessJustification?: string;
    outcome?: 'SUCCESS' | 'FAILURE';
    errorMessage?: string;
    dataModified?: Record<string, [unknown, unknown]>;
    requestId?: string;
  }
): Promise<void> {
  const entry: HIPAAAuditEntry = {
    action: params.action.toLowerCase(),
    entity_type: params.entityType,
    entity_id: params.entityId,
    patient_name: params.patientName,
    details: params.details,
    user_email: params.user.email,
    user_role: params.user.role,
    hipaa_action: params.action,
    access_type: params.accessType || 'DIRECT',
    access_justification: params.accessJustification,
    outcome: params.outcome || 'SUCCESS',
    error_message: params.errorMessage,
    data_modified: params.dataModified ? JSON.stringify(params.dataModified) : undefined,
    request_id: params.requestId,
  };

  entry.record_hash = await computeRecordHash(entry as unknown as Record<string, unknown>);

  await api.entities.AuditLog.create(entry as unknown as Record<string, unknown>);
}
