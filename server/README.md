# TransTrack Server

Multi-user, multi-tenant API + HL7 v2 / FHIR R4 integration engine
for the TransTrack transplant operations platform.

## What's in here

- **REST API** (Fastify) — authentication, patient management, organ
  offers, lab results, audit, calculators
- **FHIR R4 server** at `/fhir` — Patient, Observation, Encounter,
  MedicationRequest, AllergyIntolerance with searchset Bundles
- **HL7 v2 MLLP/TLS listener** — accepts ADT^A01/A03/A04/A08 and
  ORU^R01 messages from hospital interface engines (Mirth Connect,
  Rhapsody, Cloverleaf, Corepoint), parses them, materialises into
  native entities, and returns MSA acks
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
# MLLP  : tcp://localhost:2575
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
