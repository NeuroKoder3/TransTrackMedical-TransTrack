# TransTrack Risk Register (ISO 14971 style)

| Document control | |
|---|---|
| Document ID | TT-RISK-001 |
| Version | 1.0 |
| Status | Baseline — to be extended by deploying organization |

## Severity scale

| Sev | Description |
|---|---|
| 1 | Catastrophic — patient harm or large-scale PHI breach |
| 2 | Major — material PHI exposure or significant operational disruption |
| 3 | Moderate — limited PHI exposure or moderate disruption |
| 4 | Minor — no PHI exposure, minor disruption |

## Likelihood scale

| L | Description |
|---|---|
| A | Frequent — once per month or more |
| B | Probable — once per year |
| C | Occasional — once per several years |
| D | Remote — has happened in the field |
| E | Improbable — has not been observed |

Risk = Severity × Likelihood. Risk class:

| | A | B | C | D | E |
|---|---|---|---|---|---|
| 1 | High | High | High | High | Med |
| 2 | High | High | High | Med | Med |
| 3 | High | Med | Med | Med | Low |
| 4 | Med | Low | Low | Low | Low |

Mitigations move risk to **Acceptable** when residual risk is **Low** or
**Medium** with documented justification.

## Risks

| ID | Risk | Sev | Pre-L | Mitigation | Post-L | Residual | Owner |
|---|---|---|---|---|---|---|---|
| R-001 | Unauthorized access via stolen workstation credentials | 2 | B | Per-user account, RBAC, idle timeout, TOTP MFA, account lockout. | D | Med (Acceptable) | Customer IT |
| R-002 | Unauthorized access via compromised admin credentials | 1 | C | TOTP MFA mandatory for `admin` role; backup codes single-use; key-rotation audited. | D | Med (Acceptable) | Customer IT |
| R-003 | Tampering with audit logs to hide misuse | 1 | C | Append-only API + DB-level UPDATE/DELETE triggers + optional SIEM forward. | E | Low | Engineering |
| R-004 | Unencrypted PHI on disk after backup | 2 | B | Backups produced via SQLCipher backup API; never plaintext. | D | Low | Engineering |
| R-005 | Lost SQLCipher key → data unrecoverable | 2 | C | Key rotation history retained; admin warned during rotation; documented backup-the-key SOP. | D | Med (Acceptable) | Customer Admin |
| R-006 | User mistakes operational priority score for OPTN allocation rank | 2 | B | UI labels, in-app disclaimer, About dialog disclaimer, OPTN export watermarked "Not for UNet". | D | Low | Product |
| R-007 | User uses TransTrack-computed MELD/LAS/KDPI/EPTS for clinical allocation without source-of-truth verification | 2 | B | Calculators ship with formula citations; "Insufficient data" hard-stop when inputs missing; calculator outputs marked "Reference value — not for OPTN submission". | D | Low | Product |
| R-008 | HL7 v2 ingestion creates patient duplicates | 3 | B | Ingestion uses MRN + DOB matching with admin-review queue for ambiguous matches. | C | Med (Acceptable) | Engineering |
| R-009 | SIEM forwarder leaks PHI in event payloads | 2 | C | Forwarder strips PHI; only IDs + categorical metadata are emitted; CEF schema documented. | D | Low | Engineering |
| R-010 | Vulnerable bundled component (Electron, SQLite, Node) | 2 | A | Quarterly dependency scan; security-advisory monitoring; release notes call out CVE remediations. | C | Med (Acceptable) | Engineering |
| R-011 | Insider exfiltration via export | 2 | B | Every export logs file path, user, request_id; admin can disable exports per role. | D | Low | Engineering + Customer |
| R-012 | Power loss during write corrupts database | 2 | C | SQLite WAL + synchronous=FULL; integrity check at startup; automatic backup. | D | Low | Engineering |
| R-013 | Migration fails mid-way leaving DB in inconsistent state | 2 | D | Migrations wrapped in transactions; failed migration rolled back atomically. | E | Low | Engineering |
| R-014 | Cross-org data leak in multi-tenant deployment | 1 | D | All queries scoped by `org_id`; UNIQUE constraints include `org_id`. | E | Low | Engineering |
| R-015 | Brute-force online password attack | 2 | B | Account lockout after 5 failed attempts × 15 min; rate-limit middleware on auth IPC. | D | Low | Engineering |
| R-016 | Phishing of MFA TOTP code | 2 | B | TOTP step skew limited to ±1; backup codes single-use; admin notified on backup-code use. | D | Med (Acceptable) | Customer training |
| R-017 | OPTN-style export mistakenly submitted to UNet | 2 | C | Export filename and CSV header carry "DO_NOT_SUBMIT" watermark; in-app modal warns. | D | Low | Product |
| R-018 | Living donor follow-up windows missed (OPTN Policy 14) | 2 | B | Follow-up tasks auto-generated at 6 / 12 / 24 months; overdue tasks escalate. | D | Low | Engineering |
| R-019 | TransTrack mistakenly classified by FDA as a device | 2 | C | `FDA_DEVICE_RATIONALE.md` documents non-device positioning; UI labels and disclaimers reinforce. | D | Med (Acceptable) | Product + Legal |
