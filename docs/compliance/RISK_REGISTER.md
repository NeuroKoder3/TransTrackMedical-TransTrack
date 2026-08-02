# TransTrack Risk Register (ISO 14971 style)

| Document control | |
|---|---|
| Document ID | TT-RISK-001 |
| Version | 1.1 |
| Status | Baseline — to be extended by deploying organization |
| Applies to software version | 1.2.1 |

## Revision history

| Ver | Change | Rationale |
|---|---|---|
| 1.0 | Baseline. | Initial issue. |
| 1.1 | Added R-020 to R-027. Revised the mitigation for R-013. | New hazards arising from the IOTA notification pipeline, chart filing, and diagnostics export added in software version 1.2.1. R-013 was revised because its original mitigation — transactional rollback — does not cover a multi-migration sequence that fails partway, which is now addressed by a verified pre-migration copy. |

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
| R-013 | Migration fails mid-way leaving DB in inconsistent state | 2 | D | Migrations wrapped in transactions; failed migration rolled back atomically. A verified pre-migration copy is taken before any pending migration runs, and migration is refused outright if that copy cannot be written, so a sequence that fails after an earlier migration has already committed is still recoverable. The failure reports the schema version reached and the copy's path. | E | Low | Engineering |
| R-014 | Cross-org data leak in multi-tenant deployment | 1 | D | All queries scoped by `org_id`; UNIQUE constraints include `org_id`. | E | Low | Engineering |
| R-015 | Brute-force online password attack | 2 | B | Account lockout after 5 failed attempts × 15 min; rate-limit middleware on auth IPC. | D | Low | Engineering |
| R-016 | Phishing of MFA TOTP code | 2 | B | TOTP step skew limited to ±1; backup codes single-use; admin notified on backup-code use. | D | Med (Acceptable) | Customer training |
| R-017 | OPTN-style export mistakenly submitted to UNet | 2 | C | Export filename and CSV header carry "DO_NOT_SUBMIT" watermark; in-app modal warns. | D | Low | Product |
| R-018 | Living donor follow-up windows missed (OPTN Policy 14) | 2 | B | Follow-up tasks auto-generated at 6 / 12 / 24 months; overdue tasks escalate. | D | Low | Engineering |
| R-019 | TransTrack mistakenly classified by FDA as a device | 2 | C | `FDA_DEVICE_RATIONALE.md` documents non-device positioning; UI labels and disclaimers reinforce. | D | Med (Acceptable) | Product + Legal |
| R-020 | Statutory IOTA notification deadline missed, leaving a patient unaware they cannot receive organ offers | 2 | B | The obligation is created in the same operation as the status transition, so it cannot be forgotten; the due date derives from the transition's effective timestamp rather than the generation time; overdue obligations are surfaced on the compliance summary. Where configuration is incomplete the transition is still recorded and reported as unmet. | D | Med (Acceptable) | Customer Admin + Engineering |
| R-021 | Duplicate copy of the same notice filed into the patient's chart, causing clinician confusion about which is current | 3 | C | Idempotency key identifies the obligation (transition + notice kind + revision), not the rendered content, so a retry cannot produce a second document; `UNIQUE(org_id, idempotency_key)` enforces it at the database. Superseding requires an explicit revision increment. A notice already filed is not filed again. | E | Low | Engineering |
| R-022 | Notice filed to the wrong patient's chart, disclosing PHI into another patient's record | 1 | D | The DocumentReference subject is derived from the notification's own patient reference rather than from UI selection state; filing re-verifies the notice body against its recorded content hash before transmission; dry-run mode allows the resource to be inspected before any live filing is enabled at a site. | E | Low | Engineering |
| R-023 | Support bundle carries PHI out of the safeguarded environment via a support ticket | 2 | B | Free-text values are withheld rather than filtered, because a name in prose cannot be reliably detected; structured PHI is redacted by key and by pattern; the no-PHI claim is tested adversarially against deliberately PHI-laden input. Including free text requires an explicit request, is recorded inside the bundle, and relabels it as requiring PHI handling. Export is admin-only and audit-logged. | D | Low | Engineering + Customer |
| R-024 | Notice content altered after filing, so the record no longer matches what the patient received | 2 | D | The rendered body and its content hash are frozen at generation by database trigger; reprint verifies body against hash and reports any mismatch. | E | Low | Engineering |
| R-025 | Hospital-authored notice template omits a content element required by § 512.442(d) | 2 | B | Templates are validated at configuration time against all five required elements and rejected if any is missing or an unrecognised placeholder is used. The organ-offer-eligibility statement is system-supplied and not editable through template configuration. | D | Low | Engineering |
| R-026 | A documented dependency-vulnerability exception becomes a permanent, unreviewed suppression | 2 | C | Exceptions carry a `reviewBy` date and the release gate fails once it passes; the gate also fails on an undocumented finding, on a severity increase beyond what the exception assessed, and on an exception that no longer matches any real finding. | D | Med (Acceptable) | Engineering |
| R-027 | A feature works in development but is unwired in the packaged build, failing first in front of a clinician | 3 | B | Every `api.<namespace>.<method>()` call in the renderer is checked against the real preload surface by automated test; the source entry point is guarded against being overwritten by a build artifact; the release gate verifies the installer version matches the source version. | D | Low | Engineering |
