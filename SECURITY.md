# Security Architecture & Implementation

## Reporting a Security Issue

**Email**: Trans_Track@outlook.com

**Please include**: Description, steps to reproduce, potential impact, and suggested fixes.

**Response Timeline**:
- Acknowledgment: Within 48 hours
- Initial assessment: Within 1 week
- Resolution target: Based on severity (Critical: 24h, High: 72h, Medium: 1 week, Low: 30 days)

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

## Dependencies

Security-critical dependencies:
- `better-sqlite3-multiple-ciphers` — SQLCipher encryption
- `bcryptjs` — Password hashing
- `uuid` — Unique identifier generation

Run `npm run security:check` to audit dependencies for known vulnerabilities.

---

*Last updated: 2026-03-21*
