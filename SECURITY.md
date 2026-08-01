# Security Architecture & Implementation

## Reporting a Security Issue

**Email**: Trans_Track@outlook.com

**Please include**: Description, steps to reproduce, potential impact, and suggested fixes.

**Response Timeline**:
- Acknowledgment: Within 48 hours
- Initial assessment: Within 1 week
- Resolution target: Based on severity (Critical: 24h, High: 72h, Medium: 1 week, Low: 30 days)

## Trusted Distribution and Impersonation Alerts

- Official repository: `https://github.com/NeuroKoder3/TransTrackMedical-TransTrack`
- Official release channel: `https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases`
- Official contact: `Trans_Track@outlook.com`

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

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

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
| T2 | **Data Exfiltration** | Offline-first architecture, no cloud PHI transmission, data residency controls | ✅ |
| T3 | **SQL Injection** | Parameterized queries, column whitelisting (shared.cjs) | ✅ |
| T4 | **Cross-Site Scripting (XSS)** | CSP headers, patient name sanitization in notifications and FHIR exports | ✅ |
| T5 | **Session Hijacking** | Server-side session management with expiration, context isolation | ✅ |
| T6 | **Privilege Escalation** | Organization isolation at query layer, role enforcement in all handlers | ✅ |
| T7 | **Brute Force Login** | Account lockout after 5 failed attempts, bcrypt password hashing (12 rounds) | ✅ |
| T8 | **Cross-Organization Access** | Hard org_id scoping on all queries, tested via cross-org access tests | ✅ |
| T9 | **Audit Log Tampering** | SQLite triggers prevent UPDATE/DELETE on audit_logs table | ✅ |
| T10 | **DevTools Exploitation** | DevTools disabled in production, blocked via event listener | ✅ |
| T11 | **License Bypass** | Fail-closed license checking, clock-skew protection | ✅ |
| T12 | **Medical Score Manipulation** | Input validation against UNOS/OPTN ranges (MELD 6-40, LAS 0-100, etc.) | ✅ |
| T13 | **Race Conditions** | Patient freshness re-check before match creation | ✅ |

### Threats NOT Addressed (Out of Scope)

| Threat | Reason | Recommendation |
|--------|--------|---------------|
| Physical device theft | Desktop app responsibility of deploying org | Use full-disk encryption (BitLocker/FileVault) |
| OS-level keyloggers | Outside application boundary | Endpoint detection and response (EDR) |
| Memory dump attacks | Electron limitation | Use hardware security modules for key storage |
| Network-level MITM | Only relevant for EHR integration | Use TLS 1.3 for all EHR endpoints |

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

TransTrack is designed for compliance with:
- **HIPAA** — Health Insurance Portability and Accountability Act
- **FDA 21 CFR Part 11** — Electronic Records and Signatures
- **AATB Standards** — American Association of Tissue Banks

See `docs/HIPAA_COMPLIANCE_MATRIX.md` for detailed function-level compliance mapping.

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

*Last updated: 2026-08-01*
