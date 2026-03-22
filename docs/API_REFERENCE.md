# TransTrack API Reference

## Overview

TransTrack uses Electron IPC (Inter-Process Communication) for all communication between the renderer (React UI) and the main process (Node.js backend). All channels are exposed through the `window.electronAPI` context bridge.

All data operations are org-scoped: queries automatically filter by the logged-in user's organization. No cross-org data access is possible through the API.

---

## Authentication

### `auth.login(credentials)`

Authenticate a user and create a session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `credentials.email` | string | Yes | User email address |
| `credentials.password` | string | Yes | User password |

**Returns**: `{ success: true, user: { id, email, full_name, role, org_id } }`

**Errors**: Account locked (after 5 failed attempts, 15-min lockout), invalid credentials.

### `auth.logout()`

End the current session.

**Returns**: `{ success: true }`

### `auth.me()`

Get the currently authenticated user.

**Returns**: `{ id, email, full_name, role, org_id, license_tier }` or `null`

### `auth.isAuthenticated()`

Check if a valid session exists.

**Returns**: `boolean`

### `auth.changePassword(data)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `data.currentPassword` | string | Yes | Current password |
| `data.newPassword` | string | Yes | New password (min 12 chars, mixed case, number, special) |

### `auth.createUser(userData)`

Create a new user (admin only).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userData.email` | string | Yes | User email |
| `userData.full_name` | string | Yes | Display name |
| `userData.role` | string | Yes | One of: admin, coordinator, physician, user, viewer, regulator |
| `userData.password` | string | Yes | Initial password |

### `auth.listUsers()`

List all users in the current organization (admin only).

### `auth.updateUser(id, userData)`

Update a user's profile or role (admin only).

### `auth.deleteUser(id)`

Deactivate a user (admin only). Does not delete — sets `is_active = 0`.

---

## Entity CRUD Operations

All entity operations follow the same pattern via the generic `entities` API.

### Supported Entity Types

| Entity | Table | Description |
|--------|-------|-------------|
| `Patient` | patients | Transplant waitlist patients |
| `DonorOrgan` | donor_organs | Available donor organs |
| `Match` | matches | Patient-donor compatibility matches |
| `Notification` | notifications | System notifications |
| `NotificationRule` | notification_rules | Automated notification rules |
| `PriorityWeights` | priority_weights | Priority scoring configuration |
| `EHRIntegration` | ehr_integrations | EHR system connections |
| `EHRImport` | ehr_imports | EHR data import records |
| `EHRSyncLog` | ehr_sync_logs | EHR sync history |
| `EHRValidationRule` | ehr_validation_rules | EHR field validation rules |
| `AuditLog` | audit_logs | Immutable audit trail (read-only) |
| `User` | users | System users |

### `entities.create(entityName, data)`

Create a new entity. Auto-assigns `id`, `org_id`, and `created_at`.

### `entities.get(entityName, id)`

Get a single entity by ID (org-scoped).

### `entities.update(entityName, id, data)`

Update an entity. Not available for `AuditLog`.

### `entities.delete(entityName, id)`

Delete an entity. Not available for `AuditLog`.

### `entities.list(entityName, orderBy, limit)`

List entities with optional sorting and pagination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `orderBy` | string | No | Column name. Prefix with `-` for DESC. |
| `limit` | number | No | Max rows (1-10000) |

### `entities.filter(entityName, filters, orderBy, limit)`

Filter entities by field values.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filters` | object | Yes | Key-value pairs for WHERE clauses |
| `orderBy` | string | No | Sort column |
| `limit` | number | No | Max rows |

---

## Business Logic Functions

### `functions.invoke(functionName, params)`

Execute a business logic function.

| Function | Description | Parameters |
|----------|-------------|------------|
| `calculatePriority` | Recalculate patient priority scores | `{ patientIds?: string[] }` |
| `matchDonor` | Find matching patients for a donor organ | `{ donorOrganId: string }` |
| `exportToFHIR` | Export patient data as FHIR R4 bundle | `{ patientId: string }` |
| `importFHIRData` | Import FHIR R4 data | `{ fhirData: object }` |
| `validateFHIRData` | Validate FHIR R4 structure | `{ fhirData: object }` |
| `exportWaitlist` | Export waitlist as structured data | `{ format?: string }` |

---

## Encryption

### `encryption.getStatus()`

Get current encryption configuration.

**Returns**:
```json
{
  "enabled": true,
  "algorithm": "AES-256-CBC",
  "keyDerivation": "PBKDF2-HMAC-SHA512",
  "keyIterations": 256000,
  "compliant": true,
  "standard": "HIPAA"
}
```

### `encryption.verifyIntegrity()`

Run SQLite integrity check on the encrypted database.

**Returns**: `{ valid: boolean, encrypted: boolean, integrityCheck: string }`

### `encryption.isEnabled()`

**Returns**: `boolean`

### `encryption.rotateKey(options)`

Rotate the database encryption key (admin only).

Creates a pre-rotation backup, generates a new 256-bit key, re-keys the database, and verifies integrity.

**Returns**: `{ success: true, rotatedAt, preRotationBackup, integrityVerified }`

### `encryption.getKeyRotationStatus()`

**Returns**: `{ totalRotations, lastRotation, daysSinceRotation, rotationRecommended }`

### `encryption.getKeyRotationHistory()`

**Returns**: Array of rotation log entries.

---

## FHIR R4 Validation

### `fhir.validate(fhirData)`

Validate a FHIR R4 resource or bundle.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fhirData` | object/string | Yes | FHIR resource or JSON string |

**Returns**:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "resourceType": "Bundle",
  "resourceCount": 5
}
```

---

## Disaster Recovery

### `recovery.createBackup(options)`

Create a verified backup with checksum.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.type` | string | No | `manual` (default) or `auto` |
| `options.description` | string | No | Backup description |

### `recovery.listBackups()`

List all available backups sorted by date (newest first).

### `recovery.verifyBackup(backupId)`

Verify backup integrity including actual restore test.

**Returns**: `{ valid, checksumVerified, integrityCheckPassed, restoreTestPassed, stats }`

### `recovery.restoreBackup(backupId)`

Restore from a backup (admin only). Creates a pre-restore backup automatically.

**Returns**: `{ success, restoredFrom, preRestoreBackup, requiresRestart: true }`

### `recovery.getStatus()`

Get overall recovery status including backup age and overdue alerts.

---

## Compliance

### `compliance.getSummary()`

Get compliance dashboard summary.

### `compliance.getAuditTrail(options)`

Query audit logs with filtering.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.startDate` | string | No | ISO date string |
| `options.endDate` | string | No | ISO date string |
| `options.action` | string | No | Filter by action type |
| `options.limit` | number | No | Max results |

### `compliance.getDataCompleteness()`

Get data completeness report across all patients.

### `compliance.getValidationReport()`

Generate a validation report for regulatory submission.

### `compliance.getAccessLogs(options)`

Get access justification logs.

---

## System Diagnostics

### `system.getMigrationStatus()`

Get database schema migration status.

**Returns**:
```json
{
  "currentVersion": 3,
  "totalAvailable": 3,
  "applied": 3,
  "pending": 0,
  "pendingMigrations": [],
  "appliedMigrations": [...]
}
```

---

## Readiness Barriers

### `barriers.create(data)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `data.patient_id` | string | Yes | Patient UUID |
| `data.barrier_type` | string | Yes | See barrier types below |
| `data.risk_level` | string | Yes | `low`, `moderate`, `high` |
| `data.owning_role` | string | Yes | `social_work`, `financial`, `coordinator`, `other` |
| `data.notes` | string | No | Max 255 characters |

**Barrier Types**: `PENDING_TESTING`, `INSURANCE_CLEARANCE`, `TRANSPORTATION_PLAN`, `CAREGIVER_SUPPORT`, `HOUSING_DISTANCE`, `PSYCHOSOCIAL_FOLLOWUP`, `FINANCIAL_CLEARANCE`, `OTHER_NON_CLINICAL`

### `barriers.getByPatient(patientId, includeResolved)`

### `barriers.resolve(id)`

### `barriers.getDashboard()`

---

## Lab Results

### `labs.create(data)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `data.patient_id` | string | Yes | Patient UUID |
| `data.test_code` | string | Yes | Lab test code |
| `data.test_name` | string | Yes | Lab test display name |
| `data.value` | string | Yes | Result value (stored as string) |
| `data.collected_at` | string | Yes | ISO datetime of collection |
| `data.source` | string | No | `MANUAL` (default) or `FHIR_IMPORT` |

### `labs.getByPatient(patientId, options)`

### `labs.getPatientStatus(patientId)`

### `labs.getDashboard()`

---

## License Management

### `license.getInfo()`

Get current license information.

### `license.activate(key, customerInfo)`

Activate a license key.

### `license.checkFeature(feature)`

Check if a feature is available in the current license tier.

**Returns**: `{ allowed: boolean, reason?: string }`

### `license.getAppState()`

Get full application state including license, evaluation status, and restrictions.

---

## Error Handling

All IPC handlers return errors as thrown exceptions. The renderer should catch these:

```javascript
try {
  const result = await window.electronAPI.entities.Patient.create(data);
} catch (error) {
  // error.message contains the error description
  console.error('Failed to create patient:', error.message);
}
```

### Common Error Codes

| Error | Cause | Resolution |
|-------|-------|------------|
| `Not authenticated` | No active session | Re-login |
| `Organization context required` | Session missing org_id | Re-login |
| `Admin access required` | Insufficient role | Use admin account |
| `Feature not available` | License tier restriction | Upgrade license |
| `Account locked` | Too many failed logins | Wait 15 minutes |
| `Audit logs are immutable` | Attempted audit log modification | By design — cannot modify |

---

## Rate Limiting

IPC handlers are rate-limited to prevent abuse. Default limits:

| Category | Limit |
|----------|-------|
| Read operations | 100 requests/minute |
| Write operations | 30 requests/minute |
| Auth operations | 10 requests/minute |
| Export operations | 5 requests/minute |

Exceeding limits returns a `429 Too Many Requests` style error.
