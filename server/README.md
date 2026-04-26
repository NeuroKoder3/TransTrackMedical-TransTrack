# TransTrack Server

Multi-user, multi-tenant API + HL7 v2 / FHIR R4 integration engine
for the TransTrack transplant operations platform.

## What's in here

- **REST API** (Fastify) — authentication, patient management, organ
  offers, lab results, audit, calculators
- **FHIR R4 server** at `/fhir` — full USCDI v3 surface (~25 resources)
  with searchset Bundles, transactions, history, soft delete
- **FHIR Bulk Data Access** at `/fhir/$export`, `/fhir/Patient/$export`,
  `/fhir/Group/{id}/$export` (NDJSON, async, status polling)
- **FHIR R4 Subscriptions** with REST-hook delivery and a background
  dispatcher (5s tick, exponential retry)
- **SMART on FHIR v2** at `/.well-known/smart-configuration`,
  `/oauth2/authorize`, `/oauth2/token`, `/oauth2/register`,
  `/oauth2/introspect`, `/oauth2/revoke` — authorization_code + PKCE,
  refresh, client_credentials, JWT bearer; v1 + v2 scope syntax;
  enforced on every FHIR call
- **CDS Hooks 1.1** at `/cds-services` with a pluggable registry and
  three built-in transplant services (candidate-summary,
  nephrotoxic-medication-advisory, hla-screening-reminder)
- **HL7 v2 MLLP/TLS listener** — accepts ADT (A01-A60 incl. A40 merge),
  ORU (R01/R30), ORM, OMP, RDE, RDS, MDM (T01/T02), SIU (S12-S26),
  BAR/DFT (P01-P11), and MFN (M02/M05/M06) from hospital interface
  engines (Mirth Connect, Rhapsody, Cloverleaf, Corepoint), parses
  them through a vendor-aware pipeline (Epic/Cerner/Meditech
  Z-segments + per-org overrides), materialises into native entities,
  and returns MSA acks
- **Auth** — local password + TOTP, plus SAML 2.0 and OIDC for
  hospital SSO
- **Audit log** with hash-chain tamper evidence and DB-level
  immutability triggers (HIPAA 45 CFR 164.312(b))
- **Postgres** with row-level security on every tenant table

See `docs/server/architecture.md` for the full picture.

## Quick start

```bash
# Postgres
docker compose -f ../docker/docker-compose.yml up -d postgres

# Server
npm install
cp .env.example .env       # edit JWT_SECRET first
npm run migrate
npm run dev

# REST  : http://localhost:8080
# FHIR  : http://localhost:8080/fhir/metadata
# SMART : http://localhost:8080/.well-known/smart-configuration
# CDS   : http://localhost:8080/cds-services
# MLLP  : tcp://localhost:2575
# MLLP/TLS : tcp://localhost:2576 (set HL7_MLLP_TLS_*)
```

## Test

```bash
npm test                      # unit tests, no DB needed
npm run test:integration      # end-to-end, requires Postgres + migrations
INTEGRATION_MIRTH=1 npm run test:mirth
```

## Configuration

All configuration is environment-driven and validated at startup.
See `.env.example` for the full set of variables and their semantics.

## Project layout

See `docs/server/architecture.md` § Directory layout.
