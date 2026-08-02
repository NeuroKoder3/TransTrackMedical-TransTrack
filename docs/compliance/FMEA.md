# Failure Mode and Effects Analysis

| Document ID | TT-FMEA-001 |
| --- | --- |
| Version | 1.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Engineering Lead |
| Reviewed by | Quality Assurance Officer, Information Security Officer, Clinical Informatics Lead |
| Review cadence | Every minor release, and on any Severity 1 or 2 field incident |

## 1. Purpose and relationship to the risk register

Validation finding I-6 recorded that no FMEA existed. This document is that
analysis.

[`RISK_REGISTER.md`](RISK_REGISTER.md) is an ISO 14971 hazard register: it asks
"what could harm a patient or expose PHI, and what reduces it?" and scores
severity against likelihood. An FMEA asks a narrower and more mechanical
question: **for each way a specific component can fail, what is the effect,
how likely is that failure, and would we notice?** The third axis —
detectability — is the one the risk register does not carry, and it is the axis
on which several of this system's real exposures sit. A failure that is
severe, rare, and *undetectable* scores worse here than one that is severe,
common, and caught by a build gate.

The two documents are cross-referenced. Every failure mode below names its
risk-register hazard where one exists, and its residual-risk entry in
[`RESIDUAL_RISK.md`](RESIDUAL_RISK.md) where the residue is formally accepted.

Failure modes were derived from the implemented system: the fail-closed paths
in the audit writer, encryption verification and clinical validation; the
authorisation boundaries at IPC, REST, FHIR and HL7; the externally owned
reference data; the migration and backup paths; and the release pipeline.
They are not hypothetical categories.

## 2. Scales

Severity, occurrence and detection are each scored 1–10, following the
conventional FMEA convention that **higher is worse on all three axes**
(including detection, where 10 means "would not be detected").

### Severity (S) — effect if the failure occurs

| S | Effect |
| --- | --- |
| 9–10 | Patient harm, or PHI breach affecting many individuals |
| 7–8 | Material PHI exposure, loss of a regulatory record, or loss of the ability to demonstrate compliance |
| 4–6 | Limited PHI exposure, incorrect operational information presented to a user, or significant operational disruption |
| 1–3 | No PHI exposure; minor disruption or inconvenience |

### Occurrence (O) — likelihood, **with the existing control in place**

| O | Likelihood |
| --- | --- |
| 9–10 | Expected in normal operation |
| 7–8 | Likely at least annually across the installed base |
| 4–6 | Plausible; depends on site configuration or human action |
| 2–3 | Requires a defect plus an unusual condition |
| 1 | Structurally prevented; would require a control to be removed |

### Detection (D) — would we find out?

| D | Detectability |
| --- | --- |
| 1–2 | Automatically detected and the system fails closed, or a build/startup gate blocks it |
| 3–4 | Detected by an automated check, an audit review, or a health check within a normal cycle |
| 5–6 | Detected only if someone looks — reconciliation, manual review, or a user noticing |
| 7–8 | Detected only after the consequence, or only by an external party |
| 9–10 | Not detectable by the system or its operators |

### Risk Priority Number

`RPN = S × O × D`. Two action thresholds apply, and the **more demanding one
governs**:

| Condition | Requirement |
| --- | --- |
| RPN ≥ 100 | A named action with an owner and a closure criterion is mandatory. |
| S ≥ 9, any RPN | The mode is reviewed every release regardless of RPN, because the scale compresses catastrophic outcomes. |
| RPN < 100 and S ≤ 8 | Existing control accepted; monitored at the review cadence. |

Scores are assessed **with the existing control in place**. Where the control
is the reason occurrence is 1 or 2, that is stated in the control column — the
score is not evidence that the control is unnecessary.

## 3. Analysis

| ID | Failure mode | Cause | Effect | S | O | D | RPN | Existing control | Register | Action |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| FM-01 | Audit hash chain is broken; a row's `prev_hash` does not match its predecessor | Direct database manipulation; partial write; a second writer bypassing the chained path | Tamper-evidence is lost for the affected span; the audit trail cannot be attested to a regulator | 7 | 2 | 2 | 28 | Single fail-closed chained audit writer (H-11); chain verified at startup; unhashed rows are flagged rather than skipped; keyed HMAC in OS secure storage; DB triggers block UPDATE/DELETE | R-003 | Accepted |
| FM-02 | An operation completes but its audit row is not written | Audit writer throws and the caller swallows it; a write path added without the shared logger | A regulated action exists with no record; §11.10(e) not met for that action | 8 | 1 | 3 | 24 | The audit writer fails closed — the operation is refused rather than proceeding unlogged (H-11); `tests/auditFailClosed.test.cjs` (13 assertions) | R-003 | Accepted |
| FM-03 | Encryption verification reports success on a database that is not encrypted | Verification checks a pragma response rather than the file; verification skipped in packaged builds | PHI at rest in plaintext while the system reports it as encrypted — the worst kind of failure, because it is silent and reassuring | 9 | 2 | 2 | 36 | Verification reads the file header and fails closed in packaged builds (H-2); `tests/encryptionVerification.test.cjs` (13 assertions); IQ-08 confirms the file is not readable as plain SQLite | R-004 | Reviewed every release (S≥9) |
| FM-04 | SMART patient-compartment isolation is bypassed; a token scoped to one patient reads another | Authorisation enforced at the route rather than the storage layer; a new resource type added without a compartment rule | Cross-patient PHI disclosure through the FHIR API | 9 | 2 | 2 | 36 | Compartment enforced at the storage layer, not per route (C-1): `server/src/fhir/compartment.js`, `storage.js`; 29 regression assertions in `server/test/unit/patientCompartment.test.mjs` | R-014 | Reviewed every release (S≥9) |
| FM-05 | Cross-tenant read or write; one organisation's data is returned to another | A query omits `org_id`; a UNIQUE constraint omits `org_id`; RLS policy absent on a new table | Cross-tenant PHI disclosure | 9 | 2 | 3 | 54 | `org_id` scoping on every query; UNIQUE constraints include `org_id`; RLS on `hl7_dead_letters`, `hl7_sending_apps`, `issued_licenses` (H-3); `tests/cross-org-access.test.cjs` (13), `server/test/unit/authTenancy.test.mjs` (12) | R-014 | Reviewed every release (S≥9); see FM-29 |
| FM-06 | A calculator returns a score computed from a superseded OPTN reference table | An OPTN annual refresh is published and the shipped table is not updated | A KDPI or EPTS percentile diverges from the authoritative value without the user knowing | 5 | 4 | 1 | 20 | `reviewBy` on every externally owned table; past it, results are flagged `stale` with an overdue day count, the health check degrades, and the build fails (H-10) | R-007 | Accepted; RR-16 |
| FM-07 | A calculator returns a score computed from an unverified constant | A coefficient is transcribed from a secondary source rather than the controlled document | A clinically plausible but wrong score, presented with the authority of a published instrument | 8 | 1 | 2 | 16 | No unsourced clinical constant may exist (C-3); every constant traced in [`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md); where the source is unobtainable the calculator returns no score (PELD); `tests/calculatorReferenceVectors.test.cjs` asserts against the source, not the implementation | R-007 | Accepted; RR-01 |
| FM-08 | An HL7 dead letter is replayed into the wrong tenant | Replay keyed on message identity rather than on the receiving tenant; an operator replays from a shared queue | PHI from organisation A written into organisation B's records | 8 | 3 | 4 | 96 | Cross-tenant dead-letter replay is refused (H-3); RLS on `hl7_dead_letters`; `server/test/unit/hl7Tenancy.test.mjs` (18 assertions); MRN + DOB matching with an admin-review queue for ambiguous matches | R-008 | Accepted; contingent on FM-29 |
| FM-09 | A migration sequence fails after an earlier migration has already committed | A defect in a later migration; disk full; process killed mid-sequence | Database left at an intermediate schema version that no release expects | 7 | 3 | 2 | 42 | A verified pre-migration copy is written before any pending migration runs, and migration is **refused** if that copy cannot be written; the failure reports the schema version reached and the copy's path; `tests/migrationSafety.test.cjs` (20 assertions) | R-013 | Accepted |
| FM-10 | The SQLCipher key is lost or destroyed | Keychain reset; host reimaged without key export; backup key file deleted with the host | The database and every backup made with that key are permanently unreadable | 8 | 3 | 1 | 24 | Key held in OS secure storage with a 0o600 file fallback; backup key file; rotation history retained; admin warned during rotation; `docs/ENCRYPTION_KEY_MANAGEMENT.md`; DR Scenario 3 | R-005 | Accepted |
| FM-11 | PHI is written to a log file, a support bundle, or an enabled remote sink | A new call site logs a patient object; a support bundle includes free text | PHI leaves the safeguarded environment through a channel nobody treated as a disclosure | 7 | 2 | 4 | 56 | Redaction applied at the sink, not per call site, and fail-safe — if redaction throws, the content is dropped (H-5); remote payload restricted to an allowlist of five meta keys; support bundles withhold free text by default; `tests/loggerRedaction.test.cjs`, `tests/phiLeakage.test.cjs`, `tests/siemRedaction.test.cjs`, `tests/supportBundle.test.cjs` (40) | R-009, R-023 | Accepted; RR-12 |
| FM-12 | Multi-pass overwrite does not erase the data | SSD wear levelling; copy-on-write filesystem; volume snapshot or replica | PHI recoverable from the host after the application believes it has been destroyed | 7 | 6 | 8 | **336** | Three-pass overwrite plus rename before unlink; `PRAGMA secure_delete = ON`; the limitation is documented in the module and the README | — | **A-01** |
| FM-13 | An unsigned or tampered installer is accepted at a site as authentic | Signing credential missing in CI; a build warns and continues; the gate checks a filename rather than the artefact | Malicious or altered software installed under the vendor's name | 8 | 2 | 3 | 48 | A distribution build fails rather than emitting an unsigned artefact and names the missing credential; the gate reads the artefact's Attribute Certificate Table; catalog-only signatures rejected; `tests/signWin.test.cjs` (26), `tests/notarize.test.cjs` (12), `tests/artifactSignature.test.mjs` (14) | R-028 | Accepted; RR-10 |
| FM-14 | A feature works in development and is unwired in the packaged build | The preload surface and the renderer call site drift apart; a build artefact overwrites the source entry | A control fails in front of a clinician, at the moment it is needed | 5 | 3 | 3 | 45 | Every `api.<namespace>.<method>()` call in the renderer is checked against the real preload surface; the source entry point is guarded; the release gate compares installer version to source version; `tests/rendererBridgeCoverage.test.mjs`, `tests/buildEntryIntegrity.test.mjs` | R-027 | Accepted |
| FM-15 | A statutory IOTA notification deadline passes without a notice | The obligation is created separately from the transition and is forgotten; the due date is derived from generation time rather than effective time | A patient is unaware they cannot receive organ offers; a statutory obligation is breached | 7 | 3 | 2 | 42 | The obligation is created in the same operation as the transition; the due date derives from the transition's effective timestamp; overdue obligations surface on the compliance summary; incomplete configuration reports the obligation as unmet rather than discarding it; `tests/iotaNoticeService.test.cjs` (25) | R-020 | Accepted |
| FM-16 | A notice is filed into the wrong patient's chart | Subject derived from UI selection state; stored body altered after generation | PHI disclosed into another patient's permanent record | 9 | 2 | 3 | 54 | The DocumentReference subject derives from the notification's own patient reference; filing re-verifies the body against its recorded content hash; dry-run mode allows inspection before any live filing; `tests/chartFiling.test.cjs` (15) | R-022 | Reviewed every release (S≥9) |
| FM-17 | A bulk patient list or filter returns PHI with no recorded justification | A list endpoint added without the justification gate | Wholesale PHI access with no minimum-necessary record | 6 | 3 | 2 | 36 | Bulk list and filter require a PHI justification grant (H-1); `tests/phiListJustification.test.cjs` (8), `tests/phiJustification.test.cjs` (8), `tests/rbacMatrix.test.cjs` (30) | R-011 | Accepted |
| FM-18 | A natively issued JWT bypasses FHIR authorisation | Two token issuers, only one of which the FHIR authoriser understands | Full FHIR read across the tenant with a token that was never scoped for it | 9 | 2 | 3 | 54 | Native JWTs no longer bypass FHIR authorisation (M-9); `server/test/unit/jwt.test.mjs`, `smartAuthz.test.mjs` (14), `smartScopes.test.mjs` (24) | R-014 | Reviewed every release (S≥9) |
| FM-19 | The MLLP listener is exhausted or reachable from the network | No frame size cap; no idle timeout; no connection cap; listener bound to 0.0.0.0 | Denial of the HL7 ingest path, or an unauthenticated network peer feeding messages | 6 | 3 | 3 | 54 | Frame cap, idle timeout and connection cap; the listener binds 127.0.0.1 by default (H-9); `server/test/unit/mllp.test.mjs` (14), `tlsFailClosed.test.mjs` (11) | R-010 | Accepted |
| FM-20 | Clinical validation is bypassed on one ingest path | Validation implemented per entry point; a new path added without it | Out-of-range or malformed clinical values persisted, and later scored | 7 | 2 | 3 | 42 | Validation enforced at IPC, REST, FHIR import, FHIR webhook and HL7 ingest (C-4); `tests/clinicalValidation.test.cjs` (17), `server/test/unit/inputSchemas.test.mjs` (36) | R-007 | Accepted |
| FM-21 | A restore fails at the moment it is needed | Backup never verified; media unreadable; version skew; the operator has not performed the procedure before | Data loss up to the last good backup, and an RTO breach during an actual incident | 8 | 4 | 7 | **224** | Backups produced through the SQLCipher backup API; weekly integrity verification; `tests/restoreDatabase.test.cjs` (7); documented restore procedure | R-012 | **A-02** |
| FM-22 | A known-vulnerable dependency ships in a release | A finding is suppressed by lowering the audit threshold; an exception is inherited silently | An exploitable component in a product handling PHI | 6 | 4 | 3 | 72 | Audit gate subtracts only reviewed, unexpired, advisory-specific exceptions; the gate fails on an undocumented finding, a severity increase, or a stale exception; `tests/auditExceptions.test.mjs` (14) | R-010, R-026 | Accepted |
| FM-23 | An authenticated session persists on an unattended workstation | Idle timeout too long or disabled; the OS locks but the application does not | An unauthorised person operates the application as the signed-in clinician | 6 | 4 | 4 | 96 | Configurable idle timeout (default 15 minutes); immediate session end on OS screen lock or suspend; session bound to the WebContents ID; `tests/screenLock.test.cjs` (21), `tests/sessionFailClosed.test.cjs` (7) | R-001 | Accepted |
| FM-24 | An audit row is missing from, or reordered within, an organisation's sequence | Concurrent writers; a clock adjustment reorders timestamp-ordered reads | A gap in the record that cannot be distinguished from a deletion | 6 | 2 | 2 | 24 | Monotonic per-organisation sequence on the audit trail (M-6); chain verification at startup; `tests/auditChain.test.cjs` (10), `tests/auditHmac.test.cjs` (14) | R-003 | Accepted |
| FM-25 | An electronic signature record no longer verifies against its payload | The signed entity is altered after signing; a signature field is edited directly | A signed regulated record whose signature is meaningless | 6 | 2 | 3 | 36 | The signature binds identity, meaning, entity, payload hash and timestamp; `verifySignature()` recomputes and reports mismatch; signing is audit-logged in the immutable chain | R-003 | Accepted; RR-13 |
| FM-26 | A user reads the Lung Triage Index as the OPTN Lung Allocation Score | Long-standing familiarity with "LAS"; a lung score in a transplant product invites the assumption | A worklist ordering is believed to reflect national allocation priority when it reflects nothing of the kind | 7 | 4 | 6 | **168** | Renamed to the TransTrack Lung Triage Index; `isPublishedInstrument: false` on every result; SRC-INTERNAL-TTLI states the prohibited uses; the real LAS is stored, not computed (C-3) | R-006, R-007 | **A-03** |
| FM-27 | Inactivation probabilities are relied upon as validated predictions | The output is a percentage with a time horizon, which reads as a calibrated forecast | Staffing, outreach or patient communication decisions made on numbers with no empirical basis at that centre | 6 | 5 | 6 | **180** | SRC-INTERNAL-IRE states the derivation and that the instrument is not clinically validated; per-factor decomposition is exposed; counterfactuals are expressed as score deltas, not outcome deltas | R-006 | **A-04** |
| FM-28 | A CDS Hooks invocation persists PHI outside the safeguarded store | The full request context is logged for debugging | PHI in an invocation log that is not treated as a PHI store | 7 | 2 | 3 | 42 | A PHI-free invocation summary is stored rather than the request (H-12); `server/test/unit/cdsAudit.test.mjs` (15) | R-009 | Accepted |
| FM-29 | RLS policies are present but inert because the connecting role bypasses them | The application connects as the table owner, a superuser, or a `BYPASSRLS` role; `FORCE ROW LEVEL SECURITY` not set | The defence-in-depth layer H-3 was raised to add is absent, and nothing reports its absence | 9 | 3 | 7 | **189** | Policies present in DDL and asserted by unit suites; application-level `org_id` scoping applies independently | R-014 | **A-05** |
| FM-30 | The system is placed into clinical use without site Performance Qualification | The vendor package is mistaken for a complete validation; PQ is deferred and never scheduled | Unfit-for-purpose deployment, and an incomplete validation package at the first audit | 7 | 5 | 5 | **175** | The VSR states on its first page which stages are complete and which are not; the Validation Plan's acceptance criteria require PQ; the PQ protocol is issued ready to execute | — | **A-06** |

## 4. Actions

Every failure mode with RPN ≥ 100 carries an action below. Each names an
owner role, a closure criterion, and the RPN the action is expected to
achieve. No action is considered complete until its closure criterion is
evidenced.

### A-01 — Residual data on modern storage (FM-12, RPN 336)

The dominant term is detection (8): the application cannot observe that its
overwrite did not reach the physical media, and neither can the operator
without forensic tooling. Occurrence (6) is high because SSDs and
copy-on-write filesystems are the normal case, not the exception.

No application-layer change reduces either term. The action is therefore to
move the control to the layer that can hold it and to stop implying otherwise:

1. Full-disk encryption is a **Mandatory** IQ line item, evidenced per host,
   not a recommendation (Information Security Officer, at each site IQ).
2. `README.md` describes multi-pass overwrite as a defence-in-depth measure
   with its documented limits, not as a guarantee — closing the contradiction
   between the README and `secureDelete.cjs` (finding L-6). **Done in 1.3.0.**
3. Host decommissioning follows cryptographic erase or physical destruction per
   NIST SP 800-88, and volume snapshots containing the application data
   directory are inventoried and retained on the same schedule as the database
   (Information Security Officer, per site).

With full-disk encryption evidenced, severity of the residue falls to 3 and the
RPN to 144 at the storage layer, with the residual accepted as
[RR-08](RESIDUAL_RISK.md#rr-08--secure-delete-cannot-guarantee-erasure-on-modern-storage).
Detection cannot be improved and the entry is not expected to close.

### A-02 — Untested restore procedure (FM-21, RPN 224)

Detection is 7 because a backup that cannot be restored looks exactly like a
backup that can, right up until the moment it is needed. Occurrence is 4
because no drill has been executed for this release (finding I-5).

1. Execute a file-restore drill on a non-production host using the drill
   procedure and log template in
   [`RUNBOOK.md`](../../RUNBOOK.md#5-disaster-recovery-drill)
   (System Administrator, before production use).
2. Record measured recovery time and recovery point against the objectives in
   [`policies/BUSINESS_CONTINUITY_AND_DR.md`](policies/BUSINESS_CONTINUITY_AND_DR.md)
   §1, which is the single normative source for both, reproduced procedurally
   in `docs/DISASTER_RECOVERY.md` (Information Security Officer).
3. Establish the quarterly cadence required by the BCDR policy, with the drill
   record filed in document control (Information Security Officer).

One executed drill moves detection to 3 and the RPN to 96. Tracked as
[RR-11](RESIDUAL_RISK.md#rr-11--no-disaster-recovery-drill-has-been-executed-for-this-release).

### A-03 — Misreading the Lung Triage Index (FM-26, RPN 168)

The rename and the `isPublishedInstrument: false` flag address the product
surface. They do not address a user who does not read flags, which is why
detection remains 6: nothing in the system observes that a user has drawn the
wrong conclusion.

1. The distinction is stated in the README calculator list and in
   SRC-INTERNAL-TTLI. **Done in 1.3.0.**
2. The distinction is a **Mandatory** item in site training, recorded as a PQ
   deliverable, with the training record naming the instrument by its full
   name (Transplant Administrator, per site).
3. Where a centre holds a real LAS or CAS from UNet, it is entered into
   `patient.las_score`, and the site's PQ confirms both values are visible
   without ambiguity (Clinical Informatics Lead + site).

With training evidenced, occurrence falls to 2 and the RPN to 84. Tracked as
[RR-07](RESIDUAL_RISK.md#rr-07--the-lung-triage-index-is-an-internal-instrument).

### A-04 — Over-reliance on uncalibrated probabilities (FM-27, RPN 180)

A number rendered as "68% within 60 days" carries an implied calibration it
does not have. Occurrence is 5 because reliance is the expected use of a
probability, not a misuse of it.

1. Sites run the engine in shadow mode and collect at least four quarters of
   observed inactivation outcomes (Transplant Administrator, per site).
2. Predicted-against-observed calibration is computed by decile and recorded
   in the site's PQ report (Clinical Informatics Lead + site).
3. Weights and curves are re-derived or explicitly accepted, and the decision
   is recorded in the site's configuration change log (site QA).
4. Until step 3 completes at a site, the probabilities are treated at that
   site as an internal ranking signal only.

Site recalibration moves severity to 4 and occurrence to 2, RPN 48. Tracked as
[RR-02](RESIDUAL_RISK.md#rr-02--the-inactivation-risk-engine-is-not-clinically-validated).

### A-05 — RLS inert under a bypassing role (FM-29, RPN 189)

This is the highest-severity mode in the analysis that is also poorly
detected. A `BYPASSRLS` connection produces no error, no warning, and no
behavioural difference until the day it matters. It cannot be evidenced in
the vendor environment, which has no PostgreSQL server (finding C-2 scope).

1. The vendor stands up PostgreSQL 16 in CI and runs
   `server/test/integration/*` on every release (Engineering Lead).
2. A negative test is added and executed: a query issued for tenant A against
   a row belonging to tenant B returns no rows, both with the tenant GUC set
   and with it unset (Engineering Lead).
3. Sites evidence that the application's database role is not a superuser,
   does not hold `BYPASSRLS`, and is not the owner of the RLS-protected tables
   — or that `FORCE ROW LEVEL SECURITY` is set (site IT / Security, at IQ).
4. `docs/server/deployment.md` states the required role configuration as a
   deployment precondition.

Steps 1–3 move detection to 2 and the RPN to 54. Tracked as
[RR-04](RESIDUAL_RISK.md#rr-04--rls-is-not-verified-against-a-live-postgresql-instance).

### A-06 — Deployment without site Performance Qualification (FM-30, RPN 175)

The vendor cannot execute PQ (see
[RR-05](RESIDUAL_RISK.md#rr-05--performance-qualification-has-not-been-executed)).
The action available to the vendor is to make the gap impossible to overlook,
and to hand the site a protocol it can execute rather than a template it must
author.

1. The Validation Summary Report states, on its first page, that vendor
   software verification is complete and site qualification is not.
   **Done in 1.3.0.**
2. The PQ protocol is issued as a ready-to-execute document with
   pre-conditions, scenarios, acceptance criteria and a signature block —
   marked NOT EXECUTED by the vendor rather than left blank. **Done in 1.3.0.**
3. The Validation Plan's acceptance criteria state that a release is validated
   for production use only when PQ has been executed and the site VSR is
   signed. **Done in 1.3.0.**
4. Sites execute `executed/PQ_TT-PQ-001.md` before production use (site QA).

Steps 1–3 move detection to 2, RPN 70. Step 4 closes the mode per deployment.

## 5. Distribution of scores

| Band | Count | Failure modes |
| --- | ---: | --- |
| RPN ≥ 200 | 2 | FM-12, FM-21 |
| RPN 100–199 | 4 | FM-26, FM-27, FM-29, FM-30 |
| RPN 50–99 | 8 | FM-05, FM-08, FM-11, FM-16, FM-18, FM-19, FM-22, FM-23 |
| RPN < 50 | 16 | FM-01, FM-02, FM-03, FM-04, FM-06, FM-07, FM-09, FM-10, FM-13, FM-14, FM-15, FM-17, FM-20, FM-24, FM-25, FM-28 |

Two observations are worth recording, because they are what the analysis was
for.

**The highest RPNs are not the highest severities.** FM-03, FM-04, FM-16 and
FM-18 all score severity 9 and sit below RPN 60, because each is caught by a
fail-closed control or an automated gate. The modes that rise to the top —
FM-12, FM-21, FM-26, FM-27, FM-29 — are those whose detection score is 6 or
worse. Four of the five are detectable only by a party outside the software:
an operator running a drill, a trainer confirming understanding, a database
administrator inspecting a role grant, a centre comparing predictions to
outcomes.

**Every action above RPN 100 requires something the vendor cannot do alone.**
That is not an evasion; it is the shape of the residual risk in a product that
runs on someone else's hosts, against someone else's database, for someone
else's clinicians. It is also why
[`RESIDUAL_RISK.md`](RESIDUAL_RISK.md) assigns a closure owner to every entry
rather than leaving the reader to infer one.

## 6. Approval

| Role | Responsibility | Signature | Date |
| --- | --- | --- | --- |
| Engineering Lead | Owns the analysis; confirms each failure mode reflects the implemented system | _pending site execution_ | _pending site execution_ |
| Quality Assurance Officer | Confirms scales, thresholds and action closure criteria | _pending site execution_ | _pending site execution_ |
| Information Security Officer | Confirms FM-11, FM-12, FM-21, FM-23, FM-29 | _pending site execution_ | _pending site execution_ |
| Clinical Informatics Lead | Confirms FM-06, FM-07, FM-26, FM-27 | _pending site execution_ | _pending site execution_ |

## 7. Change history

| Version | Date | Change | Author role |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Initial issue, in response to validation findings I-6 and C-2(d). Failure modes derived from the implemented control set following the C-1, C-3, C-4, H-1 through H-12 and M-6/M-9 remediations. | Engineering Lead |
