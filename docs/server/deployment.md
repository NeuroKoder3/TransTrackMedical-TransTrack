# TransTrack Server — Deployment

This page covers running the API + MLLP listener locally and in
production-like environments. The Electron desktop app is **not**
required to run the server, but it can be configured as a thin client of
the server (see `docs/server/electron-thin-client.md`).

## Local quick start (Docker)

```bash
# 1. Start Postgres
cd docker
docker compose up -d postgres

# 2. Install server deps and apply schema
cd ../server
npm install
cp .env.example .env
# edit .env: set JWT_SECRET to 32+ random bytes
npm run migrate

# 3. Run the server
npm run dev
# REST API : http://localhost:8080
# MLLP/HL7 : tcp://localhost:2575
# FHIR R4  : http://localhost:8080/fhir/metadata
```

## Local quick start (without Docker)

You need a Postgres instance (16+) reachable. Set `DATABASE_URL` in
`.env`, then:

```bash
cd server
npm install
npm run migrate
npm run dev
```

## Production deployment

A reference Dockerfile is provided at `server/Dockerfile`. It runs as
the `node` user, exposes 8080 (HTTP) and 2575 (MLLP), and includes a
container healthcheck.

### Required environment

| Variable           | Notes                                                              |
| ------------------ | ------------------------------------------------------------------ |
| `DATABASE_URL`     | `postgres://user:pass@host:5432/db`                                |
| `PGSSL`            | `disable` / `require` / `verify-full` (use `verify-full` in prod)  |
| `JWT_SECRET`       | ≥32 random bytes; **rotate via blue/green deployment**             |
| `LOG_LEVEL`        | `info` (use `debug` only when diagnosing)                          |

### TLS for the HTTP API

Terminate TLS at your load balancer (recommended) or a reverse proxy
such as Nginx, Caddy, or AWS ALB. Set `TRUST_PROXY=true` so Fastify
honours `X-Forwarded-For` for rate limiting and audit IPs.

### TLS for the MLLP listener

Hospitals will universally require TLS-wrapped MLLP. Provide:

```bash
HL7_MLLP_TLS_CERT_FILE=/etc/transtrack/tls/mllp.crt
HL7_MLLP_TLS_KEY_FILE=/etc/transtrack/tls/mllp.key
HL7_MLLP_TLS_CA_FILE=/etc/transtrack/tls/clients-ca.crt
HL7_MLLP_TLS_REQUIRE_CLIENT_CERT=true
```

When `HL7_MLLP_TLS_REQUIRE_CLIENT_CERT=true`, the listener performs
mutual TLS — the hospital's interface engine must present a certificate
issued by the configured `CA_FILE`.

If you leave the cert/key paths blank in production the server logs a
warning and runs plaintext (do not do this).

### Hospital SSO (SAML 2.0)

```bash
SAML_ENABLED=true
SAML_ENTRY_POINT=https://idp.hospital.example/sso
SAML_ISSUER=urn:transtrack:sp
SAML_CALLBACK_URL=https://api.transtrack.hospital.example/auth/saml/callback
SAML_IDP_CERT="-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----"
SAML_EMAIL_ATTRIBUTE=urn:oid:0.9.2342.19200300.100.1.3
SAML_NAME_ATTRIBUTE=urn:oid:2.16.840.1.113730.3.1.241
SAML_ROLE_ATTRIBUTE=urn:oid:1.3.6.1.4.1.5923.1.1.1.7
HL7_DEFAULT_ORG_ID=<uuid of the org for SSO-provisioned users>
```

### Hospital SSO (OpenID Connect)

```bash
OIDC_ENABLED=true
OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
OIDC_CLIENT_ID=<azure ad app id>
OIDC_CLIENT_SECRET=<secret>
OIDC_REDIRECT_URI=https://api.transtrack.hospital.example/auth/oidc/callback
OIDC_SCOPES=openid profile email
OIDC_ROLE_CLAIM=transtrack_role
HL7_DEFAULT_ORG_ID=<uuid of the org for SSO-provisioned users>
```

## Migrations

Forward-only SQL files under `server/src/db/migrations/` are run in
filename order. The runner is invoked as `npm run migrate`. There is no
automated downgrade path; write a new forward-migration to undo.

## Backups

Use the Postgres backup tooling appropriate for your environment
(`pg_basebackup`, point-in-time recovery, managed RDS snapshots, etc.).
The audit-log hash chain provides cryptographic evidence of the order
and content of past events; **do not** restore an audit-log table from a
backup that pre-dates rows in the surrounding tables — verify the chain
post-restore via `GET /audit/verify`.

## Observability

The server uses `pino` for structured JSON logs. Recommended sinks:

- stdout to your container platform (default)
- `SIEM_ENABLED=true` + `SIEM_ENDPOINT` to forward audit events to your
  SIEM (Splunk, Sentinel, Chronicle, Elastic) — implementation hook
  in `src/services/auditService.js` (TODO: add forwarder).

## Health checks

- `GET /health` — process is alive
- `GET /ready`  — process can reach Postgres
