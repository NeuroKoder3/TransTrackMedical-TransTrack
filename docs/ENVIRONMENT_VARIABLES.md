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
| `HTTP_PORT`                | Optional  | `8080`  | Server listen port. |
| `HTTP_HOST`                | Optional  | `0.0.0.0` | Server listen address. |
| `DATABASE_URL`             | Required  | —       | PostgreSQL connection URL (e.g. `postgres://user:pass@host/db`). |
| `JWT_SECRET`               | Required  | —       | Random 32+ byte string for signing JWTs. |
| `JWT_ISSUER`               | Optional  | `transtrack` | JWT `iss` claim value. |
| `JWT_AUDIENCE`             | Optional  | `transtrack-api` | JWT `aud` claim value. |
| `JWT_ACCESS_TTL_SECONDS`   | Optional  | `3600`  | Access token TTL. |
| `JWT_REFRESH_TTL_SECONDS`  | Optional  | `2592000` | Refresh token TTL. |
| `MFA_ISSUER_LABEL`         | Optional  | `TransTrack` | Label shown in authenticator apps. |
| `MFA_REQUIRED_FOR_ROLES`   | Optional  | `admin,coordinator,physician,regulator` | Comma-separated list of roles that require MFA. |
| `LOCKOUT_THRESHOLD`        | Optional  | `5`     | Failed login attempts before lockout. |
| `LOCKOUT_WINDOW_MINUTES`   | Optional  | `15`    | Window for counting failures. |
| `LOCKOUT_DURATION_MINUTES` | Optional  | `30`    | Account lockout duration. |
| `PASSWORD_MIN_LENGTH`      | Optional  | `12`    | Minimum password length. |
| `PASSWORD_HISTORY_COUNT`   | Optional  | `10`    | Number of previous passwords to block. |
| `LOG_LEVEL`                | Optional  | `info`  | Pino log level (fatal/error/warn/info/debug/trace). |
| `TRUST_PROXY`              | Optional  | `false` | Set `true` behind a reverse proxy. |
| `CORS_ALLOWED_ORIGINS`     | Optional  | —       | Comma-separated origins for CORS. |

### Identity provider (SSO)

| Variable                   | Required when    | Notes |
|----------------------------|------------------|-------|
| `OIDC_ENABLED`             | Optional         | `true` to enable OIDC login. |
| `OIDC_ISSUER`              | OIDC enabled     | Discovery URL, e.g. `https://customer.okta.com`. |
| `OIDC_CLIENT_ID`           | OIDC enabled     | |
| `OIDC_CLIENT_SECRET`       | OIDC enabled     | |
| `OIDC_REDIRECT_URI`        | OIDC enabled     | Callback URL. |
| `OIDC_SCOPES`              | Optional         | Default: `openid profile email`. |
| `OIDC_ROLE_CLAIM`          | Optional         | Default: `transtrack_role`. |
| `SAML_ENABLED`             | Optional         | `true` to enable SAML login. |
| `SAML_ENTRY_POINT`         | SAML enabled     | IdP SSO URL. |
| `SAML_ISSUER`              | Optional         | SP entity ID. Default: `urn:transtrack:sp`. |
| `SAML_CALLBACK_URL`        | SAML enabled     | SP ACS URL. |
| `SAML_IDP_CERT`            | SAML enabled     | IdP signing certificate (PEM). |
| `SAML_ROLE_ATTRIBUTE`      | Optional         | OID for role claim. |
| `SSO_ROLE_MAP`             | Optional         | JSON mapping IdP roles to TransTrack roles, e.g. `{"IdPAdmin":"admin"}`. |
| `SSO_UNKNOWN_ROLE_POLICY`  | Optional         | `deny` or `default_user` (default). |

### HL7 / FHIR (server)

| Variable                           | Required? | Default | Notes |
|------------------------------------|-----------|---------|-------|
| `HL7_MLLP_ENABLED`                | Optional  | `true`  | Enable MLLP listener. |
| `HL7_MLLP_HOST`                   | Optional  | `0.0.0.0` | MLLP bind address. |
| `HL7_MLLP_PORT`                   | Optional  | `2575`  | MLLP listen port. |
| `HL7_MLLP_TLS_CERT_FILE`          | Optional  | —       | TLS cert for MLLP. |
| `HL7_MLLP_TLS_KEY_FILE`           | Optional  | —       | TLS key for MLLP. |
| `HL7_MLLP_TLS_CA_FILE`            | Optional  | —       | CA cert for client auth. |
| `HL7_MLLP_TLS_REQUIRE_CLIENT_CERT`| Optional  | `true`  | Require mutual TLS. |
| `HL7_DEFAULT_ORG_ID`              | Optional  | —       | Default org for SSO and HL7 ingest. |
| `FHIR_BASE_URL`                   | Optional  | `http://localhost:8080/fhir` | FHIR base for self-references. |
| `FHIR_REQUIRE_AUTH`               | Optional  | `true`  | Require auth on FHIR endpoints. |

### Stripe billing & license provisioning (server)

| Variable                     | Required? | Default | Notes |
|------------------------------|-----------|---------|-------|
| `STRIPE_SECRET_KEY`          | Optional  | —       | Routes return 503 if absent. |
| `STRIPE_WEBHOOK_SECRET`      | Optional  | —       | Webhook signature verification. |
| `STRIPE_BILLING_RETURN_URL`  | Optional  | —       | Success/cancel URL base. |
| `STRIPE_PRICE_ID_STARTER`    | Optional  | —       | Stripe price ID for starter tier. |
| `STRIPE_PRICE_ID_PROFESSIONAL` | Optional | —      | Stripe price ID for professional tier. |
| `STRIPE_PRICE_ID_ENTERPRISE` | Optional  | —       | Stripe price ID for enterprise tier. |
| `LICENSE_PRIVATE_KEY_PATH`   | Optional  | —       | Ed25519 private key for signing licenses. Never commit. |
| `SMTP_HOST`                  | Optional  | —       | SMTP server for emailing licenses. |
| `SMTP_PORT`                  | Optional  | `587`   | SMTP port. |
| `SMTP_SECURE`                | Optional  | `false` | Use TLS for SMTP. |
| `SMTP_USER`                  | Optional  | —       | SMTP username. |
| `SMTP_PASSWORD`              | Optional  | —       | SMTP password. |
| `SMTP_FROM`                  | Optional  | —       | Sender email for license delivery. |

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

## Desktop authentication (enterprise)

| Variable                                  | Required? | Default | Notes |
|-------------------------------------------|-----------|---------|-------|
| `TRANSTRACK_INITIAL_ADMIN_PASSWORD`       | Optional  | random setup token | Used only on first launch when no admin exists. Forces password change after sign-in. |
| `TRANSTRACK_ADMIN_BREAK_GLASS_PASSWORD`   | Optional  | unset   | When set (≥12 chars) at process start, resets `admin@transtrack.local`, clears lockouts and MFA for that account, and forces password change. Unset after recovery. |
