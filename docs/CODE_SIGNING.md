# Code Signing Setup

This document explains how TransTrack signs Windows and macOS release
artifacts and how to wire signing credentials into local builds and CI.

The signing scaffolding ships in the codebase. **What is not in the
codebase** is the certificate itself — that has to be procured externally
and the secrets wired into the environment. Once those are in place, no
further code changes are required.

---

## Windows Authenticode

### Modes supported

`scripts/sign-win.cjs` is the electron-builder hook that signs every
Windows artifact. It supports three modes selected by the
`TRANSTRACK_SIGN_MODE` environment variable:

| Mode           | Use case                                                         | Required env vars |
|----------------|------------------------------------------------------------------|-------------------|
| `ssl_esigner`  | Recommended for CI/CD. SSL.com eSigner cloud HSM (no USB token). | `ESIGNER_USERNAME`, `ESIGNER_PASSWORD`, `ESIGNER_CREDENTIAL_ID`, `ESIGNER_TOTP_SECRET`, `ESIGNER_TOOL_PATH` |
| `pfx`          | Local builds with a software-protected `.pfx` file.              | `CSC_LINK` (path to .pfx), `CSC_KEY_PASSWORD` |
| `skip`         | Unsigned development builds. Never use for release.              | (none) |

If `TRANSTRACK_SIGN_MODE` is **unset**, the script auto-detects in the
order `ssl_esigner` → `pfx` → `skip`.

### Recommended: SSL.com eSigner Cloud HSM

eSigner is preferable to a physical USB token because it works in
unattended CI without anyone physically present to insert the token.

Procurement steps:

1. Purchase **SSL.com EV Code Signing Certificate** with **eSigner
   Cloud Signing** (or DigiCert KeyLocker / Certum SimplySign — same
   shape).
2. Complete the SSL.com vetting process (D-U-N-S number required for EV).
3. Download **CodeSignTool** from the SSL.com dashboard. The tool ships
   as a `.bat` (Windows) or `.sh` (Linux/macOS) wrapper around a Java jar.
4. From the SSL.com dashboard, copy:
   - your account username and password,
   - the **Credential ID** (a UUID identifying the certificate slot),
   - the **TOTP secret** (a base32 string — this is the seed, not the
     6-digit code).

CI environment variables (e.g., GitHub Actions):

```text
TRANSTRACK_SIGN_MODE=ssl_esigner
ESIGNER_USERNAME=<your account username>
ESIGNER_PASSWORD=<your account password>
ESIGNER_CREDENTIAL_ID=<credential UUID>
ESIGNER_TOTP_SECRET=<base32 TOTP seed>
ESIGNER_TOOL_PATH=C:\\CodeSignTool\\CodeSignTool.bat
```

The signer derives a one-time TOTP code at sign time using the seed
(RFC 6238, SHA1, 30-second step, 6 digits).

### Alternate: PFX file (local-only)

For OV certificates or for one-off local release builds:

```text
TRANSTRACK_SIGN_MODE=pfx
CSC_LINK=C:\\path\\to\\TransTrack-codesign.pfx
CSC_KEY_PASSWORD=<pfx export password>
SIGN_TIMESTAMP_URL=http://timestamp.sectigo.com   (optional override)
```

The Windows SDK's `signtool.exe` must be on `PATH`. On GitHub Actions
the `windows-latest` runner ships with it; locally, install it via
the Windows 10/11 SDK.

### Verifying a signed artifact

On Windows:

```powershell
Get-AuthenticodeSignature .\release\enterprise\TransTrack-Enterprise-1.2.0-x64.exe
```

`Status` should be `Valid`, `SignerCertificate.Subject` should match
your organisation's name as registered with the CA.

---

## macOS Notarization

`scripts/notarize.cjs` is the `afterSign` hook. It is wired in
`electron-builder.enterprise.json` and runs automatically on macOS
builds when the required env vars are present.

### Required env vars

```text
APPLE_ID=<apple developer account email>
APPLE_APP_PASSWORD=<app-specific password — NOT your account password>
APPLE_TEAM_ID=<10-character Team ID, visible in App Store Connect>
```

Generate the app-specific password at <https://appleid.apple.com> →
**Sign-In and Security** → **App-Specific Passwords**.

The Developer ID Application certificate must be installed in the
build machine's Keychain, with private key marked as exportable. On
GitHub Actions, install via `import-codesign-certs` action (from a
base64-encoded `.p12` blob in CI secrets).

### Apple Developer enrolment

Apple notarization requires an **Organization** Apple Developer
account (not Individual). Procurement:

1. Acquire a D-U-N-S number for "TransTrack Medical Software" via
   <https://developer.apple.com/enroll/duns-lookup/> (free; takes
   2 weeks to issue).
2. Enrol at <https://developer.apple.com/programs/> ($99/year).
3. Apple verifies the D-U-N-S record matches your provided business
   information (typically 1–3 business days).
4. Once enrolled, generate a **Developer ID Application** certificate
   in **Certificates, Identifiers & Profiles**.

### Verifying a notarized artifact

On macOS:

```bash
spctl -a -vv "TransTrack Enterprise.app"
codesign -dv --verbose=4 "TransTrack Enterprise.app"
```

`spctl` should print `accepted` and `source=Notarized Developer ID`.

---

## Verifying the local installation of the signer

```powershell
node tests/signWin.test.cjs
```

This validates the auto-detect logic, base32 / TOTP, and the
input-shape resolver without needing a real certificate.

---

## CI matrix (GitHub Actions example)

```yaml
- name: Build signed installers
  shell: pwsh
  env:
    TRANSTRACK_SIGN_MODE:    ssl_esigner
    ESIGNER_USERNAME:        ${{ secrets.ESIGNER_USERNAME }}
    ESIGNER_PASSWORD:        ${{ secrets.ESIGNER_PASSWORD }}
    ESIGNER_CREDENTIAL_ID:   ${{ secrets.ESIGNER_CREDENTIAL_ID }}
    ESIGNER_TOTP_SECRET:     ${{ secrets.ESIGNER_TOTP_SECRET }}
    ESIGNER_TOOL_PATH:       C:\CodeSignTool\CodeSignTool.bat
    APPLE_ID:                ${{ secrets.APPLE_ID }}
    APPLE_APP_PASSWORD:      ${{ secrets.APPLE_APP_PASSWORD }}
    APPLE_TEAM_ID:           ${{ secrets.APPLE_TEAM_ID }}
    CSC_LINK:                ${{ secrets.MAC_DEVELOPER_ID_P12_BASE64 }}
    CSC_KEY_PASSWORD:        ${{ secrets.MAC_DEVELOPER_ID_P12_PASSWORD }}
  run: |
    npm ci
    npm run build:all
```

---

## Cost reference

| Item                                             | Indicative cost (USD/year) |
|--------------------------------------------------|----------------------------|
| SSL.com EV Code Signing + eSigner Tier 1 (1 yr)  | ~$330 (year 1 promo) → $499 |
| Certum EV Code Signing (1 yr)                    | ~$200                      |
| DigiCert EV Code Signing + KeyLocker (1 yr)      | ~$700                      |
| Apple Developer Program (Organization)           | $99                        |
| D-U-N-S registration                             | Free                       |

These are reference numbers as of writing; reconfirm with the CAs at
purchase time.
