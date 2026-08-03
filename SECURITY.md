# Security Architecture & Implementation

| Document ID | TT-SEC-001 |
| --- | --- |
| Version | 2.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Information Security Officer |

## Reporting a Security Issue

### Disclosure channel

| Purpose | Address | Monitored by |
|---|---|---|
| Security vulnerability disclosure | `security@transtrack.example` | Information Security Officer |
| Suspected PHI breach or incident in a live deployment | `security@transtrack.example`, subject line prefixed `INCIDENT:` | Information Security Officer, escalated to Privacy Officer |
| Product support (non-security) | `support@transtrack.example` | Support Lead |

`security@transtrack.example` is a **role-based group address**, not an
individual mailbox: it is delivered to the Information Security Officer and at
least one deputy so that reports are not blocked by one person's absence. It is
not a personal or consumer webmail account, and reporters should not be asked to
contact an individual.

> **Provisioning status.** The addresses above are placeholders on the reserved
> `.example` domain. They are **not yet provisioned** and mail sent to them will
> not be delivered. Provisioning a monitored role address on the production
> product domain, with an on-call rotation behind it, is a prerequisite for
> commercial release. This is tracked as residual risk **RR-15** in
> [`docs/compliance/RESIDUAL_RISK.md`](docs/compliance/RESIDUAL_RISK.md).
> Until it is provisioned, use the repository's private vulnerability reporting
> facility on GitHub, which reaches the maintainers without disclosing the issue
> publicly.

### What to include

1. A description of the issue and the component affected.
2. Steps to reproduce, and the version and platform you observed it on.
3. Assessed impact — in particular whether PHI confidentiality, audit-trail
   integrity or clinical decision output is affected.
4. Any suggested remediation.

Please do **not** include real patient data in a report. If a reproduction
requires PHI, say so and we will arrange a controlled channel; use the synthetic
fixtures described in
[`docs/TEST_DATA_PROVENANCE.md`](docs/TEST_DATA_PROVENANCE.md) where possible.

### Response service levels

Timings run from receipt at the disclosure address, in business hours
(Mon–Fri, 09:00–17:00 US Eastern) unless the report is assessed Critical, in
which case the clock runs continuously.

| Stage | Target | Owner |
|---|---|---|
| Acknowledgement of receipt | 2 business days | Information Security Officer |
| Triage and severity assignment | 5 business days | Information Security Officer |
| Status update to reporter | Every 10 business days until closed | Information Security Officer |
| Fix or documented mitigation — Critical | 7 calendar days | Engineering Lead |
| Fix or documented mitigation — High | 30 calendar days | Engineering Lead |
| Fix or documented mitigation — Medium | 90 calendar days | Engineering Lead |
| Fix or documented mitigation — Low | Next scheduled release | Engineering Lead |
| Advisory published to deployed sites | Within 5 business days of fix availability | Release Manager |

Severity is assigned using CVSS v3.1 base score, adjusted upward where PHI
confidentiality, audit-trail integrity, or a clinical calculation result is
affected.

### Escalation path

If a report does not receive an acknowledgement within the target above, or the
reporter disagrees with the assigned severity, escalate in this order. Each step
allows 5 business days before moving to the next.

1. **Information Security Officer** — `security@transtrack.example`
2. **Engineering Lead** — via `security@transtrack.example`, subject line
   prefixed `ESCALATION:`
3. **Quality Assurance Officer** — for disputes about whether an issue is a
   validation defect requiring a documented change under
   [`docs/compliance/policies/CHANGE_MANAGEMENT_SOP.md`](docs/compliance/policies/CHANGE_MANAGEMENT_SOP.md)
4. **Privacy Officer** — for any issue involving actual or suspected PHI
   disclosure, which additionally triggers the breach-assessment procedure in
   [`docs/compliance/policies/INCIDENT_RESPONSE_PLAN.md`](docs/compliance/policies/INCIDENT_RESPONSE_PLAN.md)

Deploying organizations retain their own HIPAA Breach Notification Rule
obligations regardless of vendor timelines; the vendor SLA above does not
displace the 60-day notification deadline that applies to the covered entity.

### Coordinated disclosure

We ask for 90 days from acknowledgement before public disclosure, or until a fix
is available to deployed sites, whichever is sooner. We will credit reporters in
the release notes unless anonymity is requested. There is no bug bounty.

## Trusted Distribution and Impersonation Alerts

- Official repository: `https://github.com/NeuroKoder3/TransTrackMedical-TransTrack`
- Official release channel: `https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases`
- Official contact: `security@transtrack.example` (see the provisioning note above)

Any third-party page, mirror, or download host claiming to be "official
TransTrack" outside the channels above is untrusted and may pose a malware or
supply-chain risk.

Known unaffiliated page currently reported by users:
- `https://the-vishal-gupta.github.io/`
- Do not download files or follow software links from this page.

If you encounter a suspicious page, report:
1. URL and timestamp
2. Screenshots
3. Downloaded file hashes (if any)
4. Any observed malicious behavior

## Supported Versions

Security fixes are issued only for supported lines. "Supported" means the line
receives security patches; it does not imply feature parity with the current
release.

| Version line | Status | Security fixes | Notes |
|---|---|---|---|
| 1.3.x | Current | Yes | Current release line. Contains the remediation described in [`docs/compliance/VALIDATION_SUMMARY_REPORT.md`](docs/compliance/VALIDATION_SUMMARY_REPORT.md). |
| 1.2.x | Maintenance | Critical and High only, until 1.3.0 + 90 days | Predates the 1.3.0 security remediation. Sites should plan an upgrade. |
| 1.1.x | End of life | No | Upgrade required. |
| 1.0.x | End of life | No | Upgrade required. |

The server tier ships as **early access** and is versioned with the desktop
application. Early access means it is not covered by the vendor Operational
Qualification beyond unit-level verification; see RR-14 in
[`docs/compliance/RESIDUAL_RISK.md`](docs/compliance/RESIDUAL_RISK.md).

---

## Threat Model

### Assets Protected
1. **Patient PHI** — Names, MRNs, diagnoses, blood types, medical scores, contact info
2. **Donor Information** — Organ details, HLA typing, compatibility data
3. **Match Results** — Donor-patient matching scores and rankings
4. **Audit Logs** — Immutable record of all system activity
5. **Encryption Keys** — Database encryption key material

### Threats Addressed

| # | Threat | Mitigation | Status |
|---|--------|------------|--------|
| T1 | **Unauthorized Data Access** | AES-256-CBC local encryption (SQLCipher), role-based access control | ✅ |
| T2 | **Data Exfiltration** | Local-first architecture; all optional egress paths (remote log sink, SIEM forwarder, server tier, auto-update) are off by default, and the logger redacts PHI at the sink. See "Network egress" below. | ✅ |
| T3 | **SQL Injection** | Parameterized queries, column whitelisting (shared.cjs) | ✅ |
| T4 | **Cross-Site Scripting (XSS)** | CSP headers, patient name sanitization in notifications and FHIR exports | ✅ |
| T5 | **Session Hijacking** | Server-side session management with expiration, context isolation | ✅ |
| T6 | **Privilege Escalation** | Organization isolation at query layer, role enforcement in all handlers | ✅ |
| T7 | **Brute Force Login** | Account lockout after 5 failed attempts, bcrypt password hashing (12 rounds) | ✅ |
| T8 | **Cross-Organization Access** | Hard org_id scoping on all queries, tested via cross-org access tests | ✅ |
| T9 | **Audit Log Tampering** | SQLite triggers prevent UPDATE/DELETE on audit_logs table | ✅ |
| T10 | **DevTools Exploitation** | DevTools disabled in production, blocked via event listener | ✅ |
| T11 | **License Bypass** | Fail-closed license checking, clock-skew protection | ✅ |
| T12 | **Medical Score Manipulation** | Input validation against documented ranges (MELD 6–40; lung reference score 0–100), each carrying a controlled-source id traceable to [`docs/compliance/CLINICAL_SOURCES.md`](docs/compliance/CLINICAL_SOURCES.md) | ✅ |
| T13 | **Race Conditions** | Patient freshness re-check before match creation | ✅ |

### Threats NOT Addressed (Out of Scope)

| Threat | Reason | Recommendation |
|--------|--------|---------------|
| Physical device theft | Desktop app responsibility of deploying org | Use full-disk encryption (BitLocker/FileVault) |
| OS-level keyloggers | Outside application boundary | Endpoint detection and response (EDR) |
| Memory dump attacks | Electron limitation | Use hardware security modules for key storage |
| Network-level MITM | Only relevant for EHR integration | Use TLS 1.3 for all EHR endpoints |

## Network egress

TransTrack is local-first: the desktop application stores all PHI in a
SQLCipher-encrypted database on the workstation and requires no network
connection to perform its core function. It is **not** true that the product has
no external network dependencies. Five egress paths exist, all optional and all
off unless configured:

| Path | Enabled by | Default | Data that leaves the host |
|---|---|---|---|
| Remote log sink | `SENTRY_DSN` or `TRANSTRACK_REMOTE_LOG_URL` environment variable | Off | Log level, a message truncated to 256 characters, and an allow-list of five metadata keys (`error`, `code`, `component`, `action`, `duration`). PHI is redacted at the sink (`electron/services/logger.cjs`). Only `error` and `fatal` levels are forwarded unless `TRANSTRACK_REMOTE_LOG_LEVELS` widens it. |
| SIEM forwarder | Per-organization `siem_destinations` row with `enabled = 1` | Off — no destinations exist until an administrator creates one | Audit events in syslog/CEF/JSON form, PHI-redacted. Plaintext transport is refused unless `TRANSTRACK_SIEM_ALLOW_PLAINTEXT=1`. |
| Server tier (Fastify REST / FHIR / SMART) | Deploying the optional server component | Not deployed | PHI, by design — this is an integration tier. Early access; see RR-14. |
| HL7 v2 MLLP listener | Starting the listener | Bound to `127.0.0.1`, with a frame cap, idle timeout and connection cap | Inbound only. |
| Auto-update | Packaged builds checking GitHub Releases | On in packaged builds | Version metadata and the update download. No PHI. |

An organization that requires zero egress should leave the environment
variables unset, create no SIEM destinations, not deploy the server tier, and
block the update endpoint at the network layer. This posture is recorded as
residual risk **RR-12** in
[`docs/compliance/RESIDUAL_RISK.md`](docs/compliance/RESIDUAL_RISK.md), and the
redaction behaviour is verified by `tests/loggerRedaction.test.cjs`,
`tests/siemRedaction.test.cjs` and `tests/phiLeakage.test.cjs`.

## Security Architecture

### Defense in Depth Layers

```
┌─────────────────────────────────────┐
│  Layer 1: Electron Security          │
│  - Context isolation                 │
│  - CSP headers                       │
│  - No nodeIntegration                │
│  - Navigation blocking               │
│  - DevTools disabled in production   │
├─────────────────────────────────────┤
│  Layer 2: Authentication             │
│  - bcrypt password hashing           │
│  - Session management                │
│  - Account lockout                   │
│  - Password strength requirements    │
├─────────────────────────────────────┤
│  Layer 3: Authorization              │
│  - Role-based access control         │
│  - Organization isolation            │
│  - License enforcement               │
│  - Feature gating                    │
├─────────────────────────────────────┤
│  Layer 4: Data Protection            │
│  - AES-256-CBC encryption at rest    │
│  - Input validation                  │
│  - Output sanitization               │
│  - Parameterized SQL queries         │
├─────────────────────────────────────┤
│  Layer 5: Audit & Monitoring         │
│  - Immutable audit logs              │
│  - Structured error logging          │
│  - Request ID tracking               │
│  - Compliance report generation      │
└─────────────────────────────────────┘
```

### IPC Security Model

All renderer-to-main communication uses Electron's IPC:
- **contextBridge** exposes a minimal, typed API to the renderer
- All IPC handlers validate session, check organization scope, and enforce license limits
- Entity operations are scoped by `org_id` at the query level
- Rate limiting prevents abuse (configurable per handler)

### Password Policy

| Requirement | Value |
|-------------|-------|
| Minimum length | 12 characters |
| Uppercase required | Yes |
| Lowercase required | Yes |
| Number required | Yes |
| Special character required | Yes |
| Hash algorithm | bcrypt |
| Hash rounds | 12 |
| Account lockout threshold | 5 failed attempts |

## Compliance

TransTrack implements technical controls intended to support a deploying
organization's obligations under:

| Framework | Control mapping | Nature of the claim |
|---|---|---|
| HIPAA Security Rule | [`docs/compliance/HIPAA_SECURITY_RULE_MAPPING.md`](docs/compliance/HIPAA_SECURITY_RULE_MAPPING.md), [`docs/HIPAA_COMPLIANCE_MATRIX.md`](docs/HIPAA_COMPLIANCE_MATRIX.md) | The product provides technical safeguards. HIPAA compliance is a determination made by the covered entity about its own practices, not an attribute of software. |
| FDA 21 CFR Part 11 | [`docs/compliance/PART_11_CONTROL_MAPPING.md`](docs/compliance/PART_11_CONTROL_MAPPING.md) | Design controls only, and only where the organization elects to treat TransTrack records as Part 11 records. Known gaps are stated in that mapping. |

No AATB (American Association of Tissue Banks) conformance is claimed. No AATB
control mapping exists, and TransTrack is a solid-organ waitlist tool rather
than a tissue-bank system. Earlier revisions of this and other documents
asserted AATB alignment; that claim was unsupported and has been withdrawn.

## Implementation Notes

- **Desktop password hashing**: uses `bcryptjs` (12 rounds) — pure-JS bcrypt.
  The server tier uses `argon2` for new accounts.
- **Audit hash chain**: the desktop application maintains a SHA-256 hash chain
  on the `audit_logs` table (see `electron/services/auditChain.cjs`). Each
  row stores the hash of its content concatenated with the previous row's
  hash, creating a tamper-evident chain. The server tier's
  `auditService.js` mirrors this pattern with `prev_hash` in PostgreSQL.

## Dependencies

Security-critical dependencies:
- `better-sqlite3-multiple-ciphers` — SQLCipher encryption (AES-256-CBC)
- `bcryptjs` — Password hashing (desktop)
- `argon2` — Password hashing (server)
- `uuid` — Unique identifier generation
- `jose` — JWT / JWS / JWK operations

Run `npm run security:check` to audit dependencies for known vulnerabilities.

### Vulnerability management and documented exceptions

`npm run audit` runs `scripts/audit-with-exceptions.mjs`, which performs a
production-dependency `npm audit` and then subtracts only those findings that
carry a reviewed, unexpired exception in
[`security/vulnerability-exceptions.json`](security/vulnerability-exceptions.json).
The same gate runs inside `npm run release:check`, so a release cannot be cut
with an undocumented finding.

This exists because a blanket pass/fail audit leaves only two options when a
finding is real but unreachable in this product: suppress genuine findings by
lowering the severity threshold, or take on an unrelated major upgrade under
release pressure. Neither is defensible. The gate is **stricter** than a bare
`npm audit` in four ways:

- An exception covers exactly one advisory on one package. A new advisory
  against the same package is not covered.
- If a finding's severity rises above what was assessed, the exception stops
  applying and the build fails.
- Every exception carries a `reviewBy` date. Once it passes, the build fails, so
  a decision cannot be silently inherited by a later release.
- An exception that no longer matches any finding fails as stale, so the file
  cannot accumulate entries granting more latitude than was reviewed.

Accepted findings are printed on every run and are intended to be shown to a
customer security reviewer. Each entry records the reachability analysis, the
remediation plan, who assessed it and when. Adding an exception without a
substantive analysis, an owner and a review date is rejected by
`tests/auditExceptions.test.mjs`.

To review the current position:

```bash
npm run audit          # human-readable, shows every accepted finding
npm run audit:raw      # unfiltered npm audit, for comparison
```

---

## Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.x | 2026-08-01 | Prior revisions. | Information Security Officer |
| 2.0 | 2026-08-02 | Replaced the consumer webmail disclosure contact with a role-based address, response SLA and escalation path (finding L-13, RR-15). Corrected the supported-version matrix, which listed only 1.0.x (M-17 item 5). Withdrew the unsupported AATB conformance claim (M-17 item 3). Added an accurate network-egress section (M-17 items 2 and 9). Corrected the "LAS" reference in the threat table (M-17 item 11). Added document control header and this change history. | Information Security Officer |
