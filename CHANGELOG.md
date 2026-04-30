# Changelog

All notable changes to TransTrack are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
