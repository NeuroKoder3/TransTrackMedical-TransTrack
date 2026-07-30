# Server Database Migrations

## Overview

TransTrack server uses a lightweight, forward-only migration runner with
no external dependencies beyond `pg`. Migrations are plain `.sql` files
in `server/src/db/migrations/`, applied in filename-sorted order.

## How Migrations Work

1. On first run, the runner creates a `schema_migrations` table to track
   which migrations have been applied.
2. Each migration file is executed inside a transaction. If it succeeds,
   the version is recorded; if it fails, the transaction is rolled back
   and the runner exits with an error.
3. Migrations are **idempotent to re-run**: the runner skips any version
   already in `schema_migrations`.
4. Down migrations are not supported. To undo a change, write a new
   forward migration.

## Running Migrations

### Manual

```bash
cd server
DATABASE_URL=postgres://user:pass@host/db node src/db/migrate.js up
```

### Check status

```bash
cd server
DATABASE_URL=postgres://user:pass@host/db node src/db/migrate.js status
```

### Via npm script

```bash
cd server
npm run migrate        # runs "up"
npm run migrate:status # shows applied/pending
```

### In Docker

The Dockerfile does **not** run migrations automatically. Run them as a
deploy step before (or alongside) starting the server:

```bash
docker run --rm \
  -e DATABASE_URL=postgres://... \
  transtrack-server \
  node src/db/migrate.js up
```

Or in docker-compose:

```yaml
services:
  migrate:
    image: transtrack-server
    command: ["node", "src/db/migrate.js", "up"]
    environment:
      DATABASE_URL: postgres://...
    depends_on:
      postgres:
        condition: service_healthy

  api:
    image: transtrack-server
    depends_on:
      migrate:
        condition: service_completed_successfully
```

## Writing a New Migration

1. Create a new `.sql` file in `server/src/db/migrations/` with a
   zero-padded numeric prefix:
   ```
   008_add_metrics_table.sql
   ```
2. Write idempotent DDL when possible (`CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`).
3. Test locally against a fresh database and against an already-migrated
   database before committing.
4. Never modify an already-applied migration file — always create a new one.

## Migration Files

| File | Description |
|------|-------------|
| `001_init.sql` | Core tables (users, orgs, patients, audit_logs, etc.) |
| `002_clinical.sql` | Clinical detail tables |
| `003_rls.sql` | Row-level security policies |
| `004_audit_clock_timestamp.sql` | Audit timestamp precision |
| `005_ehr_integration.sql` | FHIR subscriptions, bulk export, SMART clients |
| `006_issued_licenses.sql` | Stripe billing / license issuance tracking |
| `007_clinical_detail.sql` | Extended clinical data fields |
| `008_hl7_production_hardening.sql` | HL7 dedup index, sending_apps table, dead letters, FHIR delivery backoff |
| `009_oidc_auth_states.sql` | OIDC auth state persistence (replaces in-memory Map) |
