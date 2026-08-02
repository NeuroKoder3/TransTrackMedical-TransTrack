# Installation Qualification — Executed Record

| Document ID | TT-IQ-001 |
| --- | --- |
| Version | 1.0 |
| Status | **Partially executed** — vendor portion complete, host portion NOT EXECUTED |
| Software version | TransTrack 1.3.0 |
| Date executed | 2026-08-02 |
| Executed by role | Engineering Lead |
| Reviewed by role | Quality Assurance Officer |
| Governing plan | [`../VALIDATION_PLAN.md`](../VALIDATION_PLAN.md) v2.0 |
| Related | [`OQ_TT-OQ-001.md`](OQ_TT-OQ-001.md), [`PQ_TT-PQ-001.md`](PQ_TT-PQ-001.md), [`../VALIDATION_SUMMARY_REPORT.md`](../VALIDATION_SUMMARY_REPORT.md) |

> ## What this document is, and what it is not
>
> This is a record of a **vendor-side software verification run**. It records
> what was actually executed, on the environment described in §3, on the date
> above.
>
> It is **not** a site Installation Qualification. Sixteen of the steps in this
> protocol cannot be executed by the vendor because they require a Windows or
> macOS host, a signed installer, or site infrastructure. Those steps are
> recorded in §5 as **NOT EXECUTED**, each with the reason and the party that
> must execute it. No result is recorded for a step that was not run, and no
> step is marked passed on the basis that it "would" pass.
>
> A deploying organization must execute §5 on each target host before placing
> TransTrack into production. See [`../RESIDUAL_RISK.md`](../RESIDUAL_RISK.md)
> entry RR-06.

## 1. Purpose

Verify that the TransTrack 1.3.0 release artifact is internally consistent and
installable: that its declared dependencies resolve reproducibly, its native
components build, its database schema and migrations create cleanly and
produce an encrypted store, its file layout matches the design specification,
and the tooling required to produce release evidence is present.

## 2. Scope of the vendor portion

| Verified here | Deferred to the site (§5) |
| --- | --- |
| Dependency resolution and lockfile integrity | Installation from a signed installer |
| Native module build (SQLCipher binding) | Installer signature verification on the receiving host |
| Schema, index, trigger and migration creation | Application data directory location on Windows / macOS |
| Database encryption at rest, observed on the produced file | Host disk encryption |
| Repository file layout against the SDS | Local administrator rights inventory |
| Reference data presence and status | Host clock synchronisation |
| SBOM and dependency-audit tooling | Network egress restriction |
| Static analysis gate | About-dialog version confirmation on the installed build |

## 3. Verification environment

| Item | Value |
| --- | --- |
| Operating system | Ubuntu 24.04.4 LTS, kernel 6.12.94, x86_64 |
| Node.js | v22.14.0 |
| npm | 10.9.7 |
| Package manager mode | `npm ci` semantics against `package-lock.json` (lockfileVersion 3) |
| Database engine | `better-sqlite3-multiple-ciphers` 12.10.0 (SQLCipher-compatible) |
| PostgreSQL | **Not present.** No database server in this environment. |
| Windows / macOS host | **Not present.** |
| Signed installer | **Not available.** Signing credentials not procured (RR-10). |
| Clinical users | **None.** |
| Display / GUI session | **Not present.** No Electron window was opened. |

The absences above are the reason for every NOT EXECUTED entry in §5. They are
stated here once so that no individual step needs to re-argue them.

## 4. Executed test cases

Result key: **PASS** — executed, expected result observed. **NOT EXECUTED** —
not run; see §5.

### 4.1 Build reproducibility and dependency integrity

| ID | Step | Expected | Result | Evidence observed |
| --- | --- | --- | --- | --- |
| IQ-V01 | Resolve the full dependency tree from `package-lock.json` under `npm ci` semantics. | Tree resolves with no integrity failure and no unresolved specifier. | **PASS** | `npm ci --dry-run` completed with exit status 0. Lockfile is `lockfileVersion 3` describing 1188 packages. |
| IQ-V02 | Confirm the lockfile is the pinned, deterministic input to the build. | Lockfile present, version 3, and consumed without modification. | **PASS** | `package-lock.json` present; dry-run resolution did not require a lockfile update. |
| IQ-V03 | Build the SQLCipher native binding from source for the host toolchain. | Build completes; the module loads. | **PASS** | `npm rebuild better-sqlite3-multiple-ciphers` reported "rebuilt dependencies successfully". The module was subsequently required and used in IQ-V10 through IQ-V14. |
| IQ-V04 | Run the static analysis gate over the whole repository. | No error-level findings. | **PASS** | `npm run lint` (`eslint . --quiet`) exited 0 with no output. |
| IQ-V05 | Run the production dependency-vulnerability gate. | Pass, with every finding at or above the moderate threshold either resolved or covered by an unexpired documented exception. | **PASS** | `npm run audit` reported: 1 finding at/above threshold, `GHSA-qwww-vcr4-c8h2` (react-router, high), accepted as `not_affected / vulnerable_code_not_present`, review by 2026-11-01. Verdict: `PASS — no unresolved vulnerabilities at moderate+ (1 documented exception(s))`. |
| IQ-V06 | Confirm SBOM generation tooling resolves and reports a version. | Tool executes. | **PASS** | `@cyclonedx/cyclonedx-npm` resolved and reported version 5.0.0. An SBOM was **not** generated as part of this run; see deviation D-02. |

### 4.2 Schema, migrations and encryption at rest

Executed by creating a fresh database in a temporary directory using the
shipped schema and migration modules, then inspecting the result. The database
was destroyed at the end of the step.

| ID | Step | Expected | Result | Evidence observed |
| --- | --- | --- | --- | --- |
| IQ-V10 | Create a new SQLCipher database and apply `createSchema`, `createIndexes`, `createAuditLogTriggers` and `createWaitlistTransitionTriggers` from `electron/database/schema.cjs`. | Schema creates without error. | **PASS** | 47 tables, 114 indexes and 8 triggers created. |
| IQ-V11 | Apply all pending migrations via `runMigrations` from `electron/database/migrations.cjs`. | All migrations apply; `schema_migrations` records each. | **PASS** | Schema version 19 reached; 19 rows in `schema_migrations`; no pending migration remained. |
| IQ-V12 | Run `PRAGMA integrity_check` on the resulting database. | `ok`. | **PASS** | Returned `ok`. |
| IQ-V13 | Confirm the produced file is encrypted at rest. | The first 16 bytes are **not** the plaintext SQLite header `SQLite format 3\0`. | **PASS** | Header check returned false — the file does not begin with the plaintext SQLite magic. |
| IQ-V14 | Confirm the audit trail carries database-level immutability triggers rather than application-level protection alone. | UPDATE and DELETE on `audit_logs` are blocked at the engine. | **PASS** | Triggers present among the 8 created in IQ-V10; behaviour verified in OQ-A03 (`tests/auditImmutability.test.cjs`, 19 assertions). |

### 4.3 File layout and controlled content

| ID | Step | Expected | Result | Evidence observed |
| --- | --- | --- | --- | --- |
| IQ-V20 | Confirm the main-process entry point declared in `package.json` exists. | `electron/main.cjs` present. | **PASS** | Present; `package.json` `main` field resolves. |
| IQ-V21 | Confirm the renderer build entry point has not been overwritten by a build artifact. | Source entry intact. | **PASS** | Verified by `tests/buildEntryIntegrity.test.mjs` (6 assertions) in the OQ run. |
| IQ-V22 | Confirm the clinical reference data directory is present with one file per externally owned table. | `optn-kdpi.json`, `optn-epts.json`, `optn-peld.json` present. | **PASS** | All three present in `electron/services/calculators/reference/`. |
| IQ-V23 | Confirm no reference table is past its `reviewBy` date. | No table stale. | **PASS** | `tests/calculatorReferenceVectors.test.cjs` passed (35 assertions); the suite fails the build on a stale table. |
| IQ-V24 | Confirm `optn-peld.json` declares its unavailability rather than shipping unverified coefficients. | Status is not `ACTIVE`. | **PASS** | Status `AWAITING_CONTROLLED_SOURCE`; the calculator returns no PELD score. See RR-01. |
| IQ-V25 | Confirm the validation package's internal cross-references resolve. | Checker passes. | **PASS** | `scripts/check-compliance-docs.mjs` passed via `tests/complianceDocs.test.mjs` (4 assertions). |
| IQ-V26 | Confirm every renderer bridge call resolves against the real preload surface. | No unwired call. | **PASS** | `tests/rendererBridgeCoverage.test.mjs` (5 assertions). |

### 4.4 Summary of the vendor portion

| Category | Cases | PASS | FAIL | NOT EXECUTED |
| --- | ---: | ---: | ---: | ---: |
| Build reproducibility and dependency integrity | 6 | 6 | 0 | 0 |
| Schema, migrations and encryption at rest | 5 | 5 | 0 | 0 |
| File layout and controlled content | 7 | 7 | 0 | 0 |
| **Total (vendor portion)** | **18** | **18** | **0** | **0** |

## 5. NOT EXECUTED — site Installation Qualification

Every step below is **required** before production use and **must be executed
by the deploying organization**. None has been executed by the vendor. The
"Why not executed" column states the specific missing precondition rather than
a general disclaimer.

Steps map to the site protocol in
[`../templates/IQ_PROTOCOL_TEMPLATE.md`](../templates/IQ_PROTOCOL_TEMPLATE.md),
which the site executes and retains as its own IQ record.

| ID | Step | Why not executed | Who must execute | Evidence required |
| --- | --- | --- | --- | --- |
| IQ-S01 | Verify the host meets the reference workstation specification (OS, CPU, RAM, disk). | No Windows, macOS or RHEL target host in the vendor environment. | Customer IT / Security | Host inventory record or screenshot per host |
| IQ-S02 | Verify host disk encryption is enabled (BitLocker / FileVault / LUKS). | No target host. **Mandatory** — this is the compensating control for RR-08 (secure delete cannot guarantee erasure on modern storage) and FMEA action A-01. | Customer IT / Security | Central attestation export |
| IQ-S03 | Verify only authorised users hold OS-level local administrator rights. | Site-owned identity and endpoint management. | Customer IT / Security | Documented list reconciled against the actual group membership |
| IQ-S04 | Install TransTrack 1.3.0 from the signed installer and confirm the installer signature is valid before installing. | **No signed installer exists.** Windows code-signing certificate and Apple Developer enrolment are not procured (RR-10). The build pipeline fails closed rather than emitting an unsigned artifact. | Customer IT / Security, once the vendor closes RR-10 | Installer signature verdict (`Get-AuthenticodeSignature` on Windows) plus installation log |
| IQ-S05 | Compute the SHA-256 of the installed `electron/main.cjs` and compare it to the release manifest. | Requires an installed application produced by an installer. | Customer IT / Security | Hash comparison record |
| IQ-S06 | Launch TransTrack and confirm the About dialog reports 1.3.0. | No display or GUI session in the vendor environment; no Electron window was opened. | Customer IT / Security | Screenshot |
| IQ-S07 | Confirm the encrypted database is created at the platform application data directory (`%APPDATA%/transtrack/` on Windows, the equivalent elsewhere). | Path is platform-specific and resolved by Electron at runtime. Schema creation and encryption were verified in IQ-V10 to IQ-V13 against a temporary path, not against a platform application data directory. | Customer IT / Security | Path listing |
| IQ-S08 | Confirm the database cannot be opened as a plain SQLite file on the host. | Requires the installed application's database. The equivalent property was observed on a vendor-created file in IQ-V13. | Customer IT / Security | `sqlite3` error output |
| IQ-S09 | Confirm the startup integrity check runs and logs its result. | Requires a launched application. | Customer IT / Security | Log excerpt |
| IQ-S10 | Run `system:getMigrationStatus` as an administrator and confirm `pending: 0`. | Requires a launched application and an authenticated administrator session. | Customer IT / Security | Screenshot |
| IQ-S11 | Confirm outbound network access is restricted to whitelisted endpoints, by packet capture. | No site network. Relevant because optional egress paths exist and are off by default — remote log sink, SIEM forwarder, auto-update (RR-12). | Customer IT / Security | Packet capture |
| IQ-S12 | Confirm the host clock is synchronised to an authorised NTP source, drift ≤2 seconds. | No target host. Material because audit timestamps and the monotonic audit sequence depend on it. | Customer IT / Security | Screenshot |
| IQ-S13 | Confirm the first-launch administrator setup token file is removed after the initial password rotation. | Requires a first launch. | Customer IT / Security | Directory listing before and after |
| IQ-S14 | Record which optional egress paths are enabled, and confirm a Business Associate Agreement or a documented no-PHI determination exists for each. | Configuration is site-owned. | Customer IT / Security + Compliance Officer | Configuration record and BAA reference |
| IQ-S15 | **Server tier only.** Confirm the application's PostgreSQL role is not a superuser, does not hold `BYPASSRLS`, and is not the owner of the RLS-protected tables — or that `FORCE ROW LEVEL SECURITY` is set. | **No PostgreSQL server in the vendor environment.** This is the precondition that makes the H-3 row-level security policies effective; without it they are inert. See RR-04 and FMEA action A-05. | Customer IT / Security | `\d+` output for the protected tables and the role's attribute list |
| IQ-S16 | **Server tier only.** Run the server integration suites against the site's PostgreSQL instance. | No database server. | Customer IT / Security | `npm run test:integration` output from `server/` |

## 6. Deviations

| ID | Deviation | Impact | Disposition |
| --- | --- | --- | --- |
| D-01 | The host-specific portion of Installation Qualification was not executed. | The vendor cannot state that TransTrack installs correctly on a Windows or macOS host. Platform-specific installation defects would first be seen at a site. | **Accepted.** Recorded as [RR-06](../RESIDUAL_RISK.md#rr-06--installation-qualification-is-partially-executed). Every deferred step is enumerated in §5 with its executing party. |
| D-02 | An SBOM was not generated during this run; only the availability of the generation tooling was confirmed (IQ-V06). | The release evidence pack for 1.3.0 does not yet contain a CycloneDX SBOM. | **Open.** The SBOM is produced by the release job (`npm run sbom`), which runs as part of a distribution build. Because no distribution build can be produced until RR-10 closes, SBOM generation is deferred to the first signed release and is a precondition of it. |
| D-03 | IQ-V13 demonstrates that the produced file does not carry a plaintext SQLite header. It does not independently verify the cipher configuration (algorithm, KDF iteration count) against the declared AES-256-CBC / PBKDF2-SHA512 ≥256 000 parameters. | The parameters are asserted from configuration rather than measured from the artifact at this step. | **Accepted.** The parameters are verified separately by `tests/encryptionVerification.test.cjs` (13 assertions), which fails closed in packaged builds (finding H-2), and are re-verified at site IQ step IQ-S08. |

## 7. Conclusion

The vendor portion of Installation Qualification for TransTrack 1.3.0 is
**complete**: 18 of 18 executed cases passed, with no failures and three
recorded deviations, none of which invalidates an executed result.

The host portion is **not executed** and remains a precondition of production
use. Sixteen steps are enumerated in §5 with the party responsible for each.

This document does not qualify TransTrack for installation at any site.

## 8. Signature block

Vendor roles sign this record on issue; the signature and date fields are
completed in the vendor's document control system. Customer roles sign after
executing §5. No field below is pre-filled by the vendor on a site's behalf.

| Role | Party | Scope of signature | Signature | Date |
| --- | --- | --- | --- | --- |
| Engineering Lead | Vendor | §4 executed as recorded | _pending site execution_ | _pending site execution_ |
| Quality Assurance Officer | Vendor | §4 reviewed; §6 deviations dispositioned | _pending site execution_ | _pending site execution_ |
| Customer IT / Security | Customer | §5 executed on host ________________ | _pending site execution_ | _pending site execution_ |
| Customer Quality Assurance Officer | Customer | §5 reviewed and accepted | _pending site execution_ | _pending site execution_ |

## 9. Change history

| Version | Date | Change | Author role |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Initial issue. First executed IQ record for any TransTrack release; created in response to validation finding C-2(b). | Engineering Lead |
