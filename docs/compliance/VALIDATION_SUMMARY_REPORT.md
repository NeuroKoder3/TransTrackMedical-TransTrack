# Validation Summary Report — Vendor Software Verification

| Document ID | TT-VSR-001 |
| --- | --- |
| Version | 1.0 |
| Status | **Issued** |
| Software version | TransTrack 1.3.0 |
| Effective date | 2026-08-02 |
| Owner | Quality Assurance Officer |
| Governing plan | [`VALIDATION_PLAN.md`](VALIDATION_PLAN.md) v2.0 |
| Supersedes | `docs/VALIDATION_ARTIFACTS.md` v1.0.1 (withdrawn) |
| Next review | On the next release, or 2027-08-02, whichever is sooner |

---

## THE ONE THING TO READ

**Vendor software verification for TransTrack 1.3.0 is complete and passing.
Site qualification has not started. TransTrack 1.3.0 is therefore NOT
validated for production clinical use, and the vendor cannot make it so.**

| Qualification stage | Owner | Status | Evidence |
| --- | --- | --- | --- |
| Installation Qualification — vendor portion | Vendor | **COMPLETE** — 18 of 18 cases passed | [`executed/IQ_TT-IQ-001.md`](executed/IQ_TT-IQ-001.md) §4 |
| Installation Qualification — host portion | Deploying organization | **NOT EXECUTED** — 16 steps outstanding | [`executed/IQ_TT-IQ-001.md`](executed/IQ_TT-IQ-001.md) §5 |
| Operational Qualification — automated | Vendor | **COMPLETE** — 106 suites/files, 1507 assertions, no failure | [`executed/OQ_TT-OQ-001.md`](executed/OQ_TT-OQ-001.md) §5–§6 |
| Operational Qualification — interactive | Deploying organization | **NOT EXECUTED** | [`executed/OQ_TT-OQ-001.md`](executed/OQ_TT-OQ-001.md) §8 |
| Performance Qualification | Deploying organization | **NOT EXECUTED** — no scenario has been run by anyone | [`executed/PQ_TT-PQ-001.md`](executed/PQ_TT-PQ-001.md) |
| Site Validation Summary Report | Deploying organization | **NOT ISSUED** | [`VALIDATION_SUMMARY_REPORT_TEMPLATE.md`](VALIDATION_SUMMARY_REPORT_TEMPLATE.md) |

A validation package that says "vendor verification complete; site
qualification pending, here is the protocol" is defensible. This is that
package. Nothing in it records an execution that did not happen, a signature
that was not given, or a result that was not observed.

---

## 1. Purpose and scope

This report summarises the validation activities performed by TransTrack
Medical Software for release 1.3.0, states the results, records the deviations
and limitations, and states plainly which qualification stages are complete
and which are not.

It covers the TransTrack desktop application, its clinical reference
calculators, its release pipeline, and the optional server tier at the reduced
standard appropriate to its early-access designation
([`VALIDATION_PLAN.md`](VALIDATION_PLAN.md) §2.2).

It does **not** constitute, and must not be represented as:

* a determination that any deploying organization is HIPAA compliant —
  compliance is an organizational determination about an organization, not an
  attribute of a product;
* a 21 CFR Part 11 validation for any organization's records;
* an FDA device or non-device determination;
* an independent security attestation;
* a claim of AATB alignment. No AATB control mapping exists in this package
  and none is asserted. Earlier revisions of the product documentation claimed
  alignment with AATB Standards for Tissue Banking; that claim has been
  removed rather than retrospectively constructed.

## 2. Why this release has a validation summary at all

The preceding validation review recorded finding C-2: *no executed or approved
validation package*. At that point `docs/compliance/` held a Validation Plan
marked "Template — to be ratified", blank IQ/OQ/PQ protocols with `_____`
execution fields, a Validation Summary Report **template**, and a pilot-site
example explicitly labelled fictional. In parallel, `docs/VALIDATION_ARTIFACTS.md`
carried a second, older package for v1.0.0 with empty results tables and the
text "[To be completed after validation execution]". Two packages of different
vintage, neither executed.

This release replaces that with one package, at one vintage, with real
execution records. Specifically:

| Finding | Response in 1.3.0 |
| --- | --- |
| C-2(a) — plan not ratified | [`VALIDATION_PLAN.md`](VALIDATION_PLAN.md) issued at v2.0, status Approved and in force, effective 2026-08-02, scope bound to 1.3.0, approver roles named by title. |
| C-2(b) — no executed protocols | [`executed/IQ_TT-IQ-001.md`](executed/IQ_TT-IQ-001.md), [`executed/OQ_TT-OQ-001.md`](executed/OQ_TT-OQ-001.md), [`executed/PQ_TT-PQ-001.md`](executed/PQ_TT-PQ-001.md) and this report. Each records what was actually run, and marks everything else NOT EXECUTED with a reason and an executing party. |
| C-2(c) — two packages of different vintage | `docs/VALIDATION_ARTIFACTS.md` withdrawn and replaced by a superseding notice pointing here. |
| C-2(d) — no FMEA | [`FMEA.md`](FMEA.md) issued: 30 failure modes derived from the implemented system, with S/O/D scoring, RPN, and a named action for every mode above RPN 100. |
| C-2(e) — no residual-risk statement | [`RESIDUAL_RISK.md`](RESIDUAL_RISK.md) issued: 16 entries, each with affected findings, why it is accepted, compensating controls, and closure criteria. |
| I-6 — no FMEA | Closed by C-2(d). |
| I-7 — matrix cites test files that may not exist | Audit performed; four dangling test citations and four stale implementation paths corrected. See §6. |

## 3. Verification environment

| Item | Value |
| --- | --- |
| Operating system | Ubuntu 24.04.4 LTS, kernel 6.12.94, x86_64 |
| Node.js | v22.14.0 |
| npm | 10.9.7 |
| Date of execution | 2026-08-02 |
| PostgreSQL | Not present |
| Windows / macOS host | Not present |
| Signed installer | Not available — signing credentials not procured |
| Display / GUI session | Not present |
| Clinical users | None |

Every "NOT EXECUTED" in this package traces to one of the five absences above.

## 4. Results

### 4.1 Installation Qualification — vendor portion

| Category | Cases | PASS | FAIL | NOT EXECUTED |
| --- | ---: | ---: | ---: | ---: |
| Build reproducibility and dependency integrity | 6 | 6 | 0 | 0 |
| Schema, migrations and encryption at rest | 5 | 5 | 0 | 0 |
| File layout and controlled content | 7 | 7 | 0 | 0 |
| **Total** | **18** | **18** | **0** | **0** |

Notable observed evidence: the dependency tree resolved from
`package-lock.json` (lockfileVersion 3, 1188 packages) with no integrity
failure; the SQLCipher native binding built from source and loaded; a fresh
database created 47 tables, 114 indexes and 8 triggers, reached schema version
19 across 19 migrations, returned `ok` from `PRAGMA integrity_check`, and did
**not** begin with the plaintext SQLite header.

### 4.2 Operational Qualification — automated portion

| Runner | Files / suites | Assertions or tests | Result |
| --- | ---: | ---: | --- |
| Desktop Node suites (`core` group) | 62 | 1058 recorded | 62/62 passed |
| Server unit suites (Vitest) | 27 | 312 | 27/27 files, 312/312 tests passed |
| Renderer component suites (Vitest) | 17 | 137 | 17/17 files, 137/137 tests passed |
| **Total** | **106** | **1507** | **No failure** |

Supporting gates, all passing: `eslint . --quiet` with no findings; the
production dependency-vulnerability gate with one documented, unexpired
exception (`GHSA-qwww-vcr4-c8h2`, react-router, high, assessed
`not_affected / vulnerable_code_not_present`, review by 2026-11-01); and
`scripts/check-compliance-docs.mjs`, which resolves every cross-reference in
this package.

The 1058 figure counts assertions reported by 61 of the 62 desktop suites;
`tests/ehrMigration.test.cjs` reports a terminal pass line without a numeric
count and is excluded rather than estimated.

### 4.3 Verification of the previously reported findings

The following remediations were verified by executed test evidence during this
run. Assertion counts are those observed.

| Finding | Control | Evidence |
| --- | --- | --- |
| C-1 | SMART patient-compartment isolation enforced at the FHIR storage layer | `server/test/unit/patientCompartment.test.mjs` — 29 |
| C-3 | Every clinical constant traceable to a controlled source; PELD fails closed; MELD 3.0 adolescent equation corrected; LAS renamed to TTLI and flagged `isPublishedInstrument: false` | `tests/calculatorReferenceVectors.test.cjs` — 35; register in [`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md) |
| C-4 | Clinical validation enforced at IPC, REST, FHIR import, FHIR webhook and HL7 ingest | `tests/clinicalValidation.test.cjs` — 17; `server/test/unit/inputSchemas.test.mjs` — 36 |
| H-1 | Bulk patient list and filter require a PHI justification grant | `tests/phiListJustification.test.cjs` — 8 |
| H-2 | Database encryption verification is real and fails closed in packaged builds | `tests/encryptionVerification.test.cjs` — 13; `tests/compliance.test.cjs` writes a surname through the production cipher profile and reads the bytes back off disk |
| H-3 | RLS on `hl7_dead_letters`, `hl7_sending_apps`, `issued_licenses`; cross-tenant dead-letter replay refused | `server/test/unit/hl7Tenancy.test.mjs` — 18. **DDL and application-query level only** — see §5, D-01 |
| H-4 | FHIR transaction bundles authorise every entry | `server/test/unit/smartAuthz.test.mjs` — 14 |
| H-5 | The logger redacts PHI automatically at the sink | `tests/loggerRedaction.test.cjs` — 9; `tests/phiLeakage.test.cjs` — 10 |
| H-9 | MLLP frame cap, idle timeout, connection cap; listener binds 127.0.0.1 by default | `server/test/unit/mllp.test.mjs` — 14; `server/test/unit/deploymentHardening.test.mjs` — 27 |
| H-11 | Single fail-closed chained audit writer; unhashed rows flagged, not skipped; chain verified at startup | `tests/auditFailClosed.test.cjs` — 13; `tests/auditChain.test.cjs` — 10; `tests/auditKeyGating.test.cjs` — 39 |
| H-12 | CDS Hooks stores a PHI-free invocation summary | `server/test/unit/cdsAudit.test.mjs` — 15 |
| M-6 | Monotonic per-organisation audit sequence | `tests/auditChain.test.cjs` — 10 |
| M-9 | Native JWTs no longer bypass FHIR authorisation | `server/test/unit/jwt.test.mjs` — 4 |

### 4.4 Performance Qualification

**Not executed.** No scenario has been run, by the vendor or by anyone else.
See [`executed/PQ_TT-PQ-001.md`](executed/PQ_TT-PQ-001.md) and
[RR-05](RESIDUAL_RISK.md#rr-05--performance-qualification-has-not-been-executed).

## 5. Deviations

Deviations are carried forward from the executed IQ and OQ records. None
resulted in a failed case; each records something that was **not** verified,
which is the more useful thing for a reader to know.

| ID | Source | Deviation | Impact | Disposition |
| --- | --- | --- | --- | --- |
| D-01 | OQ D-01 | Server integration suites not executed — no PostgreSQL server. | Row-level security has never been observed being enforced by a running engine. If the application connects as a superuser, an owner, or a `BYPASSRLS` role, the H-3 policies are inert and nothing reports it. | Accepted with action. [RR-04](RESIDUAL_RISK.md#rr-04--rls-is-not-verified-against-a-live-postgresql-instance); FMEA action A-05 (RPN 189). Site closes it at IQ-S15 / IQ-S16 and PQ-27. |
| D-02 | OQ D-02 | Playwright end-to-end suite not executed — no display session. | No case exercises the assembled Electron application as a user would. | Accepted. Covered by the interactive site OQ. |
| D-03 | OQ D-03 | Load and capacity suite not executed. | TT-R080 and TT-R083 have no executed evidence. | Accepted. These are PQ requirements by nature; covered by PQ-03 and PQ-09. |
| D-04 | OQ D-04 | `tests/ehrMigration.test.cjs` reports no numeric assertion count. | The 1058 total excludes it. | Accepted. Count excluded rather than estimated. |
| D-05 | OQ D-05 | React error-boundary stack traces printed to stderr during the renderer run. | Log noise. | Accepted, no defect. The traces are produced deliberately by a test asserting the boundary catches a thrown child. |
| D-06 | IQ D-01 | Host-specific Installation Qualification not executed. | The vendor cannot state that TransTrack installs correctly on Windows or macOS. | Accepted. [RR-06](RESIDUAL_RISK.md#rr-06--installation-qualification-is-partially-executed). 16 deferred steps enumerated with executing parties. |
| D-07 | IQ D-02 | No SBOM generated during this run; only the availability of CycloneDX tooling was confirmed. | The 1.3.0 evidence pack contains no SBOM. | Open. SBOM is produced by the release job, which cannot run until signing credentials exist ([RR-10](RESIDUAL_RISK.md#rr-10--release-signing-credentials-are-not-yet-procured)). It is a precondition of the first signed release. |
| D-08 | IQ D-03 | Cipher parameters (AES-256-CBC, PBKDF2-SHA512 ≥256 000) are verified by a separate suite rather than measured from the artifact at IQ-V13. | The IQ step establishes that the file is encrypted, not which parameters produced it. | Accepted. `tests/encryptionVerification.test.cjs` and `tests/compliance.test.cjs` assert `cipher = sqlcipher` and `kdfIterations = 256000` against a real handle. |

## 6. Traceability audit (finding I-7)

`scripts/check-compliance-docs.mjs` resolves requirement ids, matrix rows, OQ
case ids, SDS sections and risk ids. It does **not** check that the test files
the matrix cites exist on disk. A citation naming a deleted or renamed file
reads exactly like a real one and satisfies every check the gate performs.

Every path in `TRACEABILITY_MATRIX.md` was therefore checked against the
filesystem on 2026-08-02. Eight were stale:

| Cited path | Exists? | Corrected to |
| --- | --- | --- |
| `tests/auth.test.cjs` (TT-R001, TT-R003, TT-R023) | No | `tests/ipc-integration.test.cjs`, `tests/sessionFailClosed.test.cjs`, `tests/compliance.test.cjs` |
| `tests/passwordPolicy.test.cjs` (TT-R002, TT-R006, TT-R007) | No | `tests/business-logic.test.cjs`, `tests/compliance.test.cjs`, `tests/passwordHistory.test.cjs` |
| `tests/siem.test.cjs` (TT-R026) | No | `tests/siemForwarder.test.cjs`, `tests/siemRedaction.test.cjs` |
| `tests/livingDonor.test.cjs` (TT-R068) | No | `tests/livingDonors.test.cjs` |
| `electron/services/passwordPolicy.cjs` (TT-R002, TT-R006, TT-R007) | No | `electron/ipc/shared.cjs`, `electron/services/passwordHistory.cjs` |
| `electron/services/priorityWeighting.cjs` (TT-R062) | No | `electron/functions/index.cjs`, `electron/ipc/handlers/clinical.cjs` |
| `electron/services/livingDonor.cjs` (TT-R068) | No | `electron/services/livingDonors.cjs` |
| `electron/ipc/handlers/livingDonor.cjs` (TT-R068) | No | `electron/ipc/handlers/livingDonors.cjs` |

All other paths in both columns resolve. The recommended permanent fix — that
the consistency gate itself verify path existence — belongs to `scripts/` and
is outside the scope of this document.

## 7. Limitations

Stated once, plainly, so no reader has to assemble them from the deviation
table.

1. **No Performance Qualification exists.** For 1.3.0 or for any prior
   release, at any site.
2. **No site has executed the host portion of Installation Qualification.**
3. **No interactive Operational Qualification has been executed.** Everything
   in §4.2 was verified at a code boundary, not at a screen.
4. **No signed installer exists.** Signing and notarization logic is
   implemented and fails closed; the credentials are not procured.
5. **No independent security assessment exists.** No third-party penetration
   test, no SOC 2, no HITRUST.
6. **No disaster recovery drill has been executed for this release.** RTO ≤4
   hours and RPO ≤24 hours are objectives, not demonstrated capabilities.
7. **The server tier is early access.** Only its unit suites ran; its
   integration suites and live row-level-security enforcement did not.
8. **PELD is unavailable.** TransTrack computes no PELD score pending the OPTN
   Policy 9.1.E Table 9-1 coefficients.
9. **The inactivation risk engine is not clinically validated.** Its weights
   are expert-elicited and its probabilities are not calibrated to observed
   outcomes.
10. **KDPI and EPTS percentiles are piecewise approximations** of the OPTN
    tables, flagged as approximations on every result.
11. **The lung instrument is not the OPTN LAS.** It is the TransTrack Lung
    Triage Index, an internal instrument with no external source.
12. **Electronic signatures are application-level**, not §11.200-compliant
    e-signatures.

Each limitation is carried as a formal entry in
[`RESIDUAL_RISK.md`](RESIDUAL_RISK.md) with compensating controls and closure
criteria.

## 8. Conclusion

For TransTrack 1.3.0:

* The vendor release verification criteria in
  [`VALIDATION_PLAN.md`](VALIDATION_PLAN.md) §6.1 are **satisfied**. All seven
  are met, with the evidence recorded in §4 and §6 above.
* The site validation criteria in
  [`VALIDATION_PLAN.md`](VALIDATION_PLAN.md) §6.2 are **not satisfied**, and
  none of them can be satisfied by the vendor.

**The release may be issued. It is not validated for production clinical use.**
A deploying organization completes validation by executing the host portion of
IQ, the interactive OQ, and the whole of PQ, closing or formally accepting each
residual risk assigned to it, and signing its own Validation Summary Report
using [`VALIDATION_SUMMARY_REPORT_TEMPLATE.md`](VALIDATION_SUMMARY_REPORT_TEMPLATE.md).

## 9. Approval

Approved by role. No individual is named. Signature and date fields are
completed in the vendor's document control system on issue; the vendor does
not pre-sign, and does not sign any document a site must execute.

| Role | Scope of signature | Signature | Date |
| --- | --- | --- | --- |
| Quality Assurance Officer | This report; §7 limitations; §8 conclusion | _pending site execution_ | _pending site execution_ |
| Engineering Lead | §4.1 and §4.2 results as executed; §6 traceability audit | _pending site execution_ | _pending site execution_ |
| Clinical Informatics Lead | §4.3 clinical findings; limitations 8, 9, 10, 11 | _pending site execution_ | _pending site execution_ |
| Information Security Officer | §5 deviations D-01 and D-06; limitations 5 and 6 | _pending site execution_ | _pending site execution_ |
| Release Manager | Limitation 4; deviation D-07 | _pending site execution_ | _pending site execution_ |

## 10. Change control

Changes to the verified configuration invoke
[`policies/CHANGE_MANAGEMENT_SOP.md`](policies/CHANGE_MANAGEMENT_SOP.md). A
change to any clinical constant or reference table additionally follows
[`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md) §3, which requires the affected
OQ cases to be re-executed and the change recorded here.

| Version | Date | Change | Author role |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Initial issue. First Validation Summary Report for any TransTrack release. Created in response to validation finding C-2(b) and C-2(c); supersedes `docs/VALIDATION_ARTIFACTS.md` v1.0.1. | Quality Assurance Officer |
