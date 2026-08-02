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

## Waitlist status transitions and CMS IOTA notices

Executed against test patients only. Where a step requires a past date, set the
transition's effective date rather than changing the workstation clock.

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-71 | Change a test patient's waitlist status from Active to Inactive with a reason code. | Transition recorded with prior status, new status, reason, effective timestamp, offer-eligibility impact, and acting user. | | |
| OQ-72 | Attempt `UPDATE waitlist_status_transitions SET reason_code='x'` and `DELETE FROM waitlist_status_transitions` via direct SQL. | Both rejected by database trigger. | | |
| OQ-73 | Inspect the notification created by OQ-71. | Record exists with content hash, generator version, and a due date exactly 10 days after the effective timestamp. | | |
| OQ-74 | Attempt via direct SQL to alter the notification's content hash, due date, notice kind, or idempotency key. | Each rejected by trigger. Repeat for a delivery column; that update succeeds. | | |
| OQ-75 | Re-run notice generation for the same transition without incrementing the revision. | No second notification is created. Then increment the revision and repeat: a new notification is created with key suffix `r1`. | | |
| OQ-76 | Set a notification's due date in the past by recording a transition dated 15 days ago; open the IOTA Notices page. | Obligation is listed as overdue. | | |
| OQ-77 | Attempt to generate a notice for an organisation with no template configured. | Generation is refused; no vendor default language is substituted. | | |
| OQ-78 | Configure a template omitting the reactivation instructions; save. | Rejected at save time, naming the missing element. Repeat with an unknown `{{placeholder}}`: also rejected. | | |
| OQ-79 | Generate a notice twice for the same transition and compare the rendered bodies and content hashes. | Identical. Confirm the notice states that organ offers cannot be received while inactive, in system-supplied wording not present in the configured template. | | |
| OQ-129 | Record an offer-blocking status change. | The transition and its notification obligation are created in the same operation; no transition exists without a tracked deadline. | | |
| OQ-130 | With notice configuration deliberately incomplete, record an offer-blocking status change. | Transition is still recorded; the obligation is reported as unmet rather than discarded. | | |
| OQ-131 | Attempt to save a template missing the hospital contact block. | Rejected at configuration time. | | |
| OQ-132 | Mark a notice delivered within its due date; mark a second notice delivered after its due date. | Channel and timestamp recorded for both; the first reports on time, the second late. Attempt to mark the first delivered again: rejected. | | |
| OQ-133 | Open the IOTA compliance summary. | Counts shown for open, overdue, delivered on time, and delivered late, plus any obligating transition with no notice. | | |
| OQ-134 | Generate a notice for an ESRD test patient with no dialysis facility recorded. | Obligation flagged as incompletely addressed; not presented as discharged. | | |
| OQ-135 | Reprint a delivered notice. | Stored body is reproduced and verifies against its recorded content hash. Alter the stored body via direct SQL and reprint: mismatch is reported. | | |
| OQ-136 | Attempt each IOTA action as `viewer`, `physician`, `coordinator`, and `admin`. | Configuration admin-only; obligation and delivery writes admin and coordinator; read additionally physician and regulator. Every write produces an audit row. | | |

## Chart filing

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-150 | File a delivered notice to the chart. | A FHIR R4 DocumentReference is produced for the patient. Before filing, confirm the compliance summary reports the delivered-but-unfiled notice as partially met. | | |
| OQ-151 | Alter a notice's stored body via direct SQL, then attempt to file it. | Filing refused on content-hash mismatch. | | |
| OQ-152 | File in dry-run mode. | DocumentReference is built, validated and displayed; capture network traffic during the step and confirm no outbound request is made. | | |
| OQ-153 | Inspect the deployed configuration for any setting that enables transmission. | None exists; transmission requires a transport supplied by the caller. Confirm by network capture across a full session of normal use. | | |
| OQ-154 | File to chart with the Epic endpoint unreachable. | Failure recorded with its cause; the obligation remains retryable. Restore the endpoint and retry: succeeds. Attempt to file the same notice again: refused. | | |
| OQ-155 | Record a manual filing for a notice sent via interface engine. | Obligation shows as filed with the manual route recorded. | | |

## Backup and migration safety

Executed on a copy of a populated non-PHI test database.

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-84 | Install a build carrying a pending migration and start it. | A verified pre-migration copy is written before the migration runs. Restart with no migrations pending: no new copy is taken. | | |
| OQ-85 | Make the backup directory read-only, then start a build carrying a pending migration. | Startup refuses to migrate; the database is left at its previous schema version and opens normally once the build is reverted. | | |
| OQ-86 | Introduce a deliberately failing migration in a test build and start it. | The reported error names the schema version reached and the full path of the pre-migration copy. Restore from that path and confirm the database opens. | | |
| OQ-87 | Apply six successive migrations. | At most five pre-migration copies are retained; older ones are removed via secure delete. | | |

## System health and support bundles

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| OQ-124 | Open System Health as an administrator. | Per-component status, overall status, and current schema version are shown. | | |
| OQ-125 | Export a support bundle. | A single file is produced containing health status, schema version, aggregate record counts, backup history, and recent log activity. | | |
| OQ-126 | Enter a recognisable test-patient name into a free-text note and trigger a log entry containing it; export a default bundle and search the file for that name, an MRN, a date of birth, and an e-mail address. | None appear. Free-text values are present as `[FREE_TEXT_OMITTED]` with a length hint rather than filtered text. | | |
| OQ-127 | Export a bundle with free text explicitly included. | The bundle records that choice in its `redactionPolicy`, is labelled as requiring PHI handling, and does not claim to be PHI-free. | | |
| OQ-128 | Attempt bundle export as a non-administrator; then export as an administrator. | Non-admin refused. Admin export produces an audit row recording the export and whether free text was included. | | |

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
| OQ-144 | Review the release evidence for the build under test: the dependency audit output and the exception file. | Every finding is either resolved or covered by an unexpired documented exception. Confirm by back-dating one exception's review date in a scratch copy that the gate then fails. | | |
| OQ-145 | Confirm the installed application's version matches the version in the release record; exercise each administrative screen including Disaster Recovery and System Health. | Versions match; every control performs its action rather than failing at the bridge. | | |
| OQ-146 | Review the release build log for the artifact under test. | The signing and notarization steps report success. Confirm the control is real by inspecting the vendor's evidence that a build with a deliberately removed signing credential failed rather than producing an unsigned artifact. | | |
| OQ-147 | On the installation host, run `Get-AuthenticodeSignature` against the received installer before installing it. | `Status` is `Valid`, `SignatureType` is `Authenticode` (not `Catalog`), and the signer certificate subject matches the vendor named in the purchase agreement. | | |

## Acceptance

100% of OQ test cases marked Mandatory must pass. Failures are recorded as
defects in the customer's defect tracker and resolved before VSR sign-off.

| Role | Signature | Date |
|---|---|---|
| Executor | | |
| Reviewer | | |
