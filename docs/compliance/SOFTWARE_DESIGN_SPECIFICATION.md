# TransTrack Software Design Specification (SDS)

| Document control | |
|---|---|
| Document ID | TT-SDS-001 |
| Version | 1.0 |
| Status | Baseline |

## 1. Architecture overview

TransTrack is an Electron desktop application:

```
┌────────────────────────────────────────────────────────────────┐
│ Renderer (React + React Router + Tanstack Query)              │
│   - src/pages, src/components, src/api/localClient.js          │
└──────────────────────────────┬─────────────────────────────────┘
                               │ context-isolated IPC bridge
                               │ exposed via electron/preload.cjs
┌──────────────────────────────▼─────────────────────────────────┐
│ Main process (Node.js)                                         │
│   - electron/main.cjs (lifecycle, BrowserWindow, security)    │
│   - electron/ipc/handlers.cjs (handler registration)          │
│   - electron/ipc/handlers/*.cjs (per-domain handlers)         │
│   - electron/services/*.cjs (business logic)                  │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│ SQLCipher-encrypted SQLite (better-sqlite3-multiple-ciphers)   │
│   - electron/database/schema.cjs                               │
│   - electron/database/migrations.cjs                           │
└────────────────────────────────────────────────────────────────┘
```

## 2. Security boundaries

| Boundary | Mechanism |
|---|---|
| Renderer ↔ Main | `contextIsolation: true`, `nodeIntegration: false`, narrow API surface in preload. |
| Main ↔ Disk | All PHI tables live in the encrypted SQLCipher database; non-PHI artifacts (logs, crash dumps) are filtered. |
| Main ↔ Network | No outbound traffic by default. EHR sync, SIEM forward, FHIR validation, and update checks are explicit opt-in. |
| User ↔ Application | TOTP MFA + RBAC + idle timeout + DB-trigger audit immutability. |

## 3. Trust model

* The host OS account is trusted to be the user's account. Multi-user shared
  workstations require either separate OS accounts or session-based logout.
* The customer's IdP (when SSO is enabled) is trusted for primary authentication.
  The TOTP factor remains a TransTrack-issued secondary factor.
* The customer's SIEM is trusted to be reachable from the host. TransTrack only
  emits events; it does not query.

## 4. Data model summary

See `electron/database/schema.cjs` for the authoritative DDL. Core entities:

* `organizations`, `users`, `sessions`, `login_attempts`
* `patients` (waitlisted)
* `donor_organs`
* `matches`
* `organ_offers` (state machine — see TT-R066)
* `transplant_events`, `rejection_episodes`, `biopsies`,
  `immunosuppression_regimens`, `post_tx_readmissions` (post-transplant)
* `living_donors`, `living_donor_evaluations`, `living_donor_followups`
* `lab_results` (opaque), `required_lab_types`
* `readiness_barriers`, `adult_health_history_questionnaires`
* `audit_logs` (immutable), `access_justification_logs`
* `user_mfa`, `user_password_history`, `siem_destinations`
* `inactivation_predictions`, `outcomes_snapshots`, `srtr_metrics`, `tasks`

All PHI tables are scoped by `org_id`. Indexes enforce the lookup pattern.

## 5. Calculator services

`electron/services/calculators/*.cjs` contains pure-function clinical scoring
implementations:

| Module | Score |
|---|---|
| `meld.cjs` | MELD (original), MELD-Na, MELD 3.0, PELD |
| `las.cjs` | LAS (Lung Allocation Score, 2005 formula). |
| `kdpi.cjs` | KDPI / KDRI |
| `epts.cjs` | EPTS (Estimated Post-Transplant Survival) |

Each module exports `{ calculate, version, requiredFields, citation }`. They are
**deterministic, side-effect-free, and unit-tested**. The UI must show "Insufficient
data" when `requiredFields` are missing rather than substituting defaults.

## 6. Organ offer state machine

```
         ┌────────────┐
         │  PENDING   │── timer expires ──► EXPIRED
         └─────┬──────┘
   accept     │     decline / rescind
        ┌─────▼─────┐         ┌─────────────┐
        │ ACCEPTED  │         │  DECLINED   │
        └───────────┘         └─────────────┘
                              ┌─────────────┐
                              │  RESCINDED  │
                              └─────────────┘
```

* Decline reason codes are required when transitioning to `DECLINED`.
* Acceptance can be `PROVISIONAL` or `FINAL`. PROVISIONAL is recorded, FINAL freezes
  the offer.
* All transitions are audited.

## 7. Audit log immutability

`audit_logs` carries DB triggers that `RAISE(ABORT, 'HIPAA Compliance: Audit logs
are immutable')` on `UPDATE` or `DELETE`. The application layer additionally
proxies `db.prepare` to refuse those statements pre-emptively (see
`electron/ipc/shared.cjs`).

## 8. SIEM forwarding

`electron/services/siemForwarder.cjs` implements a write-only forwarder. Events
are queued in memory and written to the destination(s) via UDP, TCP, or TLS sockets
in RFC 5424 syslog format with a CEF (Common Event Format) payload. Backpressure
is handled by capping the queue at 10 000 events; oldest are dropped with a
warning record.

## 9. MFA

`electron/services/mfa.cjs` implements TOTP per RFC 6238 (HMAC-SHA1, 30-second
period, 6-digit codes) with ±1 step skew. Secrets are stored encrypted in the
SQLCipher database. Backup codes are 10 single-use, hash-stored codes per user.
Enrollment QR codes use the `otpauth://` URI format consumed by Google
Authenticator, Authy, and 1Password.

## 10. Coding standards

* Node modules in `.cjs` (CommonJS) for the Electron main process.
* React components in `.jsx` (ESM).
* All side-effecting handlers route through `shared.validateSession()` first.
* Migrations are forward-only and idempotent.
