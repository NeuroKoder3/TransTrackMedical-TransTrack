# Code Signing Setup

This document explains how TransTrack signs Windows and macOS release
artifacts and how to wire signing credentials into local builds and CI.

The signing scaffolding ships in the codebase. **What is not in the
codebase** is the certificate itself — that has to be procured externally
and the secrets wired into the environment. Once those are in place, no
further code changes are required.

## Commercial-release gate

The release-readiness check (`scripts/release-readiness-check.mjs`)
treats signing as **optional** in the default mode so day-to-day dev
builds don't require certificates. For a build that is going to be sold
or pushed to a customer, run:

```bash
npm run release:check:for-sale
```

This sets `TRANSTRACK_RELEASE_CHANNEL=public` and promotes every signing
and notarization check to **mandatory**. The CI workflow at
`.github/workflows/release.yml` invokes this gate on every `v*.*.*` tag
and fails the build if signing credentials are missing — meaning **no
unsigned binary can be published to a customer through the normal
release path**.

---

## Signing fails closed on a release

A developer build with no certificate produces an unsigned artifact and a
warning, which is what you want day to day. A **release** build that came out
unsigned used to do exactly the same thing, which is the dangerous case: the
build went green, the warning scrolled past in electron-builder's output, and
nothing downstream looked at the file.

Both the Windows signer and the macOS notarization hook now treat a missing
credential as a build failure when either of these is set:

```text
TRANSTRACK_RELEASE_CHANNEL=public     # also what promotes the release gate to mandatory
TRANSTRACK_REQUIRE_SIGNING=1          # Windows only
TRANSTRACK_REQUIRE_NOTARIZATION=1     # macOS only
```

`.github/workflows/release.yml` sets `TRANSTRACK_RELEASE_CHANNEL=public` on both
build jobs, so a tagged release cannot silently produce an unsigned binary.

Separately, the release gate now **inspects the artifact** rather than trusting
that the hook ran. See "Verifying a signed artifact" below.

---

## Choosing a Windows certificate

Read this before buying anything — the guidance that circulated for years is out
of date.

**EV no longer buys you SmartScreen trust.** Historically an Extended Validation
certificate granted immediate SmartScreen reputation, and that was the reason to
pay the premium. Microsoft removed that behaviour; their current documentation
states that EV certificates no longer bypass SmartScreen and that "paying a
premium for EV solely to avoid SmartScreen warnings is no longer justified." An
OV certificate and an EV certificate now produce the same first-download
experience: a warning that fades as download volume accumulates reputation, per
file hash.

EV may still be worth it for one non-technical reason: **enterprise procurement**.
Hospital security reviews sometimes name EV explicitly. That is a sales question,
not an engineering one.

| Option | Indicative cost | Notes |
|---|---|---|
| **Azure Artifact Signing** (formerly Trusted Signing) | ~$10/month | Microsoft's recommended route for non-Store distribution. No hardware token, no annual re-issue, CI-native. Organisations in US/Canada/EU/UK; individuals US/Canada only. Implemented as `azure` mode. |
| **OV certificate** (Sectigo, DigiCert, Certum, SSL.com) | ~$150–300/yr | Same SmartScreen behaviour as EV. Works with `pfx` mode, or with a cloud HSM via `ssl_esigner`. |
| **EV certificate** | ~$400–700/yr | Choose only if a customer's procurement process demands it. |
| Apple Developer Program (Organization) | $99/yr | Required for notarization; no alternative. |
| D-U-N-S registration | Free | Needed for Apple organisation enrolment and for EV vetting. |

Two constraints worth knowing before you commit:

* Since **June 2023** the CA/Browser Forum requires the private key for *any*
  code signing certificate — OV as well as EV — to live in a FIPS-compliant
  hardware module. That means either a shipped USB token or a cloud HSM
  (SSL.com eSigner, DigiCert KeyLocker, Certum SimplySign). A plain `.pfx` you
  can copy around is no longer issuable, so `pfx` mode is for certificates you
  already hold, internal builds, and test signing.
* Since **February 2026** certificates are capped at 460 days. A multi-year
  purchase from a traditional CA now means a new hardware device each year.

---

## Windows Authenticode

### Modes supported

`scripts/sign-win.cjs` is the electron-builder hook that signs every
Windows artifact. It supports four modes selected by the
`TRANSTRACK_SIGN_MODE` environment variable:

| Mode           | Use case                                                         | Required env vars |
|----------------|------------------------------------------------------------------|-------------------|
| `azure`        | Recommended. Azure Artifact Signing — no certificate to buy.     | `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, `AZURE_SIGNING_DLIB`, plus `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` |
| `ssl_esigner`  | A traditional CA certificate held in SSL.com's cloud HSM.        | `ESIGNER_USERNAME`, `ESIGNER_PASSWORD`, `ESIGNER_CREDENTIAL_ID`, `ESIGNER_TOTP_SECRET`, `ESIGNER_TOOL_PATH` |
| `pfx`          | A `.pfx` you already hold; internal and test builds.             | `CSC_LINK` (path **or** base64 content), `CSC_KEY_PASSWORD` |
| `skip`         | Unsigned development builds. Never use for release.              | (none) |

If `TRANSTRACK_SIGN_MODE` is **unset**, the script auto-detects in the
order `ssl_esigner` → `azure` → `pfx` → `skip`. When a mode is named explicitly
but its variables are incomplete, the signer fails immediately and names the
missing variable rather than falling through to `skip`.

### Azure Artifact Signing (recommended)

Microsoft signs on your behalf against a certificate you never possess. There
is no `.pfx`, no USB token, no yearly re-issue, and no private key on the build
machine — `signtool` loads a library that authenticates to Azure and the
signature is produced server-side.

Eligibility is the one thing to check before committing: your organisation must
have been verifiable for **three years or more**. Newer organisations, and
individuals, can enrol but the certificate subject shows an unverified identity.

**1. Set up the Azure resources.** In the portal, create an Artifact Signing
account, complete identity validation, and create a certificate profile of type
*Public Trust*. Note the region — the endpoint URI must match it, and a mismatch
surfaces as an opaque 403 during signing.

| Region | Endpoint |
|---|---|
| East US | `https://eus.codesigning.azure.net` |
| West US 2 | `https://wus2.codesigning.azure.net` |
| West US 3 | `https://wus3.codesigning.azure.net` |
| West Central US | `https://wcus.codesigning.azure.net` |
| North Europe | `https://neu.codesigning.azure.net` |
| West Europe | `https://weu.codesigning.azure.net` |

(Full list in [Microsoft's integration guide](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations).)

**2. Create a service principal for CI.** Register an application in Entra ID,
create a client secret, and grant it the **Trusted Signing Certificate Profile
Signer** role on the Artifact Signing account. Without that role assignment
signing fails with a 403 that looks identical to a wrong endpoint.

**3. Install the client tools on the signing machine.** One MSI supplies the
dlib, the .NET 8 runtime, and a new-enough `signtool`:

```powershell
winget install -e --id Microsoft.Azure.ArtifactSigningClientTools
```

The release workflow does this automatically when `azure` mode is selected.

**4. Set the environment:**

```text
TRANSTRACK_SIGN_MODE=azure
AZURE_SIGNING_ENDPOINT=https://eus.codesigning.azure.net
AZURE_SIGNING_ACCOUNT=<Artifact Signing account name>
AZURE_SIGNING_PROFILE=<certificate profile name>
AZURE_SIGNING_DLIB=C:\Program Files\Microsoft\Azure Artifact Signing Client Tools\bin\x64\Azure.CodeSigning.Dlib.dll
AZURE_TENANT_ID=<Entra tenant id>
AZURE_CLIENT_ID=<app registration client id>
AZURE_CLIENT_SECRET=<client secret>
```

Two things worth understanding about how this mode behaves.

**Timestamping is not optional.** Artifact Signing certificates are valid for
**three days**. A signature survives past that only because a timestamp proves
it was made while the certificate was live. The signer always timestamps against
Microsoft's authority (`http://timestamp.acs.microsoft.com`). Override
`SIGN_TIMESTAMP_URL` only if you know why; an installer signed without a
timestamp verifies for three days and then begins failing on customer machines
with nothing about the file having changed.

**The credential chain is narrowed deliberately.** `DefaultAzureCredential`
tries a series of credential sources in order, one of which opens a browser. On
a headless build that hangs rather than fails. When a service principal is
present in the environment the signer excludes every other source; with
federated identity (GitHub OIDC, managed identity) it keeps the chain but still
excludes the browser.

If signing fails, the two common causes are both reported as a generic
`SignerSign()` error by `signtool`, so the signer adds a hint: a **403** is
almost always a region mismatch or a missing role assignment, and a **dlib load
failure** is almost always a missing .NET 8 runtime or an x64/x86 mismatch
between `signtool` and the dlib. Note that the 20348 Windows SDK does not work
with this dlib; you need 10.0.2261.755 or newer.

### Cloud HSM via SSL.com eSigner

A cloud HSM is preferable to a physical USB token because it works in
unattended CI without anyone present to insert the token. Since the 2023
hardware-key requirement this is effectively the only workable CI option for a
traditional CA certificate.

Procurement steps:

1. Purchase an **SSL.com Code Signing Certificate** — OV unless a customer
   requires EV — with **eSigner Cloud Signing** (or DigiCert KeyLocker /
   Certum SimplySign — same shape).
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
ESIGNER_TOOL_PATH=C:\CodeSignTool\CodeSignTool.bat
ESIGNER_TOOL_URL=<direct download URL for the CodeSignTool zip>
```

`ESIGNER_TOOL_URL` is used by the release workflow to install CodeSignTool on
the runner before the build; SSL.com does not publish a stable URL, so take the
current one from your dashboard and store it as a repository secret. If the
mode is active and the URL is missing, the workflow fails rather than building
an unsigned installer.

The signer derives a one-time TOTP code at sign time using the seed
(RFC 6238, SHA1, 30-second step, 6 digits).

### Alternate: PFX file

For a certificate you already hold, or for internal and test builds:

```text
TRANSTRACK_SIGN_MODE=pfx
CSC_LINK=C:\path\to\TransTrack-codesign.pfx
CSC_KEY_PASSWORD=<pfx export password>
SIGN_TIMESTAMP_URL=http://timestamp.sectigo.com   (optional override)
```

`CSC_LINK` accepts either a filesystem path or the base64-encoded contents of
the `.p12`/`.pfx` itself — the latter is how a certificate is normally carried
in a CI secret. Base64 content is written to a temporary file with owner-only
permissions and deleted in a `finally` block whether signing succeeds or not.

The Windows SDK's `signtool.exe` must be on `PATH`. On GitHub Actions
the `windows-latest` runner ships with it; locally, install it via
the Windows 10/11 SDK.

### Verifying a signed artifact

The release gate does this for you — `scripts/release-readiness-check.mjs`
inspects the installer and fails if it is not really signed. To run the check by
hand:

```bash
node scripts/verify-artifact-signature.mjs "release/enterprise/TransTrack-Enterprise-1.2.1-x64.exe"
```

On Windows it asks the OS (`Get-AuthenticodeSignature`) and requires a `Valid`
verdict. Elsewhere — the release gate runs on Linux — it parses the PE
Attribute Certificate Table directly, which proves a signature is embedded but
not that it chains to a trusted root; the output labels that reduced assurance
rather than claiming more than it checked.

A **catalog-only** signature is rejected even though Windows reports it `Valid`.
Catalog signatures live in a system-wide `.cat` file, not in the executable, so
they do not survive a download to a customer's machine.

If the machine cannot evaluate a trust chain at all — no network for the
revocation check, or a `Get-AuthenticodeSignature` that returns nothing, which
is what some hosted runners do — the check reports that a signature is embedded
and says plainly that validity was not established, rather than reporting the
artifact as unsigned. Always confirm on a networked host before distributing.

To inspect the signer identity:

```powershell
Get-AuthenticodeSignature .\release\enterprise\TransTrack-Enterprise-1.2.1-x64.exe |
  Format-List Status, SignerCertificate
```

`Status` should be `Valid` and the certificate subject should match your
organisation's name as registered with the CA.

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

Apple's own term is "app-specific password", so `APPLE_APP_SPECIFIC_PASSWORD`
is a natural guess and an easy mistake — the hook reads `APPLE_APP_PASSWORD`. If
it finds the longer name set instead, it says so by name rather than reporting
the variable as simply absent.

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

## Testing the signing path without a certificate

```powershell
node tests/signWin.test.cjs           # mode selection, fail-closed, TOTP, cert materialisation
node tests/notarize.test.cjs          # notarization credential handling
node tests/artifactSignature.test.mjs # PE parsing and the release-gate verdict
```

All three run in `npm test` as part of the functional suite. None needs a real
certificate: the signer tests drive the decision logic with a synthetic
environment, and the signature tests synthesise PE images. On Windows the
signature suite additionally checks `node.exe` (genuinely signed, must be
accepted) and `notepad.exe` (catalog-signed, must be rejected).

---

## CI

`.github/workflows/release.yml` builds and signs on tag push. A `preflight` job
picks the mode from whichever secrets are present, using the same precedence as
the signer's own auto-detect, and fails the release if none are. For Azure the
repository secrets are:

```text
AZURE_SIGNING_ENDPOINT
AZURE_SIGNING_ACCOUNT
AZURE_SIGNING_PROFILE
AZURE_TENANT_ID
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
```

The workflow installs the client tools on the runner and sets
`AZURE_SIGNING_DLIB` to the default install path; override it with an
`AZURE_SIGNING_DLIB` repository *variable* if you use a self-hosted runner that
provisions it elsewhere.

For eSigner instead:

```yaml
env:
  TRANSTRACK_RELEASE_CHANNEL: public          # makes signing mandatory
  ESIGNER_USERNAME:          ${{ secrets.ESIGNER_USERNAME }}
  ESIGNER_PASSWORD:          ${{ secrets.ESIGNER_PASSWORD }}
  ESIGNER_CREDENTIAL_ID:     ${{ secrets.ESIGNER_CREDENTIAL_ID }}
  ESIGNER_TOTP_SECRET:       ${{ secrets.ESIGNER_TOTP_SECRET }}
  ESIGNER_TOOL_URL:          ${{ vars.ESIGNER_TOOL_URL }}
  ESIGNER_TOOL_PATH:         ${{ vars.ESIGNER_TOOL_PATH || 'D:\CodeSignTool\CodeSignTool.bat' }}
```

and for macOS:

```yaml
env:
  TRANSTRACK_RELEASE_CHANNEL: public          # makes notarization mandatory
  APPLE_ID:            ${{ secrets.APPLE_ID }}
  APPLE_APP_PASSWORD:  ${{ secrets.APPLE_APP_PASSWORD }}
  APPLE_TEAM_ID:       ${{ secrets.APPLE_TEAM_ID }}
  CSC_LINK:            ${{ secrets.MAC_DEVELOPER_ID_P12_BASE64 }}
  CSC_KEY_PASSWORD:    ${{ secrets.MAC_DEVELOPER_ID_P12_PASSWORD }}
```

Each job verifies its own output before uploading: the Windows job runs
`verify-artifact-signature.mjs` against the installer, and the macOS job runs
`spctl`/`codesign` against the app bundle. A build that produced an unsigned or
un-notarized artifact fails there even if the hooks somehow did not.

---

## What to do first

Use **Azure Artifact Signing**. It is roughly $10/month, needs no certificate
purchase, no hardware token, and no annual re-issue, and it is implemented as
`azure` mode. The setup is four steps and is written out above; the only thing
to verify before committing is the three-year organisation age requirement.

Fall back to an **OV certificate with cloud HSM signing** (`ssl_esigner`) if you
are not eligible for Artifact Signing. Skip EV unless a customer asks for it in
writing.

macOS has no equivalent decision: Apple Developer Program Organization
enrolment at $99/year, and the D-U-N-S number takes about two weeks, so start
that first if a macOS build matters to you.
