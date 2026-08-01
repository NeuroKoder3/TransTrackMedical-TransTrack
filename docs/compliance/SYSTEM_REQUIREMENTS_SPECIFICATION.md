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
| TT-R071 | M | The system shall record every change to a patient's waitlist status as an immutable transition record carrying the prior status, the new status, a reason code, the effective timestamp, the effect on organ-offer eligibility, and the acting user. | T |
| TT-R072 | M | Waitlist status transition records shall be append-only: any UPDATE or DELETE shall be rejected at the database trigger level. | T |
| TT-R073 | M | For a transition that removes organ-offer eligibility, the system shall create a notification record carrying the content hash, the generator version, and a due date 10 days after the effective timestamp, per CMS IOTA Model § 512.442(d). | T |
| TT-R074 | M | Notification records shall permit lifecycle updates (delivery, secondary recipient, chart filing) while rejecting any change to the transition reference, notice kind, content hash, generator version, due date, generation timestamp, or idempotency key. | T |
| TT-R075 | M | The system shall reject a duplicate notification for the same notification obligation (transition, notice kind, and reissue revision), so that a retried generate-or-file cycle cannot produce a second document in the patient chart. Superseding a filed notice shall require an explicit revision increment. | T |
| TT-R076 | M | The system shall identify notification records that are past their due date and not yet delivered. | T |
| TT-R077 | M | Notice content shall be generated from a per-organisation template supplied by the transplant hospital. The system shall not apply vendor-authored notice language implicitly: no template shall be applied unless it has been explicitly configured for the organisation. | T |
| TT-R078 | M | The system shall refuse to render a notice template that omits any of the five content elements required by CMS IOTA Model § 512.442(d) — inactive-since date, reason for the change, statement that organ offers cannot be received while inactive, reactivation instructions, and hospital contact information — or that references an unrecognised placeholder. The statement that organ offers cannot be received shall be system-supplied and shall not be alterable through template configuration. | T |
| TT-R129 | M | Recording a waitlist status transition whose offer-eligibility impact blocks organ offers shall create the corresponding notification obligation in the same operation, so that the duty cannot be created without a tracked deadline. | T |
| TT-R130 | M | Where notice configuration is incomplete, the system shall nevertheless record the status transition and report the notification obligation as unmet. The transition record establishes when the statutory clock started and shall never be discarded because a notice could not be produced. | T |
| TT-R131 | M | The system shall reject a notice template at configuration time if it omits a required content element, so that the defect is surfaced when it can be corrected rather than when a patient's notice is due. | T |
| TT-R132 | M | The system shall record delivery of a notice with its channel and timestamp, shall distinguish a notice delivered after its due date from one delivered within it, and shall not permit a delivery already recorded to be silently recorded again. | T |
| TT-R133 | M | The system shall report, per organisation, the count of notification obligations that are open, overdue, delivered on time, and delivered late, together with any obligating transition for which no notice exists. | T |
| TT-R134 | M | Where a notice carries a duty to copy a dialysis facility or referring provider but no recipient is recorded for the patient, the system shall flag the obligation as incompletely addressed rather than presenting it as discharged. | T |
| TT-R135 | M | The rendered notice body shall be retained and shall remain verifiable against its frozen content hash, so that a filed notice can be reproduced for the patient or a surveyor and any post-hoc alteration is detectable. | T |
| TT-R136 | M | All IOTA notification channels shall be scoped to the authenticated user's organisation, restricted by role (configuration to administrators; obligation and delivery writes to administrators and coordinators; read access additionally to physicians and regulators), and every write shall be audit-logged. | T |
| TT-R137 | M | The system shall record a copy of each notice in the patient's medical record via a FHIR R4 DocumentReference, and shall report a notice that has been delivered but not filed as a partially met obligation. | T |
| TT-R138 | M | The system shall refuse to file a notice whose stored body does not match its recorded content hash. | T |
| TT-R139 | M | The system shall support filing in dry-run mode, in which the DocumentReference is constructed and validated but not transmitted, so that readiness can be demonstrated before a site's Epic organisation has enabled document creation. | T |
| TT-R140 | M | The system shall not transmit to an external endpoint unless a transport is explicitly supplied by the caller; no configuration value alone shall enable outbound clinical document transmission. | T |
| TT-R141 | M | A failed chart filing shall be recorded with its cause and shall remain retryable; a notice already filed shall not be filed again. | T |
| TT-R142 | M | The system shall support recording a filing performed by another route (manual or interface engine) so that a site without FHIR write access can evidence a discharged obligation. | T |
| TT-R079 | M | Notice generation shall be deterministic — identical inputs shall yield identical content and content hash — and every derived value shall follow from the patient record rather than the generating environment: the 10-day and annual due dates from the transition's effective timestamp, and the required secondary recipient from the patient's ESRD status (dialysis facility for ESRD, referring provider otherwise), refusing generation when that status is unknown. | T |

## 5. Performance and reliability (PR)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R080 | M | Patient list page shall return ≤2 s for the first 1 000 patients on the reference workstation defined in the IQ. | T |
| TT-R081 | M | The application shall recover gracefully from an unexpected termination with no data loss for committed transactions. | T |
| TT-R082 | M | The application shall create encrypted nightly backups when configured and shall verify backup integrity. | T |
| TT-R083 | M | The application shall support full restore from backup in ≤30 minutes for 100 000 patient records on the reference workstation. | T |
| TT-R084 | M | The application shall create a verified copy of the database immediately before applying any pending schema migration, and shall take that copy only when migrations are pending. | T |
| TT-R085 | M | The application shall refuse to apply schema migrations when the pre-migration copy cannot be written or verified, leaving the database unmodified, so that a failed upgrade is always recoverable. | T |
| TT-R086 | M | When a schema migration fails, the application shall report the schema version reached and the filesystem path of the pre-migration copy, so an operator can restore without having to identify the correct backup. | T |
| TT-R087 | S | Pre-migration copies shall be retained to a bounded count and erased using the secure-delete facility, so that copies of PHI do not accumulate indefinitely. | T |

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
| TT-R124 | M | The system shall provide an administrator-accessible System Health screen presenting per-component health status, overall status, and current database schema version. | T,I |
| TT-R125 | M | The system shall allow an administrator to export a single support bundle containing health status, schema version, aggregate record counts, backup history, and recent log activity. | T |
| TT-R126 | M | A support bundle shall contain no protected health information by default. Free-text values, including log message bodies, shall be withheld rather than filtered, because a patient identifier embedded in prose cannot be reliably detected. | T |
| TT-R127 | M | Inclusion of free-text log content in a support bundle shall require an explicit request, shall be recorded within the bundle itself, and shall cause the bundle to be labelled as requiring PHI handling. | T,I |
| TT-R128 | M | Export of a support bundle shall be restricted to the administrator role and shall be recorded in the audit trail, including whether free text was included. | T |

## 8. Non-functional requirements (NF)

| ID | Pri | Requirement | Verify |
|---|---|---|---|
| TT-R140 | M | Every input field accepting patient identifiers shall validate length and character class. | T |
| TT-R141 | M | The system shall not transmit PHI to any external host unless explicitly enabled in settings. | T,I |
| TT-R142 | M | The system shall log a unique request_id for every IPC call and propagate it into audit and SIEM events. | T |
| TT-R143 | M | The system shall provide an "About" dialog stating the regulatory design alignment (not certification). | I |
