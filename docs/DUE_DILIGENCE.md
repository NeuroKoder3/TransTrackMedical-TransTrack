# TransTrack - Technical Due Diligence Report

**Product:** TransTrack 1.3.0
**Category:** Transplant operations platform, architected to support HIPAA Security Rule controls and designed for alignment with FDA 21 CFR Part 11 electronic-records requirements
**Platform:** Offline-first desktop application (Windows, macOS, Linux), with optional Fastify + PostgreSQL server tier (**early access**) for FHIR R4 / SMART on FHIR v2 / CDS Hooks 1.1 / HL7 v2 MLLP integration
**Architecture:** Electron 39 + React 18 (Vite 6) + SQLite/SQLCipher (AES-256, PBKDF2-SHA512); pure-function operational scoring layer
**Date:** 2026-08-02 (originally drafted March 2026; revised for release 1.3.0 following an independent validation review)

---

## 1. Executive Summary

TransTrack is an offline-first desktop application for organ transplant centers, used to manage patient waitlists, donor matching, and operational readiness. It is **architected to support HIPAA Security Rule controls** and **designed for alignment with 21 CFR Part 11 electronic-records requirements**.

> **HIPAA compliance is not a product attribute.** It is a determination an organization makes about itself, its workforce, its policies, its Business Associate Agreements and its physical environment — of which software is one input. No vendor can supply it, and TransTrack does not claim to. The same applies to 21 CFR Part 11: Part 11 validation is performed by the deploying organization, against its own records and its own intended use. This document describes design controls, not certifications. It is consistent with the posture stated in [`README.md`](../README.md).

**The system does not operate entirely on-premises with no external network dependencies.** The desktop application's *core* runs fully offline — every clinical and operational feature works with no network — but four egress paths exist, and a diligence reader should know exactly what they are:

| Path | Default | Activated by | What crosses the boundary |
|---|---|---|---|
| Optional server tier (`server/`) | Not deployed | The site deploys it | Full PHI over TLS between the desktop thin client, the EHR and the server. Early access; see §4.4. |
| Optional remote log sink | **Off** | `SENTRY_DSN` or `TRANSTRACK_REMOTE_LOG_URL` (`electron/services/logger.cjs`) | Level, a message truncated to 256 characters, an allowlist of five metadata keys, platform and PID. PHI is redacted at the sink before dispatch. |
| Optional SIEM forwarder | **Off** | An administrator configures a destination | RFC 5424 syslog / CEF events carrying identifiers and categorical metadata only. |
| Auto-update | On in enterprise builds | `electron-updater` against GitHub Releases | Version metadata and the installer download. No PHI. |

Each path is a disclosure decision the deploying organization makes and papers. See [`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md) entry RR-12.

The application employs defense-in-depth security: AES-256 database encryption (SQLCipher), OS-native keychain key protection, role-based access control (RBAC), immutable and hash-chained audit trails, session binding, rate limiting, and content security policies.

**Validation status.** Vendor software verification for 1.3.0 is complete and passing: 106 test files, 1507 assertions, no failures, recorded in [`compliance/executed/OQ_TT-OQ-001.md`](compliance/executed/OQ_TT-OQ-001.md). **Site qualification has not been executed.** No Performance Qualification exists, for this or any prior release. The authoritative statement is [`compliance/VALIDATION_SUMMARY_REPORT.md`](compliance/VALIDATION_SUMMARY_REPORT.md); a diligence reader should read that document before this one.

**No AATB alignment is claimed.** Earlier revisions of this document stated that TransTrack had been "designed and validated against HIPAA Technical Safeguards, FDA 21 CFR Part 11, and AATB standards". No executed validation existed at the time, and no AATB control mapping has ever existed in this repository. The claim has been removed rather than retrospectively constructed. A deploying tissue bank requiring AATB alignment must perform that mapping itself.

---

## 2. Architecture Overview

### Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Electron 39.x | Cross-platform desktop framework |
| Frontend | React 18, Vite 6, TailwindCSS, Radix UI, TanStack Query | Modern component-based UI |
| Backend (desktop) | Node.js (Electron main process) | Business logic, IPC handlers, pure-function scoring |
| Database (desktop) | SQLite via better-sqlite3-multiple-ciphers | Encrypted local storage |
| Encryption | SQLCipher (AES-256-CBC, PBKDF2-HMAC-SHA512 ≥256 000) | At-rest data encryption |
| Optional server tier | Fastify, PostgreSQL 16, FHIR R4, SMART on FHIR v2, CDS Hooks 1.1, MLLP/TLS HL7 v2 | EHR / OPO interoperability and multi-tenant API surface |

### Codebase Metrics (refreshed April 2026)

| Metric | Value |
|---|---|
| Source files under `src/` and `electron/` (JS / JSX / TS / TSX / CJS / MJS) | 231 |
| Database tables after schema creation and all 19 migrations | 47 (30 `CREATE TABLE` statements in `electron/database/schema.cjs`, the remainder added by migrations) |
| Database indexes / triggers after migration | 114 / 8 |
| Production dependencies | 31 |
| Development dependencies | 20 |
| Automated test files (Node + server Vitest + renderer Vitest) | 106 |
| Automated assertions, all passing 2026-08-02 | 1507 |
| Inactivation Risk Engine unit assertions | 37 (pure-function, no DB required) |
| Documentation files under `docs/` | 76 markdown files, of which 30 are in `docs/compliance/` |
| Lines of operational scoring code (deterministic) | ~700 (`electron/services/inactivationRiskEngine.cjs`) |

### Data Flow

```
User Interface (React/Renderer)
    |
    | contextBridge (IPC, context-isolated)
    |
Preload Script (whitelisted API surface)
    |
    | ipcMain.handle (rate-limited, session-validated)
    |
IPC Handlers (RBAC-enforced, audit-logged)
    |
    | Parameterized queries only
    |
SQLCipher Database (AES-256 encrypted at rest)
```

All renderer-to-main communication passes through a secure IPC bridge with context isolation. No direct `nodeIntegration` is exposed to the renderer. Every IPC handler validates the session, checks rate limits, enforces RBAC permissions, and logs the operation to an immutable audit trail.

---

## 3. Security Controls

### 3.1 Encryption

| Control | Implementation |
|---|---|
| At-rest encryption | SQLCipher AES-256-CBC with 256,000 PBKDF2 iterations |
| Key storage | OS-native keychain via Electron safeStorage API |
| Key migration | Transparent upgrade from file-based to keychain-protected keys |
| Key rotation | `PRAGMA rekey` support with backup/restore workflow |
| Fallback | File-based key with 0o600 permissions if OS keychain unavailable |

### 3.2 Authentication & Session Management

| Control | Implementation |
|---|---|
| Password hashing | bcrypt with configurable salt rounds |
| Password policy | Minimum 12 characters, uppercase, lowercase, digit, special character |
| Account lockout | 5 failed attempts triggers 15-minute lockout |
| Session expiration | Configurable timeout with automatic invalidation |
| Session binding | Bound to Electron WebContents ID to prevent session riding |
| First-login enforcement | Default admin must change password on first login |

### 3.3 Access Control

| Control | Implementation |
|---|---|
| Model | Role-Based Access Control (RBAC) |
| Roles | Admin, Coordinator, Surgeon, Viewer (and custom) |
| Enforcement point | Server-side IPC handlers (cannot be bypassed from renderer) |
| Entity-level permissions | All CRUD operations check `hasPermission()` before execution |
| Organization isolation | Multi-tenant with strict `org_id` scoping on all queries |
| PHI access justification | Required justification logging for sensitive data access |

### 3.4 Network & Transport Security

| Control | Implementation |
|---|---|
| Network exposure (desktop core) | No outbound call is made by any clinical or operational feature. The application is usable end to end with no network. |
| Network exposure (optional paths) | Four paths exist and are enumerated in §1: the server tier, the remote log sink, the SIEM forwarder and auto-update. The first three are off by default; auto-update is on in enterprise builds. |
| Remote log sink payload | Level, ≤256-character message, an allowlist of five metadata keys, platform, PID. PHI redacted at the sink, fail-safe: if redaction throws, the content is dropped rather than written through. |
| Crash reporting | `crashReporter` `submitURL` is empty — minidumps are stored locally and never submitted. |
| Content Security Policy | Strict CSP headers on all renderer windows |
| Navigation restrictions | External navigation and popup creation blocked |
| DevTools | Disabled in packaged production builds |
| Web security | `webSecurity: true`, `contextIsolation: true`, `nodeIntegration: false` |

### 3.5 Infrastructure Security

| Control | Implementation |
|---|---|
| Rate limiting | All IPC handlers rate-limited (global middleware) |
| Input validation | Parameterized SQL queries, entity name whitelist, ReDoS-safe patterns |
| Structured logging | JSON log files with rotation (10 MB, 5 files) |
| Crash reporting | Electron crashReporter with local-only dump storage |
| Dependency management | All versions pinned (no caret ranges), `npm ci` in CI |

---

## 4. Regulatory Compliance

> **Status terminology.** "Implemented (self-assessed)" means the control
> exists in the shipping code and has been verified by the vendor's own
> automated tests and review. Independent third-party assessment
> (security audit / compliance attestation) has **not yet** been
> performed; buyers should treat these rows as vendor claims pending
> external validation.
>
> **What "designed for alignment with" does and does not mean.** These tables
> map product controls to regulatory requirements. They do not assert that any
> organization is compliant with those regulations, and they are not a
> substitute for that organization's own determination. See
> [`compliance/HIPAA_SECURITY_RULE_MAPPING.md`](compliance/HIPAA_SECURITY_RULE_MAPPING.md)
> and [`compliance/PART_11_CONTROL_MAPPING.md`](compliance/PART_11_CONTROL_MAPPING.md)
> for the control-by-control mappings, and
> [`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md) for what is not
> covered.

### 4.1 HIPAA Technical Safeguards (45 CFR § 164.312)

| Requirement | Status | Implementation |
|---|---|---|
| Access Control (§164.312(a)) | Implemented (self-assessed) | RBAC with per-entity permission enforcement |
| Audit Controls (§164.312(b)) | Implemented (self-assessed) | Immutable audit logs with WHO/WHAT/WHEN/WHERE |
| Integrity Controls (§164.312(c)) | Implemented (self-assessed) | Database triggers prevent audit log modification |
| Transmission Security (§164.312(e)) | N/A (desktop) / Implemented (server tier) | Desktop is offline; the optional server tier enforces TLS |
| Authentication (§164.312(d)) | Implemented (self-assessed) | bcrypt password hashing, account lockout, session management |

### 4.2 FDA 21 CFR Part 11

| Requirement | Status | Implementation |
|---|---|---|
| §11.10(e) Audit trail | Implemented (self-assessed) | Append-only `audit_logs` with database-trigger immutability, a SHA-256 hash chain, a keyed HMAC in OS secure storage, and a monotonic per-organization sequence |
| §11.10(a) Record integrity | Implemented (self-assessed) | SQLCipher encryption, startup integrity check, HMAC integrity on license data |
| §11.50 Signature manifestation | Implemented (self-assessed) | `electron/services/electronicSignature.cjs` `signRecord()` binds signer identity, the declared meaning, the entity, a hash of the payload at signing, and an ISO 8601 timestamp |
| §11.200 Electronic signature components | **Not implemented** | The signing ceremony relies on the authenticated session; it does not require two distinct identification components at the moment of signing, and the record is not a PKI digital signature. See [`compliance/PART_11_CONTROL_MAPPING.md`](compliance/PART_11_CONTROL_MAPPING.md) §11.200 and [`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md) RR-13. |

### 4.3 AATB Standards

**Not claimed.** No mapping to AATB Standards for Tissue Banking exists in
this repository, and none is asserted. The previous revision of this section
listed donor tracking, traceability and data retention as "Implemented
(self-assessed)" against AATB, which was a claim without a mapping behind it.
Removing an unsupported claim is preferable to inventing a mapping to justify
it. A deploying tissue bank requiring AATB alignment must perform that mapping
against its own accreditation requirements.

### 4.4 Server tier — early access

The optional server tier is **early access** and is qualified to a lower
standard than the desktop application. Its 27 unit suites (312 tests) executed
and passed; its integration suites require a running PostgreSQL instance and
did not run. Row-level security is verified at the DDL and application-query
level but has not been observed being enforced by a live engine. See
[`compliance/VALIDATION_PLAN.md`](compliance/VALIDATION_PLAN.md) §2.2 and
[`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md) entries RR-04 and
RR-14.

---

## 5. Testing & Quality Assurance

### 5.1 Automated test suites — as executed on 2026-08-02

These are measured counts from the release verification run recorded in
[`compliance/executed/OQ_TT-OQ-001.md`](compliance/executed/OQ_TT-OQ-001.md),
not estimates.

| Runner | Files | Assertions / tests | Result |
|---|---:|---:|---|
| Desktop Node suites (`npm test`, `core` group) | 62 | 1058 recorded | 62/62 suites passed |
| Server unit suites (Vitest) | 27 | 312 | 27/27 files, 312/312 tests passed |
| Renderer component suites (Vitest) | 17 | 137 | 17/17 files, 137/137 tests passed |
| **Total** | **106** | **1507** | **No failure** |

Selected coverage, with observed assertion counts:

| Area | Assertions | Suite |
|---|---:|---|
| Cross-organization isolation and injection prevention | 13 | `tests/cross-org-access.test.cjs` |
| Business logic: priority scoring, donor matching, FHIR validation, HLA matching, password validation | 43 | `tests/business-logic.test.cjs` |
| Compliance controls, including PHI written through the production cipher profile and read back off disk | 33 | `tests/compliance.test.cjs` |
| Calculators (MELD / MELD-Na / MELD 3.0 / KDPI / EPTS / TTLI) | 29 | `tests/calculators.test.cjs` |
| Clinical constants asserted against their controlled sources | 35 | `tests/calculatorReferenceVectors.test.cjs` |
| Clinical validation at every ingest boundary | 17 | `tests/clinicalValidation.test.cjs` |
| Audit chain, fail-closed writer, HMAC, immutability, key gating, export | 122 | six `tests/audit*.cjs` suites |
| PHI justification, leakage, logger and SIEM redaction, support bundles | 83 | seven suites |
| SMART patient-compartment isolation | 29 | `server/test/unit/patientCompartment.test.mjs` |
| Inactivation risk engine | 37 | `tests/inactivationRiskEngine.test.cjs` |
| Renderer components | 137 | `tests/components/` |

**PELD is not covered, because PELD is not computed.** The lung instrument
covered above is the TransTrack Lung Triage Index, not the OPTN Lung
Allocation Score. See §4.4 and `compliance/RESIDUAL_RISK.md` RR-01 and RR-07.

### 5.2 CI/CD Pipeline

| Stage | Tool | Behavior |
|---|---|---|
| Dependency audit | `scripts/audit-with-exceptions.mjs` | Blocks on any finding at moderate or above that is not covered by a reviewed, unexpired, advisory-specific exception. Also blocks on a severity increase beyond what the exception assessed, and on a stale exception matching no real finding. |
| Linting | ESLint | Blocks on code quality violations |
| Lockfile integrity | `npm ci` | Ensures deterministic builds |
| Unit/integration tests | Node.js test runner + Vitest | All 1507 assertions across 106 files must pass |
| Validation package consistency | `scripts/check-compliance-docs.mjs` | Blocks on a duplicate requirement id, an untraced requirement, or a dangling SDS, OQ or risk reference |
| Security scanning | CodeQL (GitHub) | Automated code analysis |
| SBOM generation | CycloneDX | Software Bill of Materials for each distribution build. **No SBOM has been produced for 1.3.0**, because no distribution build can be produced until signing credentials are procured. |

### 5.3 Additional Test Infrastructure

- Load testing suite for performance validation
- Playwright E2E test framework configured
- Security-specific test suite (cross-org access, injection prevention)

---

## 6. License & Distribution Model

### 6.1 Signed per-customer licenses with trial fallback

TransTrack ships with a cryptographic licensing system
(`electron/license/`). Each customer receives a unique Ed25519-signed
license file (`LIC1.` prefix) encoding organization, tier, expiry,
user/patient/install limits, feature flags, and optional machine binding.
With no license file present, the application runs a **30-day
full-feature trial**, after which creation paths lock (reads remain
available) until a license is activated.

### 6.2 Runtime states

The license manager (`electron/license/manager.cjs`) resolves one of five
states at launch: `trial`, `trial_expired`, `active`, `in_grace`, or
`invalid` (signature failure, machine mismatch, or expiry past grace).
Signature verification, machine binding, and expiration tracking are
enforced in the running code path. Operational procedures — issuing
licenses, rotating the publisher keypair, handling verification failures —
are documented in `docs/LICENSING.md`.

---

## 7. Data Management

### 7.1 Database Schema

47 tables in a fully migrated database (schema creation plus 19 migrations;
observed during the 1.3.0 Installation Qualification), covering:
- **Clinical:** Patients, Donors, Organs, Matches, Barriers, Evaluations, Labs,
  AHHQ records, Living-donor evaluations, Post-transplant follow-ups
- **Operational:** Organizations, Users, Sessions, Settings, Notifications,
  Reports, Tasks, Coordinator panels, Organ-offer state machine
- **Compliance:** Audit Logs (immutable, trigger-protected), Access
  Justification Logs, Schema Migrations, Authentication-failure log,
  Password history, MFA secrets, SIEM forwarder queue

### 7.2 Migration System

| Feature | Implementation |
|---|---|
| Versioned migrations | Sequential version numbers with named migrations |
| Transaction safety | Each migration runs in a SQLite transaction |
| Rollback support | Stored rollback SQL for each migration |
| Status tracking | `schema_migrations` table records applied versions |
| Diagnostics | `getMigrationStatus()` API for admin inspection |

### 7.3 Backup & Recovery

- Encryption key backup alongside primary key
- Database file is a single portable `.db` file
- Key rotation with `PRAGMA rekey` preserves data integrity
- A verified pre-migration copy is written before any pending migration runs;
  migration is refused outright if that copy cannot be written
- Disaster recovery procedures documented in [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md),
  which is the single normative source for RTO and RPO
- **No restore drill has been executed for this release** (RR-11). The stated
  RTO and RPO are objectives, not demonstrated capabilities.

---

## 8. Documentation

The following documentation is maintained in the `docs/` directory:

| Document | Purpose |
|---|---|
| HIPAA Compliance Matrix | Maps HIPAA requirements to implementations |
| Threat Model | Attack surface analysis and mitigations |
| Disaster Recovery | Backup/restore and incident procedures |
| Encryption Key Management | Key lifecycle and rotation procedures |
| API Security | IPC handler security model |
| API Reference | Complete handler documentation |
| Architecture | System design and data flow |
| Operations Manual | Day-to-day administration guide |
| Deployment Checklist | Production deployment steps |
| Deployment (Production) | Infrastructure requirements |
| Incident Response | Security incident procedures |
| User Guide | End-user documentation |
| Licensing | License activation and management |
| HIPAA BAA Requirements | Business Associate Agreement guidance |
| Test Data Provenance | Records that no tracked fixture contains real PHI, and where each fixture came from |
| Legal (`legal/README.md`) | Index of product legal documents; records that commercial material is maintained outside this repository |
| Operator Runbook (`RUNBOOK.md`, repository root) | Day-one operational procedures and the index of every other operational procedure |

The validation package lives in [`compliance/`](compliance/) and is indexed by
[`compliance/README.md`](compliance/README.md). `docs/VALIDATION_ARTIFACTS.md`
is **withdrawn**; it now carries only a superseding notice.

---

## 9. Deployment & Operations

### 9.1 Supported Platforms

| Platform | Format | Architecture |
|---|---|---|
| Windows 10/11 | NSIS installer (.exe) | x64 |
| macOS 12+ | DMG | x64, ARM64 (Apple Silicon) |
| Linux | AppImage, .deb | x64 |

### 9.2 Auto-Update Infrastructure

- Enterprise builds include `electron-updater` for automatic update delivery
- Updates distributed via GitHub Releases (configurable)
- Update code signature verification supported (requires signing certificate)

### 9.3 Logging & Monitoring

| Feature | Implementation |
|---|---|
| Log format | Structured JSON with timestamps, PIDs, and log levels |
| Log rotation | 10 MB per file, 5 files retained |
| Log location | `{userData}/logs/transtrack.log` |
| Crash dumps | Electron crashReporter, stored locally |
| Uncaught exceptions | Captured and logged as `fatal` level |

---

## 10. Known Limitations & Roadmap

### 10.1 Pre-Sale Requirements

These items should be completed before first customer delivery:

| Item | Status | Residual risk |
|---|---|---|
| Code signing certificate (Windows) + Apple Developer enrollment | **Pending procurement.** Signing and notarization logic is implemented and fails closed — a distribution build refuses to emit an unsigned artifact — but no signed installer can be produced today. | RR-10 |
| SBOM for the release evidence pack | **Not produced.** Generation runs in the distribution build, which is blocked on the item above. | RR-10 (deviation D-07) |
| Site Performance Qualification | **Not executed**, for this or any prior release. Requires clinical users, site data and site infrastructure. | RR-05 |
| Host Installation Qualification | **Not executed.** 16 host-specific steps enumerated with executing parties. | RR-06 |
| Independent penetration test / SOC 2 | **Not performed.** Scope and vendor checklist prepared; internal assessment executed. | RR-09 |
| Disaster recovery drill | **Not executed** for this release. RTO and RPO are objectives, not demonstrated capabilities. | RR-11 |
| Role-based security disclosure address on the product domain | **Not provisioned.** Channel, SLA and escalation path are documented; the domain is not registered. | RR-15 |
| HIPAA Business Associate Agreement (template) | Guidance documented; legal review pending. | — |

The full set, with compensating controls and closure criteria for each, is in
[`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md).

### 10.2 Future Enhancements

| Feature | Priority | Description |
|---|---|---|
| PELD | High | Blocked on obtaining OPTN Policy 9.1.E Table 9-1 coefficients from the controlled document (RR-01) |
| §11.200-compliant electronic signature ceremony | High | Two distinct identification components at the moment of signing (RR-13) |
| Server tier general availability | High | Requires PostgreSQL in CI, executed integration suites and live RLS verification (RR-04, RR-14) |
| Full OPTN KDPI / EPTS percentile tables | Medium | Replaces the shipped piecewise approximations (RR-03) |
| Multi-language support (i18n) | Medium | Localization for international markets |
| Biometric authentication | Medium | Windows Hello / Touch ID integration |
| Advanced analytics dashboard | Medium | Statistical analysis and trend visualization |
| Cloud sync (optional) | Low | Encrypted cloud backup for multi-site deployments |

---

## 11. Risk Assessment

This section is a summary. The controlled analyses are
[`compliance/RISK_REGISTER.md`](compliance/RISK_REGISTER.md) (28 hazards,
ISO 14971 style), [`compliance/FMEA.md`](compliance/FMEA.md) (30 failure modes
with severity / occurrence / detection scoring) and
[`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md) (16 accepted
residual risks with closure criteria). A diligence reader should work from
those rather than from the table below.

| Risk | Severity | Mitigation |
|---|---|---|
| Local malware accessing database | Medium | SQLCipher encryption + OS keychain key protection |
| Lost encryption key | Medium | Key backup file, documented recovery procedures |
| Unauthorized data access | Low | RBAC + audit logging + org isolation |
| Supply chain attack via dependencies | Low | Pinned versions, an audit gate with expiring documented exceptions, SBOM generation at release |
| Data loss | Medium | Single-file database, verified pre-migration copies, documented backup procedures. **No restore drill has been executed** (RR-11). |
| Residual PHI after secure delete on SSD or copy-on-write storage | Medium | Three-pass overwrite plus full-disk encryption as a mandatory deployment control. Highest RPN in the FMEA (FM-12, 336). |
| RLS inert under a bypassing PostgreSQL role | Medium | Application-level `org_id` scoping applies independently. Not verifiable without a live database (FM-29, RPN 189). |
| License circumvention | Low | Ed25519 signature verification with optional machine binding; the private signing key is never distributed with the application. |

---

## 12. Summary

TransTrack 1.3.0 implements a defence-in-depth control set appropriate for an
application handling PHI:

- **1507 assertions across 106 test files**, all passing on 2026-08-02, covering
  security, clinical correctness, business logic, the operational scoring
  engine, the server tier's unit surface, and renderer components
- **AES-256 encryption** with OS-keychain key protection, verified by reading
  PHI back off the filesystem rather than by inspecting configuration
- **Role-based access control** enforced at the IPC handler level, with a PHI
  justification grant required for bulk reads
- **Immutable, hash-chained audit trail** with a fail-closed writer, a keyed
  HMAC, database-trigger immutability and a monotonic per-organization sequence
- **Offline-first core** with four optional egress paths, each enumerated in §1
  and each a disclosure decision the deploying organization makes
- **Multi-tenant isolation** with `org_id` scoping at the query level
- **CI/CD pipeline** with a blocking dependency gate, a blocking validation
  package consistency gate, and release signing that fails closed

**What a buyer should weigh against that.** Vendor software verification is
complete; **site qualification is not, and no Performance Qualification exists
for any release**. No signed installer can be produced until code-signing
credentials are procured. No independent penetration test has been performed.
No disaster recovery drill has been executed. The server tier is early access.
PELD is unavailable. The inactivation risk engine is not clinically validated.
These are stated in full, with closure criteria, in
[`compliance/VALIDATION_SUMMARY_REPORT.md`](compliance/VALIDATION_SUMMARY_REPORT.md)
§7 and [`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md).

The codebase is engineering-complete for the desktop application. The
outstanding items are a mixture of procurement (signing certificates,
insurance, an independent assessment) and activities that only a deploying
site can perform (IQ on a host, interactive OQ, PQ, a restore drill).
Characterising the remainder as "procurement tasks, not engineering work",
as an earlier revision of this document did, understated it.

---

*This document was prepared for technical due diligence purposes. Direct
questions to `support@transtrack.example`; security matters to
`security@transtrack.example`. See [`../SECURITY.md`](../SECURITY.md) for the
disclosure policy, response SLA and the current provisioning status of those
addresses.*
