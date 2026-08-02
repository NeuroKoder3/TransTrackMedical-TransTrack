# Operational Qualification — Executed Record (Automated Verification)

| Document ID | TT-OQ-001 |
| --- | --- |
| Version | 1.0 |
| Status | **Executed** — automated portion complete; interactive portion NOT EXECUTED |
| Software version | TransTrack 1.3.0 |
| Date executed | 2026-08-02 |
| Executed by role | Engineering Lead |
| Reviewed by role | Quality Assurance Officer |
| Governing plan | [`../VALIDATION_PLAN.md`](../VALIDATION_PLAN.md) v2.0 |
| Related | [`IQ_TT-IQ-001.md`](IQ_TT-IQ-001.md), [`PQ_TT-PQ-001.md`](PQ_TT-PQ-001.md), [`../VALIDATION_SUMMARY_REPORT.md`](../VALIDATION_SUMMARY_REPORT.md) |

> ## What this document is, and what it is not
>
> This is a record of the **automated verification that actually ran** on the
> environment in §2, on the date above. Every case below cites a test file
> that exists in this repository and reports the assertion count that file
> emitted during the run. No case is recorded as passing on the basis of code
> review, inspection, or expected behaviour.
>
> It is **not** a complete Operational Qualification. Automated tests verify
> behaviour at a code boundary. They cannot verify what a clinician sees on a
> screen, what a packet capture shows on a site network, or that a label is
> legible. Those cases are enumerated in §8 as **NOT EXECUTED** and remain the
> deploying organization's obligation, using
> [`../templates/OQ_PROTOCOL_TEMPLATE.md`](../templates/OQ_PROTOCOL_TEMPLATE.md).
>
> Two further scope limits apply and are stated up front rather than buried:
> the **server tier is early access** and only its unit suites ran (§6), and
> **no PostgreSQL server was available**, so the server integration suites and
> live row-level-security enforcement were not exercised at all (§9, D-01).

## 1. Purpose

Verify, by automated execution against the release source tree, that the
control set TransTrack claims in its compliance documentation behaves as
described: that fail-closed paths actually fail closed, that authorisation
boundaries hold, that PHI does not reach the sinks it must not reach, that
clinical constants match their controlled sources, and that the release gates
refuse a non-compliant release.

## 2. Verification environment

| Item | Value |
| --- | --- |
| Operating system | Ubuntu 24.04.4 LTS, kernel 6.12.94, x86_64 |
| Node.js | v22.14.0 |
| npm | 10.9.7 |
| Desktop suites | `node scripts/run-test-suites.cjs core` — the default `npm test` group |
| Server suites | `npx vitest run --config vitest.config.mjs` in `server/` |
| Renderer suites | `npx vitest run` at the repository root |
| PostgreSQL | **Not present.** Server integration suites not run. |
| Electron display session | **Not present.** Playwright end-to-end suite not run. |

## 3. Result summary

| Runner | Files | Assertions / tests | Result |
| --- | ---: | ---: | --- |
| Desktop Node suites (`core` group) | 62 | 1058 recorded across 61 suites; `ehrMigration.test.cjs` reports a single pass without a numeric count | **62/62 suites passed** |
| Server unit suites (Vitest) | 27 | 312 | **27/27 files passed, 312/312 tests passed** |
| Renderer component suites (Vitest) | 17 | 137 | **17/17 files passed, 137/137 tests passed** |
| Static analysis (`eslint . --quiet`) | — | — | **Pass**, no findings |
| Dependency vulnerability gate (`npm run audit`) | — | — | **Pass**, 1 documented unexpired exception |
| Validation package consistency (`scripts/check-compliance-docs.mjs`) | — | — | **Pass** |

No suite failed. No suite was skipped within a group that ran. The three
runners that did **not** run — server integration, Playwright end-to-end, and
the load/performance suite — are recorded as deviations in §9.

## 4. How to read the case table

| Column | Meaning |
| --- | --- |
| ID | `OQ-A##` — automated OQ case. Distinct from the `OQ-##` ids in the site OQ protocol, which are interactive cases. |
| Control verified | The specific behaviour asserted, not the feature area. |
| Req | Requirement id(s) from `SYSTEM_REQUIREMENTS_SPECIFICATION.md`. `—` where the control is a security property with no numbered requirement. |
| Verification artifact | The test file executed. **Every path in this column exists on disk.** |
| Asserts | Assertion count emitted by that file during this run. |
| Result | PASS only where the file exited zero in this run. |

## 5. Desktop application — executed cases

### 5.1 Authentication, session and access control

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A01 | Password complexity, account lockout after 5 failed attempts, session expiration configuration and unique user identification are present and enforced as documented | TT-R001, TT-R002, TT-R003, TT-R008 | `tests/compliance.test.cjs` | 33 | PASS |
| OQ-A02 | Password policy evaluation, priority scoring, donor matching and FHIR validation behave per specification | TT-R002, TT-R062 | `tests/business-logic.test.cjs` | 43 | PASS |
| OQ-A03 | Password history prevents reuse to the configured depth and rotation is enforced | TT-R006, TT-R007 | `tests/passwordHistory.test.cjs` | 7 | PASS |
| OQ-A04 | TOTP enrolment, verification, backup-code single use, regeneration and disable | TT-R004, TT-R005, TT-R025 | `tests/mfa.test.cjs` | 11 | PASS |
| OQ-A05 | A session that cannot be validated is refused rather than allowed to proceed — the session layer fails closed | TT-R001, TT-R008 | `tests/sessionFailClosed.test.cjs` | 7 | PASS |
| OQ-A06 | The session ends immediately on OS screen lock or suspend, not only on idle timeout | TT-R008 | `tests/screenLock.test.cjs` | 21 | PASS |
| OQ-A07 | Role-based access control is enforced per handler across the full role matrix (admin, coordinator, physician, user, viewer, regulator) | TT-R009, TT-R128 | `tests/rbacMatrix.test.cjs` | 30 | PASS |
| OQ-A08 | OIDC desktop SSO: PKCE S256 enforced, state bound to the pending flow, HTTPS-only token requests, local user must be explicitly SSO-enabled | TT-R010 | `tests/oidcDesktop.test.cjs` | 7 | PASS |
| OQ-A09 | Every IPC call is sender-validated before any handler runs | TT-R142 | `tests/ipcSenderValidation.test.cjs` | 17 | PASS |
| OQ-A10 | Every IPC call is argument-validated, including length and character class on identifier fields | TT-R140 | `tests/ipcArgValidation.test.cjs` | 27 | PASS |
| OQ-A11 | Cross-organization data isolation: queries are `org_id`-scoped and injection attempts do not escape the scope | — (risk R-014) | `tests/cross-org-access.test.cjs` | 13 | PASS |
| OQ-A12 | IPC handlers integrate correctly end to end against a real database, with session, RBAC and audit in the path | TT-R001, TT-R009, TT-R020 | `tests/ipc-integration.test.cjs` | 26 | PASS |

### 5.2 Audit trail

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A20 | The SHA-256 audit hash chain links each row to its predecessor, and a monotonic per-organization sequence is maintained | TT-R020, TT-R021 | `tests/auditChain.test.cjs` | 10 | PASS |
| OQ-A21 | The audit writer fails closed: an operation whose audit row cannot be written is refused rather than completed unlogged | TT-R020 | `tests/auditFailClosed.test.cjs` | 13 | PASS |
| OQ-A22 | A keyed HMAC held in OS secure storage provides a second tamper-evidence layer independent of the hash chain | TT-R022 | `tests/auditHmac.test.cjs` | 14 | PASS |
| OQ-A23 | UPDATE and DELETE on `audit_logs` are rejected at the database trigger level, not merely withheld from the API | TT-R022 | `tests/auditImmutability.test.cjs` | 19 | PASS |
| OQ-A24 | Audit HMAC key material is gated: absence or mismatch is surfaced, and rows written without a hash are flagged rather than silently skipped | TT-R022 | `tests/auditKeyGating.test.cjs` | 39 | PASS |
| OQ-A25 | Audit export produces a complete, scoped report with actor, timestamp, action and request id | TT-R024, TT-R120 | `tests/auditExport.test.cjs` | 27 | PASS |
| OQ-A26 | Local file integrity monitoring detects modification of protected application files | TT-R043 | `tests/integrityMonitor.test.cjs` | 19 | PASS |

### 5.3 PHI protection and disclosure control

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A30 | Access to an individual patient's PHI requires a recorded justification | TT-R024 | `tests/phiJustification.test.cjs` | 8 | PASS |
| OQ-A31 | Bulk patient list and filter operations require a PHI justification grant — the control added by finding H-1 | TT-R024 | `tests/phiListJustification.test.cjs` | 8 | PASS |
| OQ-A32 | PHI does not leak into the surfaces that carry data off-box, tested adversarially against deliberately PHI-laden input | TT-R126, TT-R141 | `tests/phiLeakage.test.cjs` | 10 | PASS |
| OQ-A33 | The logger redacts PHI at the sink rather than per call site, and no sink is bypassed — including the optional remote sink | TT-R141 | `tests/loggerRedaction.test.cjs` | 9 | PASS |
| OQ-A34 | SIEM events carry identifiers and categorical metadata only; PHI is stripped before emission | TT-R026 | `tests/siemRedaction.test.cjs` | 8 | PASS |
| OQ-A35 | SIEM forwarder formatters (CEF, RFC 5424, JSON) and destination management behave as specified | TT-R026 | `tests/siemForwarder.test.cjs` | 15 | PASS |
| OQ-A36 | Support bundles withhold free text rather than filtering it, redact structured PHI by key and by pattern, record the redaction policy, and are admin-only and audit-logged | TT-R125, TT-R126, TT-R127, TT-R128 | `tests/supportBundle.test.cjs` | 40 | PASS |
| OQ-A37 | Multi-pass overwrite is applied before unlink, with rename, for files that held PHI | TT-R087 | `tests/secureDelete.test.cjs` | 21 | PASS |
| OQ-A38 | Application secrets are encrypted at rest and are not recoverable from the settings store in cleartext | TT-R041 | `tests/secretEncryption.test.cjs` | 10 | PASS |

> OQ-A37 verifies that the overwrite is performed. It does **not** verify that
> the bytes are unrecoverable from the physical media, which no test at this
> layer can establish. See [RR-08](../RESIDUAL_RISK.md#rr-08--secure-delete-cannot-guarantee-erasure-on-modern-storage)
> and FMEA action A-01.

### 5.4 Encryption, backup, restore and migration

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A40 | Database encryption verification is real — it inspects the artifact rather than trusting configuration — and fails closed in packaged builds (finding H-2) | TT-R040, TT-R041, TT-R043 | `tests/encryptionVerification.test.cjs` | 13 | PASS |
| OQ-A41 | Restore from an encrypted backup reconstitutes the database and rejects a backup that does not verify | TT-R082, TT-R083 | `tests/restoreDatabase.test.cjs` | 7 | PASS |
| OQ-A42 | A verified pre-migration copy is written before any pending migration; migration is refused if the copy cannot be written; a failure reports the version reached and the copy's path; retained copies are bounded and securely erased | TT-R084, TT-R085, TT-R086, TT-R087 | `tests/migrationSafety.test.cjs` | 20 | PASS |
| OQ-A43 | An EHR-import migration repair path completes without data loss | TT-R100 | `tests/ehrMigration.test.cjs` | see note | PASS |
| OQ-A44 | Health check reports per-component status, overall status and current schema version, and degrades when reference data is stale | TT-R124 | `tests/healthCheck.test.cjs` | 6 | PASS |

Note on OQ-A43: `ehrMigration.test.cjs` reports a single terminal pass line
("EHR migration repair test passed") rather than a numeric assertion count.
The suite exited zero. Its count is excluded from the 1058 total in §3 rather
than estimated.

### 5.5 Clinical calculators and clinical data validation

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A50 | MELD, MELD-Na, MELD 3.0, KDPI/KDRI and EPTS compute correctly, and no score is produced when a required input is absent | TT-R061 | `tests/calculators.test.cjs` | 29 | PASS |
| OQ-A51 | Every clinical constant is asserted **against its controlled source**, not against the implementation: MELD/MELD-Na/MELD 3.0 blocks including the adolescent variant, the KDRI xβ = 0 reference donor and each coefficient in isolation, and the EPTS block. The suite also fails the build if any reference table is past its `reviewBy` date | TT-R061 | `tests/calculatorReferenceVectors.test.cjs` | 35 | PASS |
| OQ-A52 | Clinical validation is enforced at every ingest boundary — IPC, REST, FHIR import, FHIR webhook and HL7 ingest — so that no path admits out-of-range clinical values (finding C-4) | TT-R100, TT-R101, TT-R140 | `tests/clinicalValidation.test.cjs` | 17 | PASS |
| OQ-A53 | The inactivation risk engine scores deterministically, decomposes additively per factor, and simulates counterfactual interventions as score deltas | TT-R062 | `tests/inactivationRiskEngine.test.cjs` | 37 | PASS |
| OQ-A54 | Inactivation action queue ordering and lifecycle | TT-R062, TT-R063 | `tests/inactivationActionQueue.test.cjs` | 20 | PASS |
| OQ-A55 | Inactivation alert rule evaluation and thresholds | TT-R062 | `tests/inactivationAlertRules.test.cjs` | 18 | PASS |
| OQ-A56 | Prevention outcome recording and attribution | TT-R063 | `tests/preventionOutcomes.test.cjs` | 12 | PASS |
| OQ-A57 | Prevention digest composition | TT-R063 | `tests/preventionDigest.test.cjs` | 5 | PASS |

> **PELD is not covered by an executed case, because PELD is not computed.**
> `optn-peld.json` carries status `AWAITING_CONTROLLED_SOURCE` and the
> calculator returns `REFERENCE_DATA_UNAVAILABLE`. OQ-A51 asserts that no PELD
> value is produced while the table is unpopulated. See
> [RR-01](../RESIDUAL_RISK.md#rr-01--peld-is-not-computed).
>
> **The lung instrument covered by OQ-A50 is the TransTrack Lung Triage Index
> (TTLI), not the OPTN Lung Allocation Score.** It carries
> `isPublishedInstrument: false` and has no external source to verify against.
> See [RR-07](../RESIDUAL_RISK.md#rr-07--the-lung-triage-index-is-an-internal-instrument).

### 5.6 Clinical and operational workflows

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A60 | Enterprise services: readiness barriers, aHHQ tracking, labs, audit helper | TT-R063, TT-R064, TT-R065, TT-R020 | `tests/services.test.cjs` | 39 | PASS |
| OQ-A61 | Organ offer state machine, decline-reason codes, response timers and expiry | TT-R066 | `tests/organOffers.test.cjs` | 9 | PASS |
| OQ-A62 | Post-transplant follow-up: events, immunosuppression, rejection episodes, biopsies, readmissions | TT-R067 | `tests/postTransplant.test.cjs` | 5 | PASS |
| OQ-A63 | Living donor record set, status state machine and OPTN Policy 14-aligned 6/12/24-month follow-up generation | TT-R068 | `tests/livingDonors.test.cjs` | 9 | PASS |
| OQ-A64 | HL7 v2 parsing for ADT A01/A03/A04/A08 and ORU R01, with ACK generation | TT-R069 | `tests/hl7v2.test.cjs` | 9 | PASS |
| OQ-A65 | HL7 ingestion maps messages to internal entities with MRN + DOB matching and an admin-review queue for ambiguous matches | TT-R069, TT-R101 | `tests/hl7Ingest.test.cjs` | 6 | PASS |
| OQ-A66 | OPTN-style export produces TCR/TRR/TRF-shaped CSV with RFC 4180 escaping and a `DO_NOT_SUBMIT` watermark in both filename and header | TT-R070, TT-R123 | `tests/optnExport.test.cjs` | 6 | PASS |

### 5.7 CMS IOTA waitlist notification pipeline

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A70 | Waitlist status transitions are immutable at the trigger level; the notification record carries content hash, generator version and a due date derived from the effective timestamp; frozen fields reject alteration | TT-R071, TT-R072, TT-R073, TT-R074, TT-R076 | `tests/iotaNotifications.test.cjs` | 17 | PASS |
| OQ-A71 | Notice generation is deterministic; templates are validated against all five §512.442(d) content elements and rejected if any is missing or an unrecognised placeholder is used; the offer-eligibility statement is system-supplied; the idempotency key prevents a duplicate document | TT-R075, TT-R077, TT-R078, TT-R079 | `tests/iotaNoticeGenerator.test.cjs` | 49 | PASS |
| OQ-A72 | The obligation is created in the same operation as the transition; incomplete configuration reports the obligation as unmet rather than discarding the transition; delivery records channel and timestamp and distinguishes late from on-time; the compliance summary reports open, overdue, on-time and late counts; role scoping and audit logging on every write | TT-R129 – TT-R136 | `tests/iotaNoticeService.test.cjs` | 25 | PASS |
| OQ-A73 | Chart filing constructs a FHIR R4 DocumentReference whose subject derives from the notification's own patient reference; filing is refused on content-hash mismatch; dry-run builds without transmitting; a failed filing remains retryable and an already-filed notice is not filed again; manual filing can be recorded | TT-R150 – TT-R155 | `tests/chartFiling.test.cjs` | 15 | PASS |

### 5.8 Platform hardening, licensing and release gates

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A80 | Electron process isolation: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, strict CSP, navigation and popup blocking, DevTools disabled in packaged builds | TT-R141 | `tests/electronHardening.test.cjs` | 28 | PASS |
| OQ-A81 | Update authorization: an update is accepted only from the authorized channel with a verified signature | TT-R146 | `tests/updateAuthorization.test.cjs` | 9 | PASS |
| OQ-A82 | License signature verification, machine binding, expiry and grace handling; the publisher private key is never distributed | — | `tests/license.test.cjs` | 20 | PASS |
| OQ-A83 | A distribution build fails rather than emitting an unsigned Windows artifact, and names the missing credential | TT-R146 | `tests/signWin.test.cjs` | 26 | PASS |
| OQ-A84 | The same rule applies to macOS notarization | TT-R146 | `tests/notarize.test.cjs` | 12 | PASS |
| OQ-A85 | The release gate inspects the artifact for an embedded signature rather than trusting the filename or build configuration, and rejects a catalog-only signature | TT-R147 | `tests/artifactSignature.test.mjs` | 14 | PASS |
| OQ-A86 | The dependency gate fails on an undocumented finding, on a severity increase beyond what the exception assessed, on an expired exception, and on a stale exception matching no real finding | TT-R144 | `tests/auditExceptions.test.mjs` | 14 | PASS |
| OQ-A87 | Every renderer bridge call resolves against the real preload surface, so a feature cannot be wired in development and unwired in a package | TT-R145 | `tests/rendererBridgeCoverage.test.mjs` | 5 | PASS |
| OQ-A88 | The Vite source entry point is guarded against being overwritten by a build artifact | TT-R145 | `tests/buildEntryIntegrity.test.mjs` | 6 | PASS |
| OQ-A89 | Every cross-reference in the validation package resolves: unique requirement ids, a matrix row per requirement, a verification artifact for every Mandatory requirement, resolvable SDS, OQ and risk references | — | `tests/complianceDocs.test.mjs` | 4 | PASS |

### 5.9 Renderer components

| ID | Control verified | Req | Verification artifact | Asserts | Result |
| --- | --- | --- | --- | ---: | --- |
| OQ-A90 | Renderer component behaviour including error boundaries, dashboard, settings, login and patient detail screens | TT-R124 | `tests/components/` (17 files, executed by Vitest) | 137 | PASS |

## 6. Server tier — executed cases (early access)

The server tier is **early access**; see
[`../VALIDATION_PLAN.md`](../VALIDATION_PLAN.md) §2.2 and
[RR-14](../RESIDUAL_RISK.md#rr-14--the-server-tier-is-early-access). All 27
unit files below executed and passed, totalling 312 tests. The integration
suites did **not** run (§9, D-01).

| ID | Control verified | Verification artifact | Tests | Result |
| --- | --- | --- | ---: | --- |
| OQ-S01 | **SMART patient-compartment isolation enforced at the FHIR storage layer**, so a token scoped to one patient cannot read another regardless of route (finding C-1) | `server/test/unit/patientCompartment.test.mjs` | 29 | PASS |
| OQ-S02 | SMART scope parsing, expansion and least-privilege reduction | `server/test/unit/smartScopes.test.mjs` | 24 | PASS |
| OQ-S03 | SMART authorization decisions per resource and interaction | `server/test/unit/smartAuthz.test.mjs` | 14 | PASS |
| OQ-S04 | SMART hardening: launch context, redirect and token handling | `server/test/unit/smartHardening.test.mjs` | 23 | PASS |
| OQ-S05 | SMART client authentication | `server/test/unit/smartClientAuth.test.mjs` | 3 | PASS |
| OQ-S06 | **Natively issued JWTs no longer bypass FHIR authorization** (finding M-9) | `server/test/unit/jwt.test.mjs` | 4 | PASS |
| OQ-S07 | Role enforcement on authenticated principals | `server/test/unit/authRoles.test.mjs` | 4 | PASS |
| OQ-S08 | Tenancy enforcement on authenticated principals | `server/test/unit/authTenancy.test.mjs` | 12 | PASS |
| OQ-S09 | HL7 tenancy: **cross-tenant dead-letter replay is refused** (finding H-3) | `server/test/unit/hl7Tenancy.test.mjs` | 18 | PASS |
| OQ-S10 | HL7 duplicate control | `server/test/unit/hl7DuplicateControl.test.mjs` | 5 | PASS |
| OQ-S11 | HL7 de-duplication | `server/test/unit/hl7Dedupe.test.mjs` | 4 | PASS |
| OQ-S12 | HL7 v2 parsing | `server/test/unit/hl7Parser.test.mjs` | 3 | PASS |
| OQ-S13 | HL7 extended segment handling | `server/test/unit/hl7Extended.test.mjs` | 6 | PASS |
| OQ-S14 | **MLLP frame cap, idle timeout and connection cap** (finding H-9) | `server/test/unit/mllp.test.mjs` | 14 | PASS |
| OQ-S15 | TLS configuration | `server/test/unit/tlsConfig.test.mjs` | 6 | PASS |
| OQ-S16 | TLS fails closed rather than downgrading | `server/test/unit/tlsFailClosed.test.mjs` | 11 | PASS |
| OQ-S17 | Deployment hardening expectations, including the listener binding 127.0.0.1 by default | `server/test/unit/deploymentHardening.test.mjs` | 27 | PASS |
| OQ-S18 | Input schema validation across the REST surface | `server/test/unit/inputSchemas.test.mjs` | 36 | PASS |
| OQ-S19 | **CDS Hooks stores a PHI-free invocation summary** (finding H-12) | `server/test/unit/cdsAudit.test.mjs` | 15 | PASS |
| OQ-S20 | CDS service registry | `server/test/unit/cdsRegistry.test.mjs` | 3 | PASS |
| OQ-S21 | FHIR CapabilityStatement | `server/test/unit/fhirCapability.test.mjs` | 5 | PASS |
| OQ-S22 | FHIR Subscription matching | `server/test/unit/subscriptionMatcher.test.mjs` | 6 | PASS |
| OQ-S23 | Server-side audit hash chain | `server/test/unit/auditChain.test.mjs` | 2 | PASS |
| OQ-S24 | Server-side MFA | `server/test/unit/mfa.test.mjs` | 6 | PASS |
| OQ-S25 | Organ offer state machine (server) | `server/test/unit/offerStateMachine.test.mjs` | 3 | PASS |
| OQ-S26 | Epic on FHIR integration | `server/test/unit/epicIntegration.test.mjs` | 15 | PASS |
| OQ-S27 | Epic client registry | `server/test/unit/epicRegistry.test.mjs` | 14 | PASS |

## 7. Traceability

Every Mandatory requirement in `SYSTEM_REQUIREMENTS_SPECIFICATION.md` traces
to a verification artifact through
[`../TRACEABILITY_MATRIX.md`](../TRACEABILITY_MATRIX.md), and that trace is
machine-checked by `scripts/check-compliance-docs.mjs` (OQ-A89).

Requirements whose verification artifact in the matrix is an **interactive OQ
case** rather than a test file are, by construction, not covered by this
record. They are the site's obligation and are listed in §8. This includes
TT-R008 (idle expiry observed at a screen), TT-R040 to TT-R044 (visual
inspection of the cipher, key rotation, integrity failure handling, PDF
banner), TT-R120 to TT-R122 (administrator reporting screens), TT-R141
(network capture), TT-R143 (About dialog), TT-R146 and TT-R147 (signature
verification on the receiving host).

As part of this release the matrix was audited for citations of test files
that do not exist. Four dangling citations were found and corrected; the
audit and its outcome are recorded in the Validation Summary Report §6.

## 8. NOT EXECUTED — interactive Operational Qualification

These cases require a human operating a running application, a site network,
or site infrastructure. They are executed by the deploying organization using
[`../templates/OQ_PROTOCOL_TEMPLATE.md`](../templates/OQ_PROTOCOL_TEMPLATE.md),
which numbers them `OQ-01` onward.

| Area | Site OQ cases | Why not executed by the vendor |
| --- | --- | --- |
| Interactive login, lockout observation, MFA enrolment at a screen | OQ-01 – OQ-09 | No display session; no Electron window was opened. Underlying logic is covered by OQ-A01 – OQ-A08. |
| Audit trail observed through the administrator UI | OQ-20, OQ-24, OQ-25, OQ-120 | Requires a running application and an authenticated administrator. |
| SIEM event observed arriving at a real destination | OQ-26 | No SIEM. Formatter and redaction behaviour covered by OQ-A34, OQ-A35. |
| Encryption: opening the database with an external `sqlite3`, key rotation from the admin UI, byte-level corruption and restart, PDF export banner | OQ-40 – OQ-44 | Requires an installed application and a GUI. |
| Operational features exercised through the UI | OQ-60 – OQ-70 | Requires a GUI. Service-layer behaviour covered by OQ-A60 – OQ-A66. |
| IOTA notice workflow exercised through the UI, including direct-SQL tamper attempts on a live database | OQ-71 – OQ-79, OQ-129 – OQ-136 | Requires a GUI and a populated site database. Logic covered by OQ-A70 – OQ-A72. |
| Chart filing against a real Epic endpoint, including the unreachable-endpoint path | OQ-150 – OQ-155 | No Epic endpoint. Construction, hash verification and dry-run covered by OQ-A73. |
| Backup and migration safety observed at startup on a populated database | OQ-84 – OQ-87 | Requires an installed application. Logic covered by OQ-A42. |
| System Health screen and support bundle export through the UI | OQ-124 – OQ-128 | Requires a GUI. Bundle content and redaction covered by OQ-A36. |
| 30-minute packet capture confirming egress only to whitelisted hosts | OQ-141 | No site network. Material because optional egress paths exist (RR-12). |
| About dialog wording | OQ-143 | Requires a GUI. |
| Installer signature verification on the receiving host | OQ-147 | No signed installer exists (RR-10). |
| Performance and capacity under load | `tests/load-test.cjs`; PQ-03, PQ-09 | Excluded from the `core` group by design; requires representative volumes. |
| End-to-end flows against the real Electron application | `tests/e2e/` via Playwright | No display session. |

## 9. Deviations

| ID | Deviation | Impact | Disposition |
| --- | --- | --- | --- |
| D-01 | The server integration suites (`server/test/integration/api.test.mjs`, `fhir.test.mjs`, `mllp.test.mjs`, `mirth.test.mjs`) were **not executed**: no PostgreSQL server exists in this environment. | Row-level security is verified at the DDL and application-query level but has never been observed being enforced by a running engine. If the application connects as a superuser, an owner, or a `BYPASSRLS` role, the H-3 policies are inert and nothing reports it. | **Accepted with action.** Recorded as [RR-04](../RESIDUAL_RISK.md#rr-04--rls-is-not-verified-against-a-live-postgresql-instance) and FMEA action A-05 (RPN 189). Site IQ steps IQ-S15 and IQ-S16 require the deploying organization to close it. |
| D-02 | The Playwright end-to-end suite (`tests/e2e/`) was **not executed**: no display session. | No case in this record exercises the assembled Electron application as a user would. | **Accepted.** Covered by the interactive site OQ in §8. Bridge coverage (OQ-A87) and build entry integrity (OQ-A88) reduce, but do not remove, the risk that a control is wired in development and unwired in a package (FM-14). |
| D-03 | The load and capacity suite (`tests/load-test.cjs`) was **not executed**. | Performance requirements TT-R080 and TT-R083 have no executed evidence. | **Accepted.** These are Performance Qualification requirements by nature and are covered by PQ-03 and PQ-09 in [`PQ_TT-PQ-001.md`](PQ_TT-PQ-001.md), which the site executes. |
| D-04 | `tests/ehrMigration.test.cjs` reports a terminal pass line without a numeric assertion count (OQ-A43). | The 1058 total in §3 excludes this suite's assertions. | **Accepted.** The suite exited zero. The count is excluded rather than estimated. |
| D-05 | The renderer suite emits React error-boundary stack traces to stderr during `tests/components/ErrorBoundary.test.jsx`. | Noise in the run log could mask a real error. | **Accepted, no defect.** The traces are produced deliberately by the test, which asserts that a thrown child is caught by the boundary. All 137 renderer tests passed. |

No deviation resulted in a failed case. No case was re-run to obtain a pass.

## 10. Conclusion

The automated portion of Operational Qualification for TransTrack 1.3.0 is
**complete and passing**:

* 62 of 62 desktop Node suites passed, 1058 recorded assertions.
* 27 of 27 server unit files passed, 312 tests.
* 17 of 17 renderer component files passed, 137 tests.
* Static analysis, the dependency-vulnerability gate and the validation
  package consistency checker all passed.

Every case in §5 and §6 cites a test file that exists on disk and reports the
count that file emitted during this run.

The interactive portion is **not executed** and remains a precondition of
production use. Five deviations are recorded in §9, two of which (D-01, D-02)
leave a control verified only at a code boundary and are carried into
[`../RESIDUAL_RISK.md`](../RESIDUAL_RISK.md).

**This document does not qualify TransTrack for clinical use.** It records
that the vendor's software verification passed. Site qualification — the
interactive OQ and the whole of PQ — has not begun.

## 11. Signature block

| Role | Party | Scope of signature | Signature | Date |
| --- | --- | --- | --- | --- |
| Engineering Lead | Vendor | §5 and §6 executed as recorded, on the environment in §2 | _pending site execution_ | _pending site execution_ |
| Quality Assurance Officer | Vendor | §9 deviations dispositioned; §10 conclusion accepted | _pending site execution_ | _pending site execution_ |
| Customer Quality Assurance Officer | Customer | §8 interactive cases executed and reviewed | _pending site execution_ | _pending site execution_ |
| Customer Transplant Administrator | Customer | §8 operational and IOTA cases executed | _pending site execution_ | _pending site execution_ |

## 12. Change history

| Version | Date | Change | Author role |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Initial issue. First executed OQ record for any TransTrack release; created in response to validation finding C-2(b). Replaces the empty results tables in the superseded `docs/VALIDATION_ARTIFACTS.md`. | Engineering Lead |
