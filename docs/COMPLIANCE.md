# TransTrack Compliance Documentation

| Document ID | TT-COMP-001 |
| --- | --- |
| Version | 2.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Quality Assurance Officer |

## Regulatory Compliance Overview

This document describes the compliance-relevant features implemented in
TransTrack. It is a description of product capability, not an attestation.

Two framework mappings exist and are maintained as controlled documents:

| Framework | Controlled mapping | What the claim means |
|---|---|---|
| HIPAA Security Rule | [`compliance/HIPAA_SECURITY_RULE_MAPPING.md`](compliance/HIPAA_SECURITY_RULE_MAPPING.md) | TransTrack provides technical safeguards a covered entity can rely on. Compliance itself is the covered entity's determination about its own practices and cannot be a property of software. |
| FDA 21 CFR Part 11 | [`compliance/PART_11_CONTROL_MAPPING.md`](compliance/PART_11_CONTROL_MAPPING.md) | Design controls, applicable only where the organization elects to treat TransTrack records as Part 11 records. Known gaps are stated in that mapping. |

**No AATB conformance is claimed.** Earlier revisions of this document contained
a section asserting alignment with AATB (American Association of Tissue Banks)
standards. No AATB control mapping ever existed behind it, and TransTrack is a
solid-organ waitlist and coordination tool rather than a tissue-bank system. The
section has been withdrawn rather than retrospectively constructed. A deploying
tissue bank requiring AATB alignment must perform that mapping itself.

For the validation status of this release, see
[`compliance/VALIDATION_SUMMARY_REPORT.md`](compliance/VALIDATION_SUMMARY_REPORT.md):
vendor software verification is executed; site IQ/OQ/PQ are not.

---

## HIPAA Compliance (Health Insurance Portability and Accountability Act)

### Technical Safeguards

1. **Data Encryption**
   - All patient data is stored in an encrypted SQLite database
   - AES-256 encryption for data at rest
   - Encryption keys are stored separately from data
   - No unencrypted PHI (Protected Health Information) written to disk

2. **Access Controls**
   - Role-based access control (RBAC) with admin, user, and viewer roles
   - Secure authentication with bcrypt password hashing (12 rounds)
   - Session-based authentication with automatic timeout
   - Unique user identification for all system access

3. **Audit Controls**
   - Complete audit trail for all data access and modifications
   - Audit logs are immutable (cannot be modified or deleted)
   - Audit entries include: user, action, timestamp, affected records
   - Logs retained for minimum 6 years per HIPAA requirements

4. **Transmission Security**
   - All core operations are performed locally against the encrypted database; no network connection is required
   - CSP (Content Security Policy) headers prevent the renderer from initiating external requests
   - Optional egress paths exist and are off by default: remote log sink, SIEM forwarder, the early-access server tier, and GitHub Releases auto-update. The logger redacts PHI at the sink and the SIEM forwarder refuses plaintext transport unless explicitly overridden. See [`../SECURITY.md`](../SECURITY.md#network-egress) and residual risk RR-12

### Administrative Safeguards

1. **User Management**
   - Only administrators can create/modify user accounts
   - Password requirements enforced
   - Account lockout after failed attempts
   - Regular access review capabilities

2. **Backup and Recovery**
   - Built-in database backup functionality
   - Encrypted backup files
   - Point-in-time recovery support

---

## FDA 21 CFR Part 11 Compliance

### Electronic Records Requirements

1. **System Validation**
   - Documented software development lifecycle
   - Validation testing procedures
   - Change control documentation

2. **Record Integrity**
   - Immutable audit trails
   - Timestamp verification for all records
   - Record versioning and history

3. **Access Controls**
   - User authentication required for all operations
   - Role-based permissions
   - Session management

4. **Audit Trail**
   - Computer-generated audit trail
   - Independently recorded date/time stamps
   - Operator identification
   - Previously recorded data preserved

5. **Electronic Signatures**
   - Unique to individual users
   - Cannot be reused or reassigned
   - Linked to electronic records

### Technical Requirements

1. **System Documentation**
   - Source code documentation
   - System architecture documentation
   - User documentation

2. **Operational Controls**
   - System procedures documentation
   - Training records
   - Maintenance logs

---

## Donor and recipient record management

The capabilities below were previously presented under an "AATB Standards"
heading. They are real product capabilities, but they were never mapped to any
AATB standard clause, so they are described here as what they are — record
management features — with the unsupported framework claim removed.

### Donor information management

1. **Donor identification**
   - Unique donor identification numbers
   - Donor demographic tracking
   - Donor consent documentation support

2. **Donor screening**
   - Medical history tracking
   - Laboratory result storage
   - Risk assessment documentation

3. **Traceability**
   - Chain-of-custody records
   - Donor-to-recipient linkage
   - Outcome tracking

### Recipient management

1. **Waitlist management**
   - Internal operational prioritization (not allocation)
   - Status tracking
   - Outcome documentation

2. **Matching documentation**
   - Compatibility assessments
   - Match decision documentation
   - Local match records — allocation itself occurs in OPTN/UNet

---

## UNOS (United Network for Organ Sharing) Alignment

### Priority Calculation

1. **Medical Urgency Scoring**
   - MELD, MELD-Na and MELD 3.0 for liver. PELD is **unavailable** — TransTrack fails closed pending a verifiable OPTN Policy 9.1.E Table 9-1 source (residual risk RR-01)
   - For lung, the **TransTrack Lung Triage Index (TTLI)** — an internal, expert-set 0–100 triage indicator. It is **not** the OPTN Lung Allocation Score and not the Composite Allocation Score, and it is flagged `isPublishedInstrument: false` on every result (residual risk RR-07)
   - KDPI/KDRI and EPTS with percentile maps that are piecewise approximations of the OPTN tables, flagged as approximations on every result (residual risk RR-03)
   - Customizable weighting for internal worklist ordering only
   - Constant provenance for every calculator is recorded in [`compliance/CLINICAL_SOURCES.md`](compliance/CLINICAL_SOURCES.md)

2. **Time on Waitlist**
   - Accurate date tracking
   - Time-based priority adjustments

3. **Compatibility Factors**
   - Blood type matching
   - HLA typing support
   - Size matching

### Allocation Transparency

1. **Decision Documentation**
   - All allocation decisions logged
   - Priority score breakdowns available
   - Match rationale documented

---

## Readiness Barriers (Non-Clinical Feature)

### Purpose and Scope

TransTrack includes a **Readiness Barriers** feature designed for **operational workflow visibility only**. This feature is:

- **NON-CLINICAL**: Does not contain diagnoses, medical opinions, or clinical assessments
- **NON-ALLOCATIVE**: Does not affect organ allocation decisions
- **Operational Only**: Supports care team coordination and workflow management

**IMPORTANT**: This feature does NOT perform allocation decisions, listing authority functions, or replace UNOS/OPTN systems.

### Barrier Types

The following non-clinical barrier types are tracked:

| Barrier Type | Description | Example Use |
|--------------|-------------|-------------|
| Pending Testing | Testing appointments need scheduling | "Lab work scheduled for next week" |
| Insurance Clearance | Insurance authorization status | "Pre-auth in progress" |
| Transportation Plan | Post-surgery transportation logistics | "Transportation arranged" |
| Caregiver Support | Support partner availability | "Caregiver confirmed" |
| Housing/Distance | Housing or distance-related logistics | "Temporary housing secured" |
| Psychosocial Follow-up | Scheduling flag only (no clinical detail) | "Follow-up scheduled" |
| Financial Clearance | Financial assistance or payment plans | "Payment plan established" |
| Other Non-Clinical | Other administrative barriers | Custom operational notes |

### Compliance Safeguards

1. **Data Minimization**
   - Notes field limited to 255 characters
   - No free-text clinical narratives allowed
   - Structured dropdown selections only
   - No diagnoses or medical opinions stored

2. **Audit Trail**
   - All barrier changes logged with user attribution
   - Create, update, resolve, and delete actions tracked
   - Immutable audit history for regulatory review
   - Timestamp and user identification on all actions

3. **Role-Based Access**
   - Owning role assignment for accountability
   - Access justification may be required for sensitive operations
   - Audit logs track all barrier access

4. **Non-Clinical Designation**
   - Clear UI labeling as "Non-Clinical"
   - Disclaimer displayed on all barrier views
   - Barrier data separated from clinical records
   - No integration with allocation algorithms

### Audit Log Structure for Barriers

| Field | Description |
|-------|-------------|
| action | create, update, resolve, delete |
| entity_type | ReadinessBarrier |
| entity_id | Barrier UUID |
| patient_name | Associated patient |
| details | JSON with barrier_type, status, changes |
| user_email | User who performed action |
| created_date | Timestamp |

### Regulatory Alignment

- **HIPAA**: Audit trail meets minimum necessary standard
- **FDA 21 CFR Part 11**: Immutable records with electronic signatures
- **UNOS/OPTN**: Explicitly non-allocative (does not affect organ allocation)

---

## Adult Health History Questionnaire (aHHQ) Tracking (Non-Clinical Feature)

### Purpose and Scope

TransTrack includes an **aHHQ Tracking** feature designed for **operational documentation tracking only**. This feature answers:

- Is the aHHQ present?
- Is it complete?
- Is it current?
- Is it approaching expiration?
- Is follow-up required?

This feature is:

- **NON-CLINICAL**: Does not store medical narratives, diagnoses, or clinical interpretations
- **NON-ALLOCATIVE**: Does not affect organ allocation decisions
- **Documentation-Focused**: Tracks questionnaire status as a time-bound evaluation artifact
- **Operational Only**: Supports documentation compliance and workflow management

**IMPORTANT**: This feature does NOT store actual health history content. It only tracks the status of the questionnaire documentation.

### aHHQ Status Values

| Status | Description |
|--------|-------------|
| Complete | aHHQ is fully completed and current |
| Incomplete | aHHQ has missing sections or information |
| Pending Update | aHHQ requires review and update |
| Expired | aHHQ has exceeded its validity period |

### Identified Issues (Operational Only)

| Issue Type | Description |
|------------|-------------|
| Missing Sections | One or more required sections are incomplete |
| Outdated Information | Information needs to be reviewed and updated |
| Follow-up Required | Additional documentation or follow-up is needed |
| Documentation Pending | Supporting documentation has been requested |
| Signature Required | Patient or provider signature is needed |
| Verification Needed | Information requires verification |

### Compliance Safeguards

1. **Data Minimization**
   - Notes field limited to 255 characters
   - No clinical narratives allowed
   - Only tracks status, not content
   - No medical opinions or interpretations stored

2. **Expiration Tracking**
   - Configurable validity period (default 365 days)
   - Warning at 30 days before expiration
   - Automatic expired status detection
   - Contributes to operational risk indicators

3. **Audit Trail**
   - All aHHQ status changes logged with user attribution
   - Create, update, complete, and delete actions tracked
   - Immutable audit history for regulatory review
   - Timestamp and user identification on all actions

4. **Role-Based Access**
   - Owning role assignment for accountability
   - Access justification may be required
   - Audit logs track all aHHQ access

5. **Non-Clinical Designation**
   - Clear UI labeling as "Non-Clinical" / "Operational Documentation"
   - Disclaimer displayed on all aHHQ views
   - aHHQ tracking separated from clinical records
   - No integration with allocation algorithms

### Audit Log Structure for aHHQ

| Field | Description |
|-------|-------------|
| action | create, update, complete, follow_up_required, delete |
| entity_type | AdultHealthHistoryQuestionnaire |
| entity_id | aHHQ UUID |
| patient_id | Associated patient ID |
| details | JSON with status, changes, expiration_date |
| user_email | User who performed action |
| created_date | Timestamp |

### Regulatory Alignment

- **HIPAA**: Minimum necessary standard (no clinical content stored)
- **FDA 21 CFR Part 11**: Immutable records with electronic signatures
- **UNOS/OPTN**: Explicitly non-allocative (does not affect organ allocation)
- **Documentation Compliance**: Supports evaluation artifact tracking

---

## Data Security Features

### Local Storage Security

```
┌─────────────────────────────────────────────┐
│           TransTrack Application            │
├─────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐    │
│  │         Electron Main Process       │    │
│  │  ┌─────────────────────────────┐   │    │
│  │  │   SQLite Database (Local)   │   │    │
│  │  │   - AES-256 Encryption      │   │    │
│  │  │   - WAL Mode                │   │    │
│  │  │   - Foreign Key Integrity   │   │    │
│  │  └─────────────────────────────┘   │    │
│  └─────────────────────────────────────┘    │
│                     ↑                       │
│              IPC (Secure)                   │
│                     ↓                       │
│  ┌─────────────────────────────────────┐    │
│  │       Electron Renderer Process     │    │
│  │   (React Application - Sandboxed)   │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### Audit Log Structure

| Field | Description |
|-------|-------------|
| id | Unique identifier |
| action | Type of action (create, read, update, delete, login, export) |
| entity_type | Type of record affected |
| entity_id | ID of record affected |
| patient_name | Patient identifier (for PHI access tracking) |
| details | Description of action |
| user_email | User who performed action |
| user_role | Role of user |
| created_date | Timestamp of action |

### Access Control Matrix

| Role | Patients | Donors | Matches | Reports | Settings | Audit Logs |
|------|----------|--------|---------|---------|----------|------------|
| Admin | Full | Full | Full | Full | Full | Read |
| User | Full | Full | Full | Read | None | None |
| Viewer | Read | Read | Read | Read | None | None |

---

## Compliance Checklist

### Pre-Deployment

- [ ] System validation completed
- [ ] User access procedures documented
- [ ] Backup procedures documented
- [ ] Training materials prepared
- [ ] Security assessment completed

### Ongoing Compliance

- [ ] Regular access reviews (quarterly)
- [ ] Audit log reviews (monthly)
- [ ] Backup verification (weekly)
- [ ] Security updates applied (as released)
- [ ] User training current (annual)

---

## Regulatory Contact Information

External regulators:

**FDA Medical Device Reporting**: 1-800-FDA-1088
**HHS OCR (HIPAA)**: https://www.hhs.gov/hipaa/

Vendor:

| Purpose | Address |
|---|---|
| Security vulnerability disclosure | `security@transtrack.example` — see [`../SECURITY.md`](../SECURITY.md#reporting-a-security-issue) |
| Compliance and validation questions | `support@transtrack.example` |

Both are role-based placeholders that are not yet provisioned; see residual risk
**RR-15**.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-23 | Initial release. |
| 2.0 | 2026-08-02 | Withdrew the AATB Standards section and the AATB claim in the overview, neither of which had a control mapping behind it (finding M-17 item 3). Corrected the transmission-security claim to enumerate the optional egress paths (M-17 item 2). Corrected the calculator descriptions: PELD unavailable, TTLI is not the OPTN LAS, KDPI/EPTS percentiles are approximations (M-17 item 11). Replaced the consumer webmail contact with role-based addresses (L-13). Added document control header and links to the executed validation package. | Quality Assurance Officer |

---

*This document is part of the TransTrack regulatory compliance package. The
full validation package is in [`compliance/`](compliance/); start with
[`compliance/VALIDATION_SUMMARY_REPORT.md`](compliance/VALIDATION_SUMMARY_REPORT.md).*
