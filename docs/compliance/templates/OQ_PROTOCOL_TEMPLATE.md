# OQ Protocol — TransTrack Operational Qualification

| Document control | |
|---|---|
| Document ID | TT-OQ-_____ |
| Software version | vX.Y.Z |
| Executed by | _____ |
| Reviewed by | _____ |
| Date executed | _____ |

## Purpose

Verify each Mandatory requirement from `SYSTEM_REQUIREMENTS_SPECIFICATION.md`
against the running build. OQ is executed in a **non-PHI** test environment.

> Each "OQ-NN" id below corresponds to a row in `TRACEABILITY_MATRIX.md`.

## Authentication and access control

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-01 | Attempt login with valid credentials. | Login succeeds; session created. | | |
| OQ-02 | Attempt to set password "abc123". | Rejected: complexity not met. | | |
| OQ-03 | Submit 5 invalid passwords for one account. | Account locked for ≥15 min. | | |
| OQ-04 | Enroll TOTP MFA; log out; log in with TOTP. | Login succeeds only with valid TOTP. | | |
| OQ-05 | Use a backup code; verify it cannot be reused. | First use succeeds; second use rejected. | | |
| OQ-06 | Attempt to set a password used in last 12. | Rejected: reuse not allowed. | | |
| OQ-07 | Set password rotation to 1 day; advance system clock 2 days. | User prompted to change password on next login. | | |
| OQ-08 | Leave session idle for >15 min. | Session ends; re-auth required. | | |
| OQ-09 | Attempt admin operation as `viewer` role. | Rejected. | | |

## Auditing

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-20 | Create a patient. | Audit row recorded with action=create, actor, request_id. | | |
| OQ-22 | Attempt `UPDATE audit_logs SET ...` via direct SQL. | Trigger raises `HIPAA Compliance: Audit logs are immutable`. | | |
| OQ-24 | Export patient list to CSV. | Audit row recorded; export file watermarked. | | |
| OQ-25 | Change a user's role. | Audit row recorded. | | |
| OQ-26 | Configure a SIEM destination; perform an action; observe SIEM. | Event appears in SIEM in CEF format. | | |

## Encryption

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-40 | Inspect database file with `sqlite3`. | Encrypted; opaque. | | |
| OQ-41 | Inspect installation directory for cleartext key. | None present. | | |
| OQ-42 | Run encryption key rotation as admin. | Rotation completes; history row recorded. | | |
| OQ-43 | Corrupt the database file 1 byte; restart. | Integrity check fails; user warned; backup-restore prompt shown. | | |
| OQ-44 | Export to PDF. | File header shows producer + timestamp + confidentiality banner. | | |

## Operational features

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-60 | Create patient with all fields. | Stored; retrievable. | | |
| OQ-61 | Calculator: enter MELD inputs; verify formula matches reference. | Matches `tests/calculators.test.cjs`. | | |
| OQ-62 | View Priority Score; confirm "operational not allocative" label. | Label visible. | | |
| OQ-63 | Create barrier; resolve; audit. | Recorded. | | |
| OQ-64 | Create AHHQ; mark complete. | Recorded. | | |
| OQ-65 | Add lab result; verify stored as string. | Yes. | | |
| OQ-66 | Create offer → ACCEPT; create offer → DECLINE with reason; create offer → let expire. | All three transitions recorded with audit. | | |
| OQ-67 | Record transplant event; rejection episode; biopsy; readmission. | All recorded. | | |
| OQ-68 | Create living donor; advance through evaluation steps; auto-tasks for 6/12/24 month follow-ups appear. | Yes. | | |
| OQ-69 | Ingest sample HL7 v2 ADT^A01 message. | Patient created or updated. | | |
| OQ-70 | Generate OPTN-style export. | CSV produced; filename and header carry "DO_NOT_SUBMIT" watermark. | | |

## Reporting

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-120 | Generate HIPAA audit report by user + date range. | Report contains all audit rows in scope. | | |
| OQ-121 | Show migration status. | Lists applied & pending. | | |
| OQ-122 | Show encryption status & rotation history. | Visible. | | |

## Cross-cutting

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-140 | Submit oversized patient identifier. | Rejected with validation error. | | |
| OQ-141 | Capture egress with PCAP for 30 min normal use. | Only whitelisted hosts. | | |
| OQ-142 | Inspect audit log row for `request_id`. | Present and unique. | | |
| OQ-143 | Open About dialog. | Design alignment statement present (not "certified"). | | |

## Acceptance

100% of OQ test cases marked Mandatory must pass. Failures are recorded as
defects in the customer's defect tracker and resolved before VSR sign-off.

| Role | Signature | Date |
|---|---|---|
| Executor | | |
| Reviewer | | |
