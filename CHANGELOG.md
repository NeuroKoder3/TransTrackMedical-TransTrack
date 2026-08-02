# Changelog

All notable changes to TransTrack are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Azure Artifact Signing

- **`TRANSTRACK_SIGN_MODE=azure`.** Microsoft's cloud signing service, roughly
  $10/month, with no certificate to buy, no hardware token, and no annual
  re-issue. `signtool` loads `Azure.CodeSigning.Dlib.dll`, which authenticates
  to Azure and has the signature produced server-side, so no private key is
  ever on the build machine. The release workflow detects the mode from the
  secrets present and installs the client tools on the runner.
- Two behaviours worth knowing rather than discovering. Artifact Signing
  certificates are valid for **three days**, so the signer always timestamps
  against Microsoft's authority — an untimestamped installer verifies for three
  days and then starts failing on customer machines with nothing about the file
  having changed. And `DefaultAzureCredential`'s chain includes a browser
  prompt that would hang a headless build, so the signer narrows the chain to
  the service principal when one is present, and otherwise excludes only the
  browser so federated identity still works.
- The two common Azure failures both surface from `signtool` as a generic
  `SignerSign()` error. A 403 now says it is probably a region mismatch or a
  missing signer role; a dlib load failure now says it is probably a missing
  .NET 8 runtime or an x64/x86 mismatch.

### Fixed — release signing

- **A release build can no longer emit an unsigned artifact.** Both
  `sign-win.cjs` and `notarize.cjs` warned and returned whenever a credential
  was missing. That is right for a developer build and wrong for a release: the
  build went green, the warning scrolled past in electron-builder's output, and
  nobody found out until a customer's machine refused the download. When
  `TRANSTRACK_RELEASE_CHANNEL=public` (set by `release.yml` on both build jobs),
  or `TRANSTRACK_REQUIRE_SIGNING` / `TRANSTRACK_REQUIRE_NOTARIZATION` is set,
  the build now fails and names the missing variable.
- **The release gate now inspects the installer instead of its filename.**
  "Code-signed Windows installer present" was satisfied by any file matching the
  expected name. `scripts/verify-artifact-signature.mjs` reads the artifact: the
  OS verdict via `Get-AuthenticodeSignature` on Windows, the PE Attribute
  Certificate Table elsewhere, with the weaker assurance labelled as such rather
  than overstated. A catalog-only signature is rejected — Windows calls it
  valid, but it lives outside the file and so cannot reach the receiving site.
- **`pfx` mode works in CI.** `CSC_LINK` was treated strictly as a filesystem
  path, but a certificate in a CI secret is base64 bytes. Base64 content is now
  written to a temporary file with owner-only permissions and removed in a
  `finally` block.
- **`ssl_esigner` mode works in CI.** The workflow never set
  `ESIGNER_TOOL_PATH` and never installed CodeSignTool, so the mode could not
  have signed anything. Both are now handled, and a missing `ESIGNER_TOOL_URL`
  fails the job rather than yielding an unsigned build.
- **Notarization diagnoses the likely credential mistake.** Apple's own term is
  "app-specific password", and `docs/DEPLOYMENT_PRODUCTION.md` said
  `APPLE_APP_SPECIFIC_PASSWORD`, while the hook reads `APPLE_APP_PASSWORD`. The
  doc is corrected, and the hook now says so by name when it finds the longer
  spelling set.
- **`tests/signWin.test.cjs` never awaited its async cases**, so every
  `assert.rejects` counted as a pass without running. The harness is now
  async-aware, and the suite covers mode selection, fail-closed behaviour, and
  certificate materialisation. New: `tests/notarize.test.cjs` and
  `tests/artifactSignature.test.mjs`, the latter parsing synthetic PE images on
  every platform and, on Windows, checking a genuinely signed binary and a
  catalog-signed one.

### Changed — code signing guidance

- **EV is no longer recommended by default.** The guidance to buy EV rested on
  it granting immediate SmartScreen reputation; Microsoft removed that
  behaviour, and OV now gives the same first-download experience. The docs now
  recommend Azure Artifact Signing (~$10/month) or an OV certificate with cloud
  HSM signing, and note that since June 2023 all code signing keys — OV
  included — must live in hardware, so a copyable `.pfx` is no longer issuable.

### Fixed

- **Support bundle log tail no longer loses a race with log rotation.**
  `readLogTail()` checked a path for existence and size and then opened it.
  `logger.cjs` rotates those same files, so the log could be renamed in
  between — costing a section of the diagnostics, or pairing one file's size
  with another's bytes. It now opens once and measures the descriptor.
- **`supportBundle.test.cjs` no longer requires an installed Electron
  binary.** It loaded `logger.cjs`, which destructures `app` at module scope,
  so the suite passed locally and failed in CI, where the binary download is
  skipped. It now stubs `electron` the way the neighbouring suites do.

### Changed — validation package

- **Chart filing requirements renumbered TT-R137–R142 → TT-R150–R155.** The
  original numbering collided with the pre-existing cross-cutting
  requirements TT-R140–R142. Corrected before any site executes an OQ against
  these ids.
- **SDS extended** with §11 migration safety, §12 diagnostics and PHI
  redaction, §13 the IOTA notification pipeline, §14 chart filing, §15
  dependency vulnerability exceptions, and §16 renderer bridge integrity.
  Sections are appended rather than interleaved so existing §-references stay
  valid.
- **OQ protocol extended** with 32 executable test cases covering the IOTA
  pipeline, chart filing, migration safety, and support bundles — including
  the adversarial one that matters: plant a patient name in free text, export
  a default bundle, and search the file for it.
- **Release authenticity added to the validation package** as TT-R146 and
  TT-R147, SDS §17, R-028, and OQ-146/147 — the last of which has the receiving
  site verify the installer's signature themselves before installing it.
- **Risk register extended** with R-020 to R-027 (missed notification
  deadline, duplicate or misfiled chart document, bundle PHI leakage, notice
  altered after filing, template missing a statutory element, stale
  vulnerability exception, feature unwired in the packaged build). R-013's
  mitigation was revised: transactional rollback does not cover a
  multi-migration sequence that fails partway, which the pre-migration copy
  now does.
- **`scripts/check-compliance-docs.mjs`** — the cross-references between
  these documents are now machine-verified and run in the standard test
  suite. The requirement-id collision above survived review of both documents
  because neither is wrong when read alone; this is the check that catches
  that class of defect. It also found four requirements with no matrix row,
  now traced.

## [1.2.1] - 2026-08-01

Pilot-readiness release. Apart from the IOTA notification pipeline below,
every item is a defect fix or a safety control; there are no breaking
changes.

### Added — CMS IOTA § 512.442(d) notification pipeline

The notice generator shipped previously but nothing could reach it. It is
now a working obligation tracker, end to end.

- **`electron/services/iotaNoticeService.cjs`** — recording a waitlist
  status transition whose impact blocks organ offers creates the
  notification obligation in the same operation, so a duty cannot exist
  without a tracked deadline. Where the centre's template is not yet
  configured the transition is still recorded and the obligation is
  reported as unmet: the transition is what proves when the statutory
  clock started, and discarding it would be far worse than a missing
  notice.
- **Delivery tracking** that distinguishes a notice delivered *late* from
  one delivered on time, and from one still open. A surveyor asks
  different questions about each, so they are counted separately rather
  than collapsed into a single "done".
- **Incomplete-address detection** — where a copy is owed to a dialysis
  facility or referring provider but none is on file for the patient, the
  obligation is flagged rather than presented as discharged.
- **Migration 18** retains the rendered notice body. Migration 17 stored
  only the content hash on the theory that a deterministic generator makes
  the body reproducible, which holds only until a centre edits its
  template — leaving no way to reprint a filed notice for the patient who
  asks for a copy. The hash remains authoritative and frozen, so an
  altered body is still detectable.
- **`electron/ipc/handlers/iota.cjs`** — eleven org-scoped channels.
  Configuration is administrator-only, obligation and delivery writes are
  administrator or coordinator, physicians and regulators may read. Every
  write is audit-logged.
- **`src/pages/IotaCompliance.jsx`** — leads with what is wrong (overdue,
  obligations with no notice, unnamed recipients) rather than a reassuring
  total, because the failure mode that matters is a deadline quietly
  passing.

### Added — Epic chart filing (DocumentReference)

- **`electron/services/chartFiling.cjs`** builds the FHIR R4
  `DocumentReference` that records a notice in the patient's chart, in three
  modes: `dry_run` (build and validate, transmit nothing), `manual` (filed
  by another route), and `fhir_documentreference` (a real create).
- **Outbound transmission requires an injected transport.** No configuration
  value alone can cause this offline-first application to reach an external
  endpoint; a security reviewer can establish that by reading the module.
- **A body that no longer matches its frozen hash is refused**, so an altered
  document cannot be written into a chart under the authority of a record
  saying it was not altered.
- **`fhirPost` / `createDocumentReference`** added to the Epic client
  (`server/src/integrations/epic/client.js`). Unlike `fhirGet` it does not
  retry: Epic may persist a resource before a response fails, so replaying a
  create can file a second copy of a clinical document. The notification
  idempotency key travels in `DocumentReference.identifier` so a site can
  reconcile what was filed.
- `system/DocumentReference.write` is **excluded from the default scopes**.
  Requesting write access an application does not use fails customer security
  review; callers opt in explicitly. `server/src/integrations/epic/README.md`
  documents the four steps a pilot site's Epic team must complete, and the
  HL7 `MDM^T02` alternative that avoids write scopes altogether.

### Fixed — release blockers

- **Renderer production build restored.** The source `index.html` had been
  overwritten by a build artifact and referenced a hashed bundle that no
  longer existed, so the application could not be packaged for
  distribution at all. Guarded by `tests/buildEntryIntegrity.test.mjs`.
- **Disaster Recovery reconnected.** The UI called `createBackup`,
  `verifyBackup` and `restoreBackup`, but the Electron client exposed only
  `getStatus` and `listBackups`, leaving those controls inert in packaged
  builds. Now wired end to end and exercised by a live backup/restore
  round trip in the e2e critical path.
- **Migrations no longer crash on partial databases.** `PRAGMA
  table_info()` returns an empty result for a missing table, so eight
  migrations passed their column guard and then failed on the follow-on
  `ALTER TABLE`. Fixed systemically with `addColumn()`/`tableExists()`
  helpers rather than patching the single migration that surfaced it.
- **Application version is read, not hardcoded.** `app:getInfo` and
  `app:getVersion` returned a literal `'1.2.0'`, which would drift from
  `package.json` on any release bump and disagree with the integrity
  monitor's `app.getVersion()` upgrade check.

### Added — operational safety

- **Pre-migration backup** (`electron/database/migrationSafety.cjs`) — a
  verified copy of the database is taken before any pending migration
  runs, and startup fails closed if that copy cannot be made. Previously a
  migration failing midway left the database partially upgraded with no
  restore point.
- **System Health page** (`src/pages/SystemHealth.jsx`) with per-component
  status, migration state, and support-bundle export — surfaces the
  diagnostics the pilot runbook already documented but which had no UI.
- **PHI-safe support bundles** (`electron/services/supportBundle.cjs`,
  `electron/services/phiRedaction.cjs`) — free-text fields are withheld by
  default rather than pattern-scrubbed, because name redaction in prose is
  not reliable. An explicit `includeFreeText` opt-in exists and labels the
  bundle as potentially containing PHI.
- **Auditable vulnerability exceptions**
  (`scripts/audit-with-exceptions.mjs`, `security/vulnerability-exceptions.json`)
  — findings may be waived only with a written justification and an expiry
  date; the gate fails on undocumented, expired, stale, or newly escalated
  advisories.

### Added — regression guards

- `tests/rendererBridgeCoverage.test.mjs` checks every `api.<ns>.<method>()`
  call in the renderer against the real preload surface, closing the class
  of defect that made Disaster Recovery unreachable.
- The Playwright suites now pass the initial administrator password into
  the app they launch. Previously it was set only at the CI workflow
  level, so the e2e tests could not run on a developer machine — which is
  how the broken build reached the repository unnoticed.

## [1.2.0] - 2026-04-29

### Added — inactivation prevention

- **Inactivation Prevention Action Queue** (`electron/services/inactivationActionQueue.cjs`)
  — pure-function service that ranks the entire active waitlist into a
  Top-N coordinator action queue with one concrete recommended
  intervention per patient, urgency multiplier (eval-expiry boost),
  coordinator-overload detection, and aggregate "if every recommended
  action is executed, expected inactivations avoided in 90 days"
  projection. 20 unit tests.
- **Prevention Outcomes** (`electron/services/preventionOutcomes.cjs`)
  + `prevention_interventions` table — every coordinator action is
  logged with the engine score AT THE MOMENT OF ACTION (inputs
  fingerprint and model version pinned), the measured "after" score on
  re-assessment, and rolled-up center-level effectiveness per
  intervention type. This is the proof-of-prevention dataset for
  quarterly reviews and acquirer diligence. 12 unit tests.
- **Alert Rules Engine** (`electron/services/inactivationAlertRules.cjs`)
  — seven-rule pure-function catalog (PATIENT_ENTERED_CRITICAL,
  EVAL_EXPIRED, EVAL_EXPIRING_SOON, HIGH_BARRIER_OPENED, SCORE_JUMPED,
  CONTACT_LAPSED, AHHQ_EXPIRED) with stable alert-envelope shape ready
  for in-app banners, SIEM forward, or CDS Hooks consumption. 18 tests.
- **Prevention Digest** (`electron/services/preventionDigest.cjs`) —
  thin composition layer that combines action queue, projection, and
  intervention effectiveness into a single manager-dashboard snapshot
  for quarterly reviews. 5 tests.
- IPC channels `actionQueue:*` (build, top interventions for patient,
  recordIntervention, recordOutcome, getInterventionsForPatient,
  getInterventionEffectiveness, buildDigest) and the
  `window.electronAPI.actionQueue.*` preload bridge. Every channel is
  org-scoped, RBAC-enforced, and audit-logged.

### Added — enterprise readiness

- **Code-signing infrastructure** (`scripts/sign-win.cjs` +
  `electron-builder.enterprise.json` updates)
  - Windows Authenticode signer supporting three modes: SSL.com eSigner
    cloud HSM (recommended for CI), local PFX/signtool, and a deliberate
    skip mode for unsigned dev builds. Auto-detects mode from env vars.
  - RFC 6238 TOTP generator built in so the eSigner credential's TOTP
    secret can live in CI secrets without an external authenticator app.
  - `afterSign` hook wired to `scripts/notarize.cjs` and macOS
    `notarize: { teamId: $env.APPLE_TEAM_ID }` so notarization runs
    automatically once `APPLE_*` env vars are present.
  - `@electron/notarize` added as dev dep.
  - 8 unit tests for the signer.
- **Multi-tenant Epic configuration** (`server/src/integrations/epic/registry.js`)
  — per-`(orgId, environment)` resolver. Supports a JSON config file
  pointed to by `EPIC_CUSTOMERS_CONFIG`, per-customer env vars of the
  shape `EPIC_CLIENT_ID__<ORG_ID>__<ENV>`, and a generic single-tenant
  fallback. New `createEpicClientForCustomer` factory. 14 vitest tests.
- **Health Check service** (`electron/services/healthCheck.cjs`) —
  comprehensive snapshot (process, logger, database, encryption, risk
  engine, backups) with worst-of roll-up status, never-throws semantics,
  and a stable JSON envelope. New IPC channel `system:getHealth` and
  preload bridge. 6 unit tests.
- **Optional remote-log sink** in `electron/services/logger.cjs` —
  fires only when `SENTRY_DSN` or `TRANSTRACK_REMOTE_LOG_URL` is set,
  vendor-neutral, no new runtime dependency, default level filter is
  error+fatal.

### Added — documentation

- `docs/compliance/policies/BAA_TEMPLATE.md` — Business Associate
  Agreement template (subject to legal review; clearly disclaimed).
- `docs/compliance/HECVAT_PREFILL.md` — HECVAT 3.0 Lite pre-fill draft
  for hospital InfoSec questionnaires.
- `docs/CODE_SIGNING.md` — full setup guide for SSL.com eSigner +
  Apple notarization, including a CI matrix example and cost reference.
- `docs/ENVIRONMENT_VARIABLES.md` — every env var the system reads,
  organised by component.
- `docs/PILOT_DEPLOYMENT_RUNBOOK.md` — end-to-end pilot deployment
  guide (pre-flight, site setup, daily rhythm, retrospective,
  optional Epic add-on, escalation matrix).

### Changed

- `scripts/release-readiness-check.mjs` — gate now also enforces:
  presence of new compliance docs (BAA template, HECVAT pre-fill,
  code-signing, env-vars, pilot runbook); action queue model self-test;
  alert rules catalog completeness; signed Windows installer detection
  (any version, picks newest); supported code-signing mode detection
  (eSigner / PFX); macOS notarization env-var presence;
  `@electron/notarize` install presence.
- `package.json` — version bumped to 1.2.0; `npm test` script extended
  to cover the six new pure-function test files.
- `electron-builder.enterprise.json` — `afterSign` wired,
  `win.signtoolOptions.sign` points to the new signer, mac
  `notarize.teamId` consumes `$env.APPLE_TEAM_ID`.

## [1.1.0] - 2026-04-28

### Added
- **Inactivation Risk Engine v2** (`electron/services/inactivationRiskEngine.cjs`)
  — pure-function, deterministic, explainable scoring engine designed to
  prevent operational inactivation of waitlist candidates:
  - 8-factor weighted scoring (eval expiry, documentation, barriers, lab
    currency, aHHQ currency, status churn, contact recency, coordinator load)
  - Calibrated logistic probabilities of inactivation within 30 / 60 / 90 days
  - Full per-factor SHAP-style additive decomposition (factor → weight →
    weighted contribution → percent share of composite)
  - Counterfactual intervention simulation (`simulateIntervention`) — answers
    "if we resolve this barrier, the score drops from 78 to 41"
  - Center-level ROI projection (`projectCenterImpact`) returning expected
    inactivations avoided in 90 days and dollar value avoided
  - Reproducible: every assessment carries `modelVersion` and SHA-256
    `inputsFingerprint` so historical scores can be re-explained against
    the model that produced them
- IPC channels `inactivationRisk:*` (assessPatient, simulateIntervention,
  projectCenterImpact, getModelInfo) with org scoping, RBAC for center-level
  reports, and audit logging on every call
- Preload bridge: `window.electronAPI.inactivationRisk.*`
- 37-case unit test suite for the new engine — pure function, no DB required
  (`tests/inactivationRiskEngine.test.cjs`); includes a calibration-table
  regression test that fails the build if the engine's logistic constants
  drift away from the documented anchor table by more than ±3 percentage points
- `npm run release:check` — single-command release readiness gate that runs
  lint, typecheck, audit, tests, build, validates compliance-artefact
  presence, and produces a one-page pass/fail report
- `docs/INACTIVATION_RISK_ENGINE.md` — full technical specification
- `docs/STRATEGIC_FIT.md` — acquirer / partner positioning brief
- First-launch admin provisioning: `electron/database/init.cjs` now reads
  `TRANSTRACK_INITIAL_ADMIN_PASSWORD` from env when set (length ≥12), and
  otherwise generates a cryptographically random 24-character setup token,
  writing it to `userData/INITIAL_ADMIN_PASSWORD.txt` (mode `0o600` on POSIX)
  and to a clearly-delimited stdout banner. The seeded admin account always
  has `must_change_password = 1`. There is no shipped, build-time-known
  default password.
- CI E2E workflow now sets `TRANSTRACK_INITIAL_ADMIN_PASSWORD` so the
  Playwright login step is deterministic without depending on the random
  setup token

### Changed
- Logistic calibration coefficients in the Inactivation Risk Engine were
  re-fit (ordinary least squares in logit-space) so that the documented
  anchor table in `docs/INACTIVATION_RISK_ENGINE.md` matches the engine
  output within ±3 percentage points. The earlier closed-form fit was
  materially off-anchor and is now regression-tested.
- README technology stack now correctly states Electron 39 (was 35)
- README explicitly documents the optional Fastify + PostgreSQL server
  tier (FHIR R4, SMART on FHIR v2, CDS Hooks 1.1, MLLP/TLS HL7 v2)
- DUE_DILIGENCE.md refreshed: 27 tables (was 22), ~280 tests (was 87),
  Electron 39, server tier disclosed, license section truthfully states
  that `electron/license/` is now a no-op stub (the previous "dormant
  scaffolding for OEM resale" description was misleading — the modules
  explicitly declare the licensing system has been removed)
- USER_GUIDE.md, DEPLOYMENT_PRODUCTION.md, and README.md describe the
  actual first-launch flow (token written to file + stdout, sign in as
  `admin@transtrack.local`, forced password change) rather than the
  "splash screen + email-picker form" the previous wording implied
- STRATEGIC_FIT.md tightened: the CDS Hook embedded inside Epic / Cerner /
  Ottr is correctly marked as roadmap (`docs/INACTIVATION_RISK_ENGINE.md`
  §9), not as a present capability; engine line-count claim corrected
  from ~530 to ~700

## [1.0.0] - 2026-04-11

### Added
- Waitlist dashboard with real-time patient prioritization and organ-specific scoring
- Operational risk engine scoring patients across evaluation expiry, documentation staleness, status churn, coordinator workload, and readiness barriers
- Readiness barrier tracking for non-clinical factors (insurance, logistics, social support)
- Transplant Clock for real-time operational pulse monitoring
- Configurable priority scoring (MELD, LAS, medical urgency, time-on-list) with adjustable weights
- Donor matching and simulation with HLA-based compatibility scoring and ranked recipient lists
- FHIR R4 EHR integration with data validation, export, push, webhook, and sync logging
- Lab results tracking for operational risk intelligence
- Adult Health History Questionnaire (aHHQ) tracking
- Outcomes dashboard for transplant outcome analysis
- Predictive risk analytics
- Task center for operational workflow management
- CMS readiness evaluation checklist
- Compliance center with automated validation against HIPAA, FDA 21 CFR Part 11, and AATB
- Disaster recovery with encrypted backup, verify, and restore workflows
- Notification system with configurable rules and priority levels
- Multi-organization architecture with enforced data isolation
- License management with evaluation and enterprise tiers (Starter, Professional, Enterprise)
- Pre-auth license activation flow for first-launch experience
- Auto-updater for enterprise builds via GitHub Releases

### Security
- AES-256 SQLCipher database encryption at rest with PBKDF2-HMAC-SHA512 key derivation
- Encryption key protection via Electron safeStorage (DPAPI/Keychain)
- Encryption key rotation with pre-rotation backup, PRAGMA rekey, and audit logging
- Role-based access control (RBAC) with break-the-glass emergency access
- Session management with DB validation, WebContents binding, idle timeout, and 8-hour expiry
- IPC rate limiting across all channels
- Immutable audit trail with database-enforced triggers
- Content Security Policy with object-src none, frame-ancestors none, and Permissions-Policy
- Electron hardening: context isolation, no node integration, no remote module, navigation/popup blocking, devtools disabled in production
- Production dependency audit at moderate+ severity in CI
- CodeQL and Snyk security scanning (blocking on findings)
- CycloneDX SBOM generation

### Infrastructure
- Electron 39 desktop runtime with dual build pipeline (evaluation + enterprise)
- React 18, Vite 6, Tailwind CSS, Radix UI component library
- 27-table SQLite schema with foreign keys, indexes, and migration support
- 86+ automated tests (Node integration, Vitest component, Playwright E2E)
- CI/CD with ESLint, npm audit, CodeQL, Snyk, SBOM, and Playwright E2E
- Cross-platform builds: Windows (NSIS x64), macOS (DMG x64/arm64 with notarization), Linux (AppImage/deb)
- macOS notarization via Apple Team ID for Gatekeeper compliance
- Dependabot for automated dependency updates
