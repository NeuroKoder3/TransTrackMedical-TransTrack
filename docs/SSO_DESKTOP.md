# TransTrack Desktop SSO — Operator's Guide

The TransTrack desktop client supports **OIDC** (OpenID Connect) sign-in
via the user's enterprise identity provider, using the system browser
and PKCE. **SAML** is supported on the server side only; if your
deployment is server-backed, customers can use SAML through the API
server — see `docs/SAML.md`.

## Supported identity providers

The OIDC flow is standards-compliant, so any OIDC-conformant IdP works:

- Microsoft Entra ID (Azure AD)
- Okta
- Google Workspace
- Auth0
- Ping Identity
- Keycloak
- ADFS 2016+ in OIDC mode

## How the flow works

```
┌──────────────┐         1. start         ┌──────────────────────┐
│  TransTrack  │ ───────────────────────► │   Main process       │
│  Renderer    │                          │  oidcDesktop.cjs     │
└──────┬───────┘                          └──────────┬───────────┘
       │                                             │ 2. PKCE + state
       │                                             │ 3. shell.openExternal()
       │                                             ▼
       │                                  ┌──────────────────────┐
       │                                  │  System browser      │
       │                                  │   → IdP authorize    │
       │                                  └──────────┬───────────┘
       │                                             │ 4. user logs in
       │         transtrack://auth/callback?code=... │
       │           (OS dispatches via protocol)      │
       │                                             ▼
       │                                  ┌──────────────────────┐
       │                                  │  Main process        │
       │                                  │  - exchange code     │
       │                                  │  - verify nonce      │
       │                                  │  - lookup local user │
       │                                  │  - mint session      │
       │                                  └──────────┬───────────┘
       │                                             │
       │           auth:ssoCompleted broadcast       │
       │ ◄───────────────────────────────────────────┘
       │
       ▼
  refreshAuth()
```

## Customer setup (per organization)

### 1. Register TransTrack as an OIDC client with your IdP

For most IdPs you need to create an **application** (or "client") with:

- **Application type:** Native / Desktop application
- **Redirect URI (sign-in):** `transtrack://auth/callback`
- **Grant type:** Authorization Code + PKCE
- **Token endpoint authentication:** None (PKCE-based)
- **Scopes:** `openid email profile`

Copy the **Issuer URL** and the **Client ID**.

#### Azure AD example
- App registrations → New registration → Public client / native
- Redirect URI: `transtrack://auth/callback`
- API permissions → Microsoft Graph → `openid`, `email`, `profile`
- Issuer: `https://login.microsoftonline.com/<tenant-id>/v2.0`

#### Okta example
- Applications → Create App Integration → OIDC, Native Application
- Sign-in redirect URI: `transtrack://auth/callback`
- Grant type: Authorization Code + PKCE
- Issuer: `https://<your-okta-domain>/oauth2/default`

### 2. Configure TransTrack

A TransTrack administrator opens **Settings → SSO** and enters:

- **OIDC Issuer URL** (from step 1)
- **Client ID** (from step 1)

These are persisted in the SQLite `app_settings` table.

### 3. Provision SSO-enabled local users

For every employee who should be able to sign in via SSO, an admin
creates (or updates) a local user with:

- **Email:** must match the `email` claim returned by the IdP
- **`sso_enabled = 1`** (set via the admin UI or SQL)

> **Why a local user is still required:** TransTrack issues sessions
> against the local `users` table. The IdP identity is a *trust anchor*
> for authentication, but the user's role, organization, and audit
> identity all live locally. This also lets you provision SSO without
> giving every Active-Directory user implicit access to PHI.

If a user attempts SSO sign-in without a matching, `sso_enabled = 1`
local row, the flow aborts with:

> No SSO-enabled local account for *email*. Ask your administrator to
> provision the user with sso_enabled=1.

## Verifying the flow

1. Install TransTrack on a workstation.
2. Configure OIDC issuer + client ID (Settings → SSO).
3. Provision a test user (sso_enabled = 1, email matching IdP).
4. Sign out, return to the login screen.
5. Click **Sign in with your organization (SSO)**.
6. The system browser opens to your IdP. Authenticate.
7. The IdP redirects to `transtrack://auth/callback?...`. The OS
   dispatches this to the running TransTrack process; the login page
   automatically transitions to the dashboard.

If anything fails the login page surfaces a precise error message
(`State mismatch`, `IdP returned error: access_denied`, etc.) — these are
the same strings used in the unit tests at `tests/oidcDesktop.test.cjs`.

## Security notes

- **PKCE S256** is the only supported challenge method — no `plain`,
  no implicit flow.
- The `state` and `nonce` parameters are random 24-byte values bound to
  an in-memory pending-flow record; only one flow can be pending at a
  time, and constant-time comparison defends against timing side
  channels.
- The TLS-protected token exchange + PKCE binding mean an attacker who
  intercepts the redirect URL **cannot** complete the exchange without
  the code_verifier, which never leaves the main process.
- **Future hardening (planned):** verify the `id_token` JWT signature
  against the IdP's JWKS. PKCE already gates replay, but signature
  verification adds defense-in-depth against a compromised IdP-side
  attestation. This is tracked as a follow-up in the SSO roadmap.
- The flow does **not** automatically create local users from the IdP
  directory. SCIM-style provisioning is intentionally out of scope here
  — provisioning happens via the existing TransTrack admin UI.

## What this is NOT

- This is not a **federated authorization** system — TransTrack roles
  are stored locally, not derived from IdP groups. (We can add SCIM in
  a future release if customers ask for it.)
- This is not a **session bridge** — sign-out in TransTrack does NOT
  sign the user out of their IdP. That's the OS / IdP's responsibility.
- This is not a substitute for **MFA enforcement at the IdP**. We
  recommend customers enforce MFA at the IdP for any SSO-enabled user.
