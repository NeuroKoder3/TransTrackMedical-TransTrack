# Changelog

All notable changes to TransTrack are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- 33-case unit test suite for the new engine — pure function, no DB required
  (`tests/inactivationRiskEngine.test.cjs`)
- `npm run release:check` — single-command release readiness gate that runs
  lint, typecheck, audit, tests, build, validates compliance-artefact
  presence, and produces a one-page pass/fail report
- `docs/INACTIVATION_RISK_ENGINE.md` — full technical specification
- `docs/STRATEGIC_FIT.md` — acquirer / partner positioning brief

### Changed
- README technology stack now correctly states Electron 39 (was 35)
- README explicitly documents the optional Fastify + PostgreSQL server
  tier (FHIR R4, SMART on FHIR v2, CDS Hooks 1.1, MLLP/TLS HL7 v2)
- DUE_DILIGENCE.md refreshed: 27 tables, 270+ tests, Electron 39, server tier
- USER_GUIDE.md and DEPLOYMENT_PRODUCTION.md no longer ship a default
  administrator password; first-launch generates a one-time setup token
  shown on the splash screen instead
- DUE_DILIGENCE.md license section reconciled with public README — the
  public 1.0 distribution ships with all features unlocked; the tiered
  license-enforcement subsystem is dormant scaffolding for OEM resale

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
