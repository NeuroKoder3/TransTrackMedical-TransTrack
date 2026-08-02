# TransTrack Traceability Matrix

Maps every requirement from `SYSTEM_REQUIREMENTS_SPECIFICATION.md` to its
design (`SOFTWARE_DESIGN_SPECIFICATION.md`), the implementing module(s), and the
verification artifact (test or OQ test case). Requirements not implemented in the
current software version are listed with their status rather than omitted, so
that the gap is visible rather than inferred from an absence.

`scripts/check-compliance-docs.mjs` enforces the cross-references below: unique
requirement ids, a matrix row for every requirement, a verification artifact for
every Mandatory requirement, and resolvable SDS, OQ and risk references.

| Req ID | Design § | Implementation | Verification |
|---|---|---|---|
| TT-R001 | §2, §9 | `electron/ipc/handlers/auth.cjs` | `tests/auth.test.cjs` |
| TT-R002 | §9 | `electron/services/passwordPolicy.cjs` | `tests/passwordPolicy.test.cjs` |
| TT-R003 | §9 | `electron/ipc/handlers/auth.cjs` (login_attempts) | `tests/auth.test.cjs` |
| TT-R004 | §9 | `electron/services/mfa.cjs`, `electron/ipc/handlers/mfa.cjs` | `tests/mfa.test.cjs` |
| TT-R005 | §9 | `electron/services/mfa.cjs` (backup codes) | `tests/mfa.test.cjs` |
| TT-R006 | §9 | `electron/services/passwordPolicy.cjs` | `tests/passwordPolicy.test.cjs` |
| TT-R007 | §9 | `electron/services/passwordPolicy.cjs` | `tests/passwordPolicy.test.cjs` |
| TT-R008 | §2 | `src/components/session/IdleTimeoutManager.jsx` | OQ-08 |
| TT-R009 | §2, §4 | `electron/database/schema.cjs` (users.role) | OQ-09 |
| TT-R010 | §3 | Not implemented — deferred beyond 1.2.1. The customer IdP is trusted for primary authentication only where SSO is deployed; TOTP remains the TransTrack-issued factor. | Deferred; no verification artifact in this version. |
| TT-R020 | §7 | `electron/ipc/shared.cjs` (logAudit) | `tests/services.test.cjs` |
| TT-R021 | §7 | `electron/ipc/shared.cjs` | `tests/services.test.cjs` |
| TT-R022 | §7 | `electron/database/schema.cjs` (triggers) | `tests/auditImmutability.test.cjs` |
| TT-R023 | §7 | `electron/ipc/handlers/auth.cjs` | `tests/auth.test.cjs` |
| TT-R024 | §7 | `electron/ipc/handlers/operations.cjs` | OQ-24 |
| TT-R025 | §7 | `electron/ipc/handlers/auth.cjs`, `electron/ipc/handlers/mfa.cjs` | `tests/mfa.test.cjs` |
| TT-R026 | §8 | `electron/services/siemForwarder.cjs`, `electron/ipc/handlers/siem.cjs` | `tests/siem.test.cjs` |
| TT-R040 | §2 | `electron/database/init.cjs`, `electron/services/encryptionKeyManagement.cjs` | OQ-40 (visual inspection of cipher) |
| TT-R041 | §2 | `electron/services/encryptionKeyManagement.cjs` | OQ-41 |
| TT-R042 | §2 | `electron/services/encryptionKeyManagement.cjs` | OQ-42 |
| TT-R043 | §2 | `electron/database/init.cjs` (integrity check) | OQ-43 |
| TT-R044 | §2 | `electron/ipc/handlers/operations.cjs` | OQ-44 |
| TT-R060 | §4 | `electron/database/schema.cjs` (patients) | OQ-60 |
| TT-R061 | §5 | `electron/services/calculators/*.cjs` | `tests/calculators.test.cjs` |
| TT-R062 | §5 | `electron/services/priorityWeighting.cjs` | OQ-62 |
| TT-R063 | §4 | `electron/services/readinessBarriers.cjs` | `tests/services.test.cjs` |
| TT-R064 | §4 | `electron/services/ahhqService.cjs` | `tests/services.test.cjs` |
| TT-R065 | §4 | `electron/services/labsService.cjs` | `tests/services.test.cjs` |
| TT-R066 | §6 | `electron/services/organOffers.cjs`, `electron/ipc/handlers/organOffers.cjs` | `tests/organOffers.test.cjs` |
| TT-R067 | §4 | `electron/services/postTransplant.cjs`, `electron/ipc/handlers/postTransplant.cjs` | `tests/postTransplant.test.cjs` |
| TT-R068 | §4 | `electron/services/livingDonor.cjs`, `electron/ipc/handlers/livingDonor.cjs` | `tests/livingDonor.test.cjs` |
| TT-R069 | §4 | `electron/services/hl7v2.cjs` | `tests/hl7v2.test.cjs` |
| TT-R070 | §4 | `electron/services/optnExport.cjs` | `tests/optnExport.test.cjs` |
| TT-R071 | §4, §13 | `electron/database/schema.cjs` (waitlist_status_transitions) | `tests/iotaNotifications.test.cjs`; OQ-71 |
| TT-R072 | §7, §13 | `electron/database/schema.cjs` (createWaitlistTransitionTriggers) | `tests/iotaNotifications.test.cjs`; OQ-72 |
| TT-R073 | §4, §13 | `electron/database/schema.cjs` (iota_notifications) | `tests/iotaNotifications.test.cjs`; OQ-73 |
| TT-R074 | §7, §13 | `electron/database/schema.cjs` (iota_notifications_frozen_fields) | `tests/iotaNotifications.test.cjs`; OQ-74 |
| TT-R075 | §13 | `electron/database/schema.cjs` (iota_notifications.idempotency_key), `electron/services/iotaNoticeGenerator.cjs` (idempotencyKey) | `tests/iotaNotifications.test.cjs`, `tests/iotaNoticeGenerator.test.cjs`; OQ-75 |
| TT-R076 | §13 | `electron/database/schema.cjs` (idx_iota_notif_org_due) | `tests/iotaNotifications.test.cjs`; OQ-76 |
| TT-R077 | §13 | `electron/services/iotaNoticeGenerator.cjs` (generateNotice, EXAMPLE_TEMPLATE) | `tests/iotaNoticeGenerator.test.cjs`; OQ-77 |
| TT-R078 | §13 | `electron/services/iotaNoticeGenerator.cjs` (validateTemplate, REQUIRED_TOKENS, OFFER_ELIGIBILITY_STATEMENT) | `tests/iotaNoticeGenerator.test.cjs`; OQ-78 |
| TT-R079 | §13 | `electron/services/iotaNoticeGenerator.cjs` (render, resolveSecondaryRecipient) | `tests/iotaNoticeGenerator.test.cjs`; OQ-79 |
| TT-R129 | §13 | `electron/services/iotaNoticeService.cjs` (recordTransition) | `tests/iotaNoticeService.test.cjs`; OQ-129 |
| TT-R130 | §13 | `electron/services/iotaNoticeService.cjs` (recordTransition, getComplianceSummary) | `tests/iotaNoticeService.test.cjs`; OQ-130 |
| TT-R131 | §13 | `electron/services/iotaNoticeService.cjs` (saveConfig) | `tests/iotaNoticeService.test.cjs`; OQ-131 |
| TT-R132 | §13 | `electron/services/iotaNoticeService.cjs` (markDelivered, decorate) | `tests/iotaNoticeService.test.cjs`; OQ-132 |
| TT-R133 | §13 | `electron/services/iotaNoticeService.cjs` (getComplianceSummary); `src/pages/IotaCompliance.jsx` | `tests/iotaNoticeService.test.cjs`; OQ-133 |
| TT-R134 | §13 | `electron/services/iotaNoticeService.cjs` (decorate.secondaryRecipientUnknown) | `tests/iotaNoticeService.test.cjs`; OQ-134 |
| TT-R135 | §13 | `electron/database/migrations.cjs` (v18); `electron/services/iotaNoticeService.cjs` (contentIntegrityOk) | `tests/iotaNoticeService.test.cjs`; OQ-135 |
| TT-R136 | §13 | `electron/ipc/handlers/iota.cjs` (requireRole, logAudit) | `tests/iotaNoticeService.test.cjs`; `tests/rendererBridgeCoverage.test.mjs`; OQ-136 |
| TT-R150 | §14 | `electron/services/chartFiling.cjs` (buildDocumentReference); `electron/services/iotaNoticeService.cjs` (fileToChart) | `tests/chartFiling.test.cjs`; OQ-150 |
| TT-R151 | §14 | `electron/services/chartFiling.cjs` (hash check in buildDocumentReference) | `tests/chartFiling.test.cjs`; OQ-151 |
| TT-R152 | §14 | `electron/services/chartFiling.cjs` (prepareFiling, mode `dry_run`) | `tests/chartFiling.test.cjs`; OQ-152 |
| TT-R153 | §14 | `electron/services/chartFiling.cjs` (injected `submit`); `electron/ipc/handlers/iota.cjs` | `tests/chartFiling.test.cjs`; OQ-153 |
| TT-R154 | §14 | `electron/services/chartFiling.cjs` (fileNotice error path); `iotaNoticeService.fileToChart` | `tests/chartFiling.test.cjs`; OQ-154 |
| TT-R155 | §14 | `electron/services/chartFiling.cjs` (mode `manual`) | `tests/chartFiling.test.cjs`; OQ-155 |
| TT-R080 | §4 | `electron/database/schema.cjs` (indexes) | PQ-80 |
| TT-R081 | §2 | `electron/database/init.cjs` (WAL) | PQ-81 |
| TT-R082 | §2 | `electron/services/disasterRecovery.cjs` | PQ-82 |
| TT-R083 | §2 | `electron/services/disasterRecovery.cjs` | PQ-83 |
| TT-R084 | §2, §11 | `electron/database/migrationSafety.cjs` (createPreMigrationBackup, runMigrationsSafely), `electron/database/init.cjs` | `tests/migrationSafety.test.cjs`; OQ-84 |
| TT-R085 | §11 | `electron/database/migrationSafety.cjs` (runMigrationsSafely fail-closed path) | `tests/migrationSafety.test.cjs`; OQ-85 |
| TT-R086 | §11 | `electron/database/migrationSafety.cjs` (error backupPath/reachedVersion) | `tests/migrationSafety.test.cjs`; OQ-86 |
| TT-R087 | §11 | `electron/database/migrationSafety.cjs` (pruneOldBackups), `electron/services/secureDelete.cjs` | `tests/migrationSafety.test.cjs`; OQ-87 |
| TT-R120 | §7 | `electron/ipc/auditReportHandler.cjs` | OQ-120 |
| TT-R124 | §7, §12 | `src/pages/SystemHealth.jsx`, `electron/services/healthCheck.cjs` | `tests/healthCheck.test.cjs`, `tests/rendererBridgeCoverage.test.mjs`; OQ-124 |
| TT-R125 | §12 | `electron/services/supportBundle.cjs` (collectBundle, writeBundle), `electron/ipc/handlers/operations.cjs` (support:exportBundle) | `tests/supportBundle.test.cjs`; OQ-125 |
| TT-R126 | §3, §12 | `electron/services/supportBundle.cjs` (withholdFreeText, skeletonLogLine), `electron/services/phiRedaction.cjs` | `tests/supportBundle.test.cjs`; OQ-126 |
| TT-R127 | §3, §12 | `electron/services/supportBundle.cjs` (redactionPolicy, includeFreeText), `src/pages/SystemHealth.jsx` | `tests/supportBundle.test.cjs`; OQ-127 |
| TT-R128 | §7, §12 | `electron/ipc/handlers/operations.cjs` (support:exportBundle RBAC + logAudit) | `tests/supportBundle.test.cjs`, `tests/rbacMatrix.test.cjs`; OQ-128 |
| TT-R121 | §10 | `electron/database/migrations.cjs` | OQ-121 |
| TT-R122 | §2 | `electron/services/encryptionKeyManagement.cjs` | OQ-122 |
| TT-R123 | §4 | `electron/services/optnExport.cjs`, `electron/ipc/handlers/optnExport.cjs` | `tests/optnExport.test.cjs`; OQ-70 |
| TT-R100 | §4 | `electron/functions/validateFHIRData.cjs`, `server/src/routes/fhir.js` | `server/test/integration/fhir.test.mjs`, `server/test/unit/fhirCapability.test.mjs` |
| TT-R101 | §4 | `electron/ipc/handlers/hl7.cjs`, `electron/services/hl7Ingest.cjs` | `tests/hl7Ingest.test.cjs`; OQ-69 |
| TT-R140 | §10 | input validators in `electron/ipc/handlers/entities.cjs` | OQ-140 |
| TT-R141 | §3 | `electron/main.cjs` (CSP, no remote) | OQ-141 (network capture) |
| TT-R142 | §10 | `electron/ipc/handlers.cjs` (request_id) | OQ-142 |
| TT-R143 | §2 | `electron/main.cjs` About menu | OQ-143 |
| TT-R144 | §15 | `scripts/audit-with-exceptions.mjs`, `security/vulnerability-exceptions.json` | `tests/auditExceptions.test.mjs`; OQ-144 |
| TT-R145 | §16 | `tests/rendererBridgeCoverage.test.mjs`, `tests/buildEntryIntegrity.test.mjs`, `scripts/release-readiness-check.mjs` (installer version check) | `tests/rendererBridgeCoverage.test.mjs`, `tests/buildEntryIntegrity.test.mjs`; OQ-145 |
| TT-R146 | §17 | `scripts/sign-win.cjs`, `scripts/notarize.cjs`, `.github/workflows/release.yml` | `tests/signWin.test.cjs`, `tests/notarize.test.cjs`; OQ-146 |
| TT-R147 | §17 | `scripts/verify-artifact-signature.mjs`, `scripts/release-readiness-check.mjs` | `tests/artifactSignature.test.mjs`; OQ-147 |

## Risk linkage

Maps the hazards in `RISK_REGISTER.md` to the requirements that control them.
Requirement groups added in software version 1.2.1:

| Risk | Controlled by |
|---|---|
| R-013 Migration fails mid-way | TT-R084, TT-R085, TT-R086, TT-R087 |
| R-020 Missed IOTA notification deadline | TT-R073, TT-R076, TT-R079, TT-R129, TT-R130, TT-R133 |
| R-021 Duplicate notice filed to chart | TT-R075, TT-R154 |
| R-022 Notice filed to the wrong chart | TT-R151, TT-R152 |
| R-023 Support bundle carries PHI out | TT-R126, TT-R127, TT-R128 |
| R-024 Notice altered after filing | TT-R074, TT-R135, TT-R151 |
| R-025 Template omits a statutory element | TT-R077, TT-R078, TT-R131 |
| R-026 Vulnerability exception becomes permanent | TT-R144 |
| R-027 Feature unwired in packaged build | TT-R145 |
| R-028 Unsigned build distributed as authentic | TT-R146, TT-R147 |
