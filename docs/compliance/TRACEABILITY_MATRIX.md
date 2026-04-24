# TransTrack Traceability Matrix

Maps every Mandatory requirement from `SYSTEM_REQUIREMENTS_SPECIFICATION.md` to its
design (`SOFTWARE_DESIGN_SPECIFICATION.md`), the implementing module(s), and the
verification artifact (test or OQ test case).

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
| TT-R080 | §4 | `electron/database/schema.cjs` (indexes) | PQ-80 |
| TT-R081 | §2 | `electron/database/init.cjs` (WAL) | PQ-81 |
| TT-R082 | §2 | `electron/services/disasterRecovery.cjs` | PQ-82 |
| TT-R083 | §2 | `electron/services/disasterRecovery.cjs` | PQ-83 |
| TT-R120 | §7 | `electron/ipc/auditReportHandler.cjs` | OQ-120 |
| TT-R121 | §10 | `electron/database/migrations.cjs` | OQ-121 |
| TT-R122 | §2 | `electron/services/encryptionKeyManagement.cjs` | OQ-122 |
| TT-R140 | §10 | input validators in `electron/ipc/handlers/entities.cjs` | OQ-140 |
| TT-R141 | §3 | `electron/main.cjs` (CSP, no remote) | OQ-141 (network capture) |
| TT-R142 | §10 | `electron/ipc/handlers.cjs` (request_id) | OQ-142 |
| TT-R143 | §2 | `electron/main.cjs` About menu | OQ-143 |
