# TransTrack System Requirements Specification (SRS)

| Document control | |
|---|---|
| Document ID | TT-SRS-001 |
| Version | 1.0 |
| Status | Baseline |

Each requirement has a unique ID `TT-Rxxx`, a category, a priority (M=Mandatory,
S=Should, C=Could), and a verification method (R=Review, T=Test, I=Inspection,
D=Demonstration). All `M` requirements must trace to at least one OQ test case.

## 1. Authentication and access control (AC)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R001 | M | The system shall authenticate users with a username and password before granting any access to PHI. | T |
| TT-R002 | M | The system shall enforce a minimum password length of 12 characters with at least one upper, one lower, one digit, and one symbol. | T |
| TT-R003 | M | The system shall lock an account for at least 15 minutes after 5 consecutive failed login attempts. | T |
| TT-R004 | M | The system shall require time-based one-time password (TOTP) MFA for all users when MFA is enabled at the organization level. | T |
| TT-R005 | M | The system shall provide one-time backup codes for MFA recovery. | T |
| TT-R006 | M | The system shall maintain a password history of at least the last 12 passwords and prevent reuse. | T |
| TT-R007 | M | The system shall enforce password rotation at a configurable interval (default 90 days). | T |
| TT-R008 | M | The system shall expire idle sessions after a configurable period (default 15 minutes). | T |
| TT-R009 | M | The system shall enforce role-based access control with at least the roles: admin, coordinator, physician, user, viewer, regulator. | T |
| TT-R010 | S | The system shall support SSO via OIDC or SAML 2.0 (post-1.0). | R |

## 2. Auditing (AU)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R020 | M | The system shall record an audit event for every create / read / update / delete on patient records. | T |
| TT-R021 | M | Audit events shall include actor user ID, role, timestamp (ISO 8601 UTC), action, entity, and request ID. | T |
| TT-R022 | M | Audit events shall be immutable: any UPDATE or DELETE on the audit log table shall be rejected at the database trigger level. | T |
| TT-R023 | M | The system shall record successful and failed authentication attempts. | T |
| TT-R024 | M | The system shall record every export of PHI, including the destination file and the requesting user. | T |
| TT-R025 | M | The system shall record every change to user roles, permissions, and MFA enrollment. | T |
| TT-R026 | S | The system shall optionally forward audit events to an external SIEM in RFC 5424 syslog with CEF payload over UDP, TCP, or TLS. | T |

## 3. Confidentiality, integrity, encryption (CI)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R040 | M | All PHI at rest shall be encrypted with AES-256 using SQLCipher with PBKDF2-SHA512 (≥256 000 iterations). | I |
| TT-R041 | M | The encryption key shall not be stored in cleartext on disk. | I |
| TT-R042 | M | The system shall provide an administrator-driven key-rotation function with audited history. | T |
| TT-R043 | M | The system shall verify database integrity at startup (SQLCipher integrity check). | T |
| TT-R044 | M | All exports containing PHI shall be marked with the producing user, timestamp, and a confidentiality banner. | T |

## 4. Operational transplant features (OP)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R060 | M | The system shall track waitlisted patients with status, organ needed, blood type, HLA typing, MELD/PELD/LAS scores, and CPRA. | T |
| TT-R061 | M | The system shall calculate MELD, MELD-Na, MELD 3.0, PELD, LAS, KDPI, and EPTS scores from documented inputs and shall not display a score unless all required inputs are present. | T |
| TT-R062 | M | The system shall present a configurable Priority Score that is clearly labelled as **operational, not allocative**. | T,R |
| TT-R063 | M | The system shall track readiness barriers per patient with type, status, owning role, and resolution date. | T |
| TT-R064 | M | The system shall track adult Health History Questionnaires (aHHQ) with status, completion date, expiration date. | T |
| TT-R065 | M | The system shall record laboratory results as opaque strings without clinical interpretation. | T |
| TT-R066 | M | The system shall manage organ offers via a state machine (PENDING → ACCEPTED / DECLINED / EXPIRED / RESCINDED) with response timers and decline-reason codes. | T |
| TT-R067 | M | The system shall track post-transplant follow-up: transplant event, immunosuppression regimens, rejection episodes, biopsies, readmissions, graft and patient status. | T |
| TT-R068 | M | The system shall maintain a separate living-donor record set with evaluation milestones and post-donation follow-up windows aligned with OPTN Policy 14. | T |
| TT-R069 | S | The system shall ingest HL7 v2 ADT (A01/A03/A04/A08) and ORU R01 messages and map them to internal entities. | T |
| TT-R070 | S | The system shall produce CSV exports shaped after OPTN TCR / TRR / TRF fields with an explicit "not for UNet submission" disclaimer. | T |

## 5. Performance and reliability (PR)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R080 | M | Patient list page shall return ≤2 s for the first 1 000 patients on the reference workstation defined in the IQ. | T |
| TT-R081 | M | The application shall recover gracefully from an unexpected termination with no data loss for committed transactions. | T |
| TT-R082 | M | The application shall create encrypted nightly backups when configured and shall verify backup integrity. | T |
| TT-R083 | M | The application shall support full restore from backup in ≤30 minutes for 100 000 patient records on the reference workstation. | T |

## 6. Interoperability (IO)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R100 | S | The system shall validate inbound and outbound FHIR R4 resources against the bundled profile. | T |
| TT-R101 | S | The system shall expose IPC endpoints for HL7 v2 message ingestion. | T |

## 7. Compliance and reporting (CR)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R120 | M | The system shall generate a HIPAA audit report scoped by date range, user, patient, action, and entity. | T |
| TT-R121 | M | The system shall expose database migration status to administrators. | T |
| TT-R122 | M | The system shall expose encryption status, key rotation history, and integrity check results to administrators. | T |
| TT-R123 | S | The system shall expose an OPTN-style export with explicit non-submission watermark. | T |

## 8. Non-functional requirements (NF)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R140 | M | Every input field accepting patient identifiers shall validate length and character class. | T |
| TT-R141 | M | The system shall not transmit PHI to any external host unless explicitly enabled in settings. | T,I |
| TT-R142 | M | The system shall log a unique request_id for every IPC call and propagate it into audit and SIEM events. | T |
| TT-R143 | M | The system shall provide an "About" dialog stating the regulatory design alignment (not certification). | I |
