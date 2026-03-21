# HIPAA Compliance Matrix

This document maps each TransTrack function and component to the applicable HIPAA regulatory requirements, documenting the current implementation status.

## Regulatory Reference

- **HIPAA Security Rule**: 45 CFR Part 164, Subpart C
- **HIPAA Privacy Rule**: 45 CFR Part 164, Subpart E
- **FDA 21 CFR Part 11**: Electronic Records and Signatures
- **AATB Standards**: American Association of Tissue Banks

---

## Function-Level Compliance

| Function | HIPAA Rule | Requirement | Implementation | Status |
|---|---|---|---|---|
| `calculatePriority.ts` | 164.312(b) | Audit Controls | HIPAA audit log with WHO/WHAT/WHEN/WHY, SHA-256 hash for immutability | ✅ |
| `calculatePriority.ts` | 164.312(a)(1) | Access Control | User authentication required, UUID validation | ✅ |
| `calculatePriority.ts` | 164.312(c)(1) | Integrity Controls | Input validation for MELD/LAS/PRA scores against medical ranges | ✅ |
| `calculatePriority.ts` | 164.312(d) | Person Authentication | `api.auth.me()` validates user identity | ✅ |
| `matchDonor.ts` | 164.312(b) | Audit Controls | HIPAA audit log with access justification tracking | ✅ |
| `matchDonor.ts` | 164.308(a)(1)(i) | Security Management | Input validation, HLA format checking, blood type verification | ✅ |
| `matchDonor.ts` | 164.312(e)(1) | Transmission Security | Patient names sanitized in notifications, no PHI in error messages | ✅ |
| `matchDonor.ts` | 164.312(c)(1) | Integrity Controls | Race condition mitigation via patient freshness check | ✅ |
| `exportToFHIR.ts` | 164.312(b) | Audit Controls | Structured logging with request ID tracking | ✅ |
| `exportToFHIR.ts` | 164.312(e)(1) | Transmission Security | Diagnosis text sanitized against XSS/injection | ✅ |
| `exportToFHIR.ts` | 164.530(c) | Notice of Breach | Error logging without PHI exposure | ✅ |
| `importFHIRData.ts` | 164.312(b) | Audit Controls | Import records with structured logging | ✅ |
| `importFHIRData.ts` | 164.312(c)(1) | Integrity Controls | FHIR validation before import | ✅ |
| `pushToEHR.ts` | 164.312(e)(1) | Transmission Security | Auth headers for EHR communication | ✅ |
| `pushToEHR.ts` | 164.312(b) | Audit Controls | Sync logs with detailed tracking | ✅ |
| `checkNotificationRules.ts` | 164.312(e)(1) | Transmission Security | Patient names sanitized in notification messages | ✅ |
| `exportWaitlist.ts` | 164.312(b) | Audit Controls | Export action logged with user context | ✅ |
| `validateFHIRData.ts` | 164.312(c)(1) | Integrity Controls | Configurable validation rules | ✅ |
| `fhirWebhook.ts` | 164.312(d) | Person Authentication | Bearer token authentication | ✅ |

## Application-Level Compliance

| Component | HIPAA Rule | Requirement | Implementation | Status |
|---|---|---|---|---|
| `electron/main.cjs` | 164.312(a)(1) | Access Control | License validation with fail-closed behavior | ✅ |
| `electron/main.cjs` | 164.312(e)(1) | Transmission Security | CSP headers, X-Frame-Options, X-Content-Type-Options | ✅ |
| `electron/main.cjs` | 164.312(a)(2)(iv) | Encryption | SQLCipher encrypted database | ✅ |
| `electron/preload.cjs` | 164.312(a)(1) | Access Control | Context isolation, restricted IPC bridge | ✅ |
| `src/App.jsx` | 164.312(d) | Person Authentication | Auth state validation, license enforcement | ✅ |
| `src/App.jsx` | 164.312(a)(1) | Access Control | Fail-closed license checking (no bypass on error) | ✅ |

## Error Handling Compliance

| Requirement | Before | After | Status |
|---|---|---|---|
| No PHI in error responses | ❌ `error.message` exposed | ✅ Generic message + request ID | ✅ |
| Structured internal logging | ❌ Unstructured `console.error` | ✅ JSON-structured with redaction | ✅ |
| Error tracking | ❌ No correlation | ✅ Request ID in response + logs | ✅ |

## Audit Trail Requirements (HIPAA 164.312(b))

| Requirement | Implementation | Status |
|---|---|---|
| WHO accessed the data | `user_email`, `user_role` fields | ✅ |
| WHAT was accessed/modified | `entity_type`, `entity_id`, `hipaa_action` | ✅ |
| WHEN was it accessed | `timestamp` (ISO 8601) | ✅ |
| WHY was it accessed | `access_justification` field | ✅ |
| Outcome of access | `outcome` (SUCCESS/FAILURE) | ✅ |
| Data changes | `data_modified` (before/after values) | ✅ |
| Immutability verification | `record_hash` (SHA-256) | ✅ |
| Access type classification | `access_type` (DIRECT/INCIDENTAL/EMERGENCY/SYSTEM) | ✅ |

## Input Validation (164.312(c)(1) Integrity Controls)

| Data Type | Validation | Status |
|---|---|---|
| MELD Score | Range 6-40, finite number | ✅ |
| LAS Score | Range 0-100, finite number | ✅ |
| PRA Percentage | Range 0-100, finite number | ✅ |
| cPRA Percentage | Range 0-100, finite number | ✅ |
| Blood Type | Enum validation (8 valid types) | ✅ |
| Medical Urgency | Enum validation (critical/high/medium/low) | ✅ |
| Organ Type | Enum validation (6 valid types) | ✅ |
| HLA Typing | Format regex, length limit, antigen count limit | ✅ |
| Patient ID | UUID format validation | ✅ |
| Diagnosis Text | HTML sanitization, length limit | ✅ |
| Patient Names | HTML sanitization in all notifications | ✅ |

---

*Last updated: 2026-03-21*
*Document owner: TransTrack Engineering*
