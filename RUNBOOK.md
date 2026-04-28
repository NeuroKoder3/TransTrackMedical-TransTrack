# TransTrack — Operator Runbook

This is the short, prescriptive guide for standing the system up locally and
exercising the full integration surface end-to-end. Anyone evaluating the
codebase (buyer's diligence team, new operator, or reviewer) should be able
to follow this top to bottom and reach a passing smoke test in under five
minutes after Docker Desktop is installed.

For deeper docs, see:

- `server/README.md` — backend service architecture
- `server/src/integrations/epic/README.md` — Epic on FHIR module
- `docs/server/hl7-integration.md` — HL7 v2 / MLLP details

---

## 1. Prerequisites

- Windows / macOS / Linux with **Docker Desktop** running.
- **Node.js 20.x** on the host (the smoke test runs from the host, not from a
  container).
- A clone of this repository.

## 2. First-time setup (or after `git pull`)

Three commands. Run them in order from the repo root:

```powershell
docker compose -f docker/docker-compose.yml build api
docker compose -f docker/docker-compose.yml up -d postgres api
docker exec transtrack-api node src/db/migrate.js up
```

What each does:

| Step | Purpose |
|---|---|
| `build api` | Builds the API image from the current source. Must be rerun any time server code changes — the container is **not** source-mounted in this compose file. |
| `up -d postgres api` | Starts PostgreSQL 16 and the Fastify API + MLLP listener. Postgres is healthchecked; the API depends on it. |
| `migrate.js up` | Applies any pending SQL migrations against the running database (e.g., the SMART/FHIR/integration tables in `005_ehr_integration.sql`). |

You should now have:

- API + REST  → `http://localhost:8080`
- FHIR R4     → `http://localhost:8080/fhir`
- SMART OAuth → `http://localhost:8080/oauth2/*` and `.well-known/smart-configuration`
- CDS Hooks   → `http://localhost:8080/cds-services`
- MLLP/HL7 v2 → `tcp://localhost:2575`

Quick verification:

```powershell
curl http://localhost:8080/health
curl http://localhost:8080/.well-known/smart-configuration
curl http://localhost:8080/cds-services
```

All three should return HTTP 200 with JSON.

## 3. Run the end-to-end smoke test

```powershell
node scripts/smoke-test.mjs
```

The script provisions a fresh org + admin in the database, logs in, and walks
the full integration surface. Expected runtime: ~5–10 seconds. Final line on
success:

```
SMOKE TEST PASSED
```

### 3a. Include the Epic on FHIR sandbox round-trip

The Epic block is gated on an environment variable so CI doesn't need
internet access to Epic's sandbox. To enable it locally:

```powershell
$env:EPIC_SANDBOX_CLIENT_ID = "<your Epic non-production client id>"
node scripts/smoke-test.mjs
```

Requires `epic-keys/transtrack-epic-private.pem` to exist locally — that file
is **gitignored** for security and must be regenerated per environment. See
`server/src/integrations/epic/README.md` for the JWKS publishing pattern and
the matching Epic app configuration.

When enabled, the smoke test will additionally:

1. Pull a real patient bundle (Camila Lopez by default) from
   `fhir.epic.com` using SMART Backend Services with a JWT-bearer assertion.
2. POST that bundle to `/integrations/epic/import` on the local API.
3. Re-query the imported Patient through TransTrack's own FHIR API to
   confirm the round-trip landed.

## 4. Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` from the smoke test | Postgres container isn't running | `docker compose -f docker/docker-compose.yml up -d postgres` |
| `relation "smart_clients" does not exist` (or `fhir_resources`, etc.) | Migrations not applied | `docker exec transtrack-api node src/db/migrate.js up` |
| `/.well-known/smart-configuration` or `/cds-services` returns 401 | Stale API image — built before the SMART/CDS routes were added | `docker compose -f docker/docker-compose.yml build api && docker compose -f docker/docker-compose.yml up -d api` |
| `Body cannot be empty when content-type is set to 'application/json'` | Caller is sending a JSON content-type with no body. The smoke test handles this; if you see it from a custom client, omit the header on body-less POSTs. | Drop `Content-Type: application/json` when there is no body. |
| Epic sandbox returns `invalid_client` / `unauthorized_client` | The Epic app is still in Draft, the JWKS URL isn't pasted into the **Non-Production** field, or Epic hasn't refetched the JWKS yet | Open the app at `fhir.epic.com`, confirm Non-Production JWK Set URL is set, click **Save & Ready for Sandbox**, wait ~60 seconds, retry |

## 5. Tearing down

```powershell
docker compose -f docker/docker-compose.yml down
```

Add `-v` to also drop the Postgres volume (wipes all data, including the
applied migrations — you'll need to rerun step 2 next time).
