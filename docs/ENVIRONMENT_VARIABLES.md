# Environment Variables Reference

Every environment variable TransTrack reads, organised by component.
Variables marked **Required** must be set for the listed component to
function; **Optional** variables fall back to a documented default.

> **PHI safety.** No environment variable should ever contain PHI. The
> only sensitive values are credentials (signing certificates, Epic
> private-key file paths, identity-provider client secrets). Provision
> these via your CI secret store or your container orchestrator's
> secret facility — never commit them to source control.

---

## Build / Release

| Variable                  | Required? | Used by | Default | Notes |
|---------------------------|-----------|---------|---------|-------|
| `NODE_ENV`                | Optional  | electron, server | `development` | `production` for packaged builds. |
| `ELECTRON_DEV`            | Optional  | electron | `0` | Set to `1` to force devtools in a dev build. |

## Code Signing — Windows

See `docs/CODE_SIGNING.md` for full details.

| Variable                  | Required when           | Notes |
|---------------------------|-------------------------|-------|
| `TRANSTRACK_SIGN_MODE`    | Optional                | `ssl_esigner` \| `pfx` \| `skip`. Auto-detected when unset. |
| `ESIGNER_USERNAME`        | `ssl_esigner`           | SSL.com account username. |
| `ESIGNER_PASSWORD`        | `ssl_esigner`           | SSL.com account password. |
| `ESIGNER_CREDENTIAL_ID`   | `ssl_esigner`           | UUID identifying the certificate slot. |
| `ESIGNER_TOTP_SECRET`     | `ssl_esigner`           | Base32 TOTP seed (NOT the 6-digit code). |
| `ESIGNER_TOOL_PATH`       | `ssl_esigner`           | Absolute path to `CodeSignTool.bat` (or `.sh`). |
| `CSC_LINK`                | `pfx`                   | Absolute path to `.pfx` file. |
| `CSC_KEY_PASSWORD`        | `pfx`                   | PFX export password. |
| `SIGN_TIMESTAMP_URL`      | Optional                | Default: `http://timestamp.sectigo.com`. |

## Code Signing — macOS

| Variable                  | Required when                | Notes |
|---------------------------|------------------------------|-------|
| `APPLE_ID`                | macOS notarization           | Apple Developer account email. |
| `APPLE_APP_PASSWORD`      | macOS notarization           | App-specific password — NOT the account password. |
| `APPLE_TEAM_ID`           | macOS notarization           | 10-character Team ID. |

When all three are absent, `scripts/notarize.cjs` skips silently and
the `.app` bundle is shipped unnotarized (Gatekeeper will flag it).

## Logger

| Variable                       | Required? | Default | Notes |
|--------------------------------|-----------|---------|-------|
| `SENTRY_DSN`                   | Optional  | unset   | When set, error+fatal logs are POSTed to this URL. No PHI is included. |
| `TRANSTRACK_REMOTE_LOG_URL`    | Optional  | unset   | Synonym for `SENTRY_DSN`. Either may be set. |
| `TRANSTRACK_REMOTE_LOG_LEVELS` | Optional  | `error,fatal` | Comma-separated list of levels to ship remotely. |

## Optional Server Tier

| Variable                   | Required? | Default | Notes |
|----------------------------|-----------|---------|-------|
| `PORT`                     | Optional  | `8080`  | Server listen port. |
| `DATABASE_URL`             | Required  | —       | PostgreSQL connection URL. |
| `JWT_SIGNING_KEY`          | Required  | —       | Random 32+ byte string. |
| `MFA_ENCRYPTION_KEY`       | Required  | —       | 32-byte hex for TOTP secret encryption. |

### Identity provider

| Variable                   | Required when    | Notes |
|----------------------------|------------------|-------|
| `OIDC_ISSUER_URL`          | OIDC enabled     | e.g. `https://customer.okta.com` |
| `OIDC_CLIENT_ID`           | OIDC enabled     | |
| `OIDC_CLIENT_SECRET`       | OIDC enabled     | |
| `SAML_IDP_METADATA_URL`    | SAML enabled     | |
| `SAML_SP_ENTITY_ID`        | SAML enabled     | |

## Epic on FHIR (multi-tenant)

See `server/src/integrations/epic/registry.js`. Three configuration
sources, in priority order:

### 1. JSON config file

```text
EPIC_CUSTOMERS_CONFIG=/etc/transtrack/epic-customers.json
```

File shape:

```json
{
  "customers": {
    "<orgId>": {
      "sandbox": {
        "clientId": "...",
        "tokenUrl": "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
        "fhirBase": "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
        "privateKeyFile": "/secrets/epic/<orgId>-sandbox.pem",
        "kid": "transtrack-epic-1",
        "scope": "system/Patient.read system/Observation.read ..."
      },
      "prod": { ... }
    }
  }
}
```

### 2. Per-customer env vars

The `<ORG_ID>` segment is uppercased; non-alphanumeric characters
become `_`. `<ENV>` is `SANDBOX` or `PROD`.

| Variable                                     | Notes |
|----------------------------------------------|-------|
| `EPIC_CLIENT_ID__<ORG_ID>__<ENV>`            | Required per (org, env). |
| `EPIC_PRIVATE_KEY_FILE__<ORG_ID>__<ENV>`     | Required per (org, env). |
| `EPIC_TOKEN_URL__<ORG_ID>__<ENV>`            | Optional. |
| `EPIC_FHIR_BASE__<ORG_ID>__<ENV>`            | Optional. |
| `EPIC_KID__<ORG_ID>__<ENV>`                  | Optional. |
| `EPIC_SCOPE__<ORG_ID>__<ENV>`                | Optional. |

### 3. Single-tenant fallback

For single-customer deployments, the `__<ORG_ID>__<ENV>` suffix can be
omitted: `EPIC_CLIENT_ID`, `EPIC_PRIVATE_KEY_FILE`, etc.

## Encryption (desktop)

| Variable                       | Required? | Default | Notes |
|--------------------------------|-----------|---------|-------|
| `TRANSTRACK_DB_KEY_OVERRIDE`   | No        | —       | Diagnostic-only; bypasses key derivation. Production builds reject this. |
