# TransTrack Server — Architecture

This document describes the multi-user server architecture introduced
alongside the existing single-machine Electron desktop application. The
server is designed for production deployment in a transplant clinic or by
a transplant-IT vendor who needs to integrate TransTrack with hospital
systems.

## Goals

1. **Multi-user, multi-org** — replace the per-laptop SQLite store with a
   shared, transactional Postgres database that supports concurrent
   writes from coordinators, surgeons, hepatologists, nephrologists,
   social workers, and tissue-typing labs.
2. **Hospital integration** — speak the wire formats hospital interface
   engines actually use: HL7 v2 over MLLP/TLS, FHIR R4 over HTTPS.
3. **Enterprise auth** — local password + TOTP for greenfield deployments,
   SAML 2.0 + OpenID Connect for hospitals with existing IdPs (ADFS, Okta,
   Azure AD, PingFederate, Keycloak).
4. **Tamper-evident audit** — append-only audit log with hash-chained
   records and DB-level immutability triggers (HIPAA 45 CFR 164.312(b)).
5. **Tenant isolation** — Postgres row-level security enforced on every
   query; bypass requires an explicit DBA role.

## Process model

```
+-------------------------------------------------+
|                  TransTrack Server              |
|                                                 |
|  Fastify HTTP/HTTPS  ←  REST + FHIR R4          |
|     :8080                                       |
|                                                 |
|  MLLP/TLS listener  ←  HL7 v2 (ADT/ORU/SIU/MDM) |
|     :2575                                       |
|                                                 |
|        ↘                ↙                       |
|         Postgres pool (pg)                      |
+-------------------------------------------------+
                       |
                       ▼
                +--------------+
                |   Postgres   |
                |  (RLS, audit |
                |   triggers)  |
                +--------------+
```

The HL7 listener runs in the same Node.js process as the HTTP server but
on its own TCP port. They share the connection pool and the ingest
service (`src/hl7/ingest.js`) that lifts parsed messages into native
`patients` and `lab_results` rows.

## Directory layout

```
server/
├── src/
│   ├── index.js                  # process entry point
│   ├── config.js                 # zod-validated env config
│   ├── db/
│   │   ├── pool.js               # pg pool + withTransaction(ctx, cb)
│   │   ├── migrate.js            # migration CLI (forward-only SQL)
│   │   └── migrations/*.sql      # ordered, append-only schema
│   ├── auth/
│   │   ├── jwt.js                # HS256 sign/verify
│   │   ├── password.js           # Argon2id + policy
│   │   ├── mfa.js                # TOTP + AES-GCM secret encryption
│   │   ├── saml.js               # @node-saml/node-saml SP wrapper
│   │   └── oidc.js               # openid-client wrapper
│   ├── middleware/
│   │   └── auth.js               # Bearer JWT → req.auth context
│   ├── routes/                   # HTTP routes (Fastify plugins)
│   │   ├── auth.js
│   │   ├── patients.js
│   │   ├── organOffers.js
│   │   ├── labResults.js
│   │   ├── calculators.js
│   │   ├── audit.js
│   │   ├── hl7.js
│   │   └── fhir.js
│   ├── services/                 # transactional domain logic
│   │   ├── auditService.js       # hash-chain
│   │   ├── authService.js
│   │   ├── patientService.js
│   │   ├── labResultService.js
│   │   └── organOfferService.js
│   ├── hl7/
│   │   ├── mllp.js               # MLLP framer (SB/EB/CR)
│   │   ├── server.js             # TCP / TLS listener
│   │   └── ingest.js             # parsed message → DB writes
│   └── fhir/
│       ├── capabilityStatement.js
│       ├── storage.js            # generic resource read/write/search
│       ├── bundle.js
│       └── resources/index.js    # per-resource validation + materialisation
├── test/
│   ├── unit/                     # vitest, no DB
│   └── integration/              # vitest, requires Postgres + API
└── Dockerfile
```

## Auth flow

```
1. POST /auth/login
   - email + password
   - on bad/lockout → 401 / 429
   - if user.role ∈ MFA_REQUIRED_FOR_ROLES and enrolled → returns
     { kind: "mfa_required", challengeId }
   - else                                                → returns
     { kind: "session", access, refresh, user }

2. POST /auth/mfa/verify  { challengeId, code }
   - returns                                                { kind: "session", access, refresh, user }

3. Bearer the access token (HS256 JWT, default 1h TTL)

4. POST /auth/refresh  { refresh }
   - rotates the refresh token; old token is revoked.

SAML and OIDC follow the standard browser-redirect dance and end with the
same access/refresh pair.
```

## Tenant isolation

Every write goes through `pool.withTransaction(ctx, callback)` which
sets `app.current_org_id` (and user id/email) as session variables for
the duration of the transaction. RLS policies on every tenant table
match `org_id = app_current_org_id()`; queries that forget to scope
themselves still cannot leak rows.

## HL7 v2 ingest

```
Hospital interface engine ──MLLP/TLS──▶  TransTrack MLLP listener
                                          │
                                          ▼
                       parseMessage()  (electron/services/hl7v2.cjs)
                                          │
                                          ▼
                       ingest.ingest()  (server/src/hl7/ingest.js)
                                          │
                                          ▼
                hl7_messages row  +  patients upsert  +  lab_results insert
                                          │
                                          ▼
                              MSA|AA ack returned to engine
```

### Supported events (current)

| Event   | Action                                                 |
| ------- | ------------------------------------------------------ |
| ADT^A01 | Patient admit — upsert patient                          |
| ADT^A03 | Discharge — upsert patient                              |
| ADT^A04 | Registration — upsert patient                           |
| ADT^A08 | Update demographics — upsert patient                    |
| ORU^R01 | Lab result — upsert patient + insert lab_results        |

Unsupported events return an `MSA|AC` (commit accept) but write a
`hl7_messages` row with `processed_status='deferred'` so a downstream
worker can be added without code changes.

## FHIR R4

The server hosts a minimal but real FHIR R4 endpoint at `/fhir`. The
following resources support `read`, `vread`, `search-type`, `create`, and
`update`:

- `Patient`        — write-back materialises into `patients`
- `Observation`    — write-back materialises into `lab_results`
- `Encounter`
- `MedicationRequest`
- `AllergyIntolerance`

The CapabilityStatement is at `GET /fhir/metadata`. The store is
versioned per resource (`meta.versionId` increments on update) and
soft-delete is supported.

## Audit log integrity

Every domain service that mutates state calls `auditService.record()`
inside the same transaction that performs the mutation. Each row's
`record_hash = sha256(prev_hash || canonical_json(payload))`. The
previous hash is the most recent row for the same org. UPDATE and DELETE
on `audit_logs` are blocked by triggers. `GET /audit/verify` walks the
chain and reports the first broken row, if any.
