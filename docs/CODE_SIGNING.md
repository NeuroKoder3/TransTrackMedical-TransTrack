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
| **OV certificate + SSL.com eSigner** | ~$150–300/yr | **This is what TransTrack uses.** Same SmartScreen behaviour as EV, and the cloud HSM makes it work unattended in CI. Implemented as `ssl_esigner` mode. |
| **EV certificate** | ~$400–700/yr | Choose only if a customer's procurement process demands it. Same `ssl_esigner` mode — only the certificate differs. |
| Azure Artifact Signing | ~$10/month | Cheaper, but requires an organisation verifiable for **three years or more**. Not available to TransTrack Medical Software yet; revisit when the company clears that bar. |
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
Windows artifact. It supports three modes selected by the
`TRANSTRACK_SIGN_MODE` environment variable:

| Mode           | Use case                                                         | Required env vars |
|----------------|------------------------------------------------------------------|-------------------|
| `ssl_esigner`  | **The production route.** An OV (or EV) certificate held in SSL.com's cloud HSM. | `ESIGNER_USERNAME`, `ESIGNER_PASSWORD`, `ESIGNER_CREDENTIAL_ID`, `ESIGNER_TOTP_SECRET`, `ESIGNER_TOOL_PATH` |
| `pfx`          | A `.pfx` you already hold; internal and test builds.             | `CSC_LINK` (path **or** base64 content), `CSC_KEY_PASSWORD` |
| `skip`         | Unsigned development builds. Never use for release.              | (none) |

If `TRANSTRACK_SIGN_MODE` is **unset**, the script auto-detects in the
order `ssl_esigner` → `pfx` → `skip`. When a mode is named explicitly
but its variables are incomplete, the signer fails immediately and names the
missing variable rather than falling through to `skip`.

Whichever mode runs, the signer re-reads the artifact afterwards and fails the
build unless it now carries an embedded signature. A zero exit status is not
accepted as evidence on its own — CodeSignTool in particular has been observed
to report a failure and exit 0, and the point of the release gate is that no
unsigned artifact reaches a customer.

### OV certificate via SSL.com eSigner (the production route)

Since the June 2023 CA/Browser Forum rules, the private key for a code signing
certificate has to live in certified hardware. That leaves two shapes: a USB
token somebody physically plugs into the build machine, or a cloud HSM. Only the
second works in unattended CI, so this is the route TransTrack uses.

Only a *hash* of the artifact is sent to SSL.com. The installer itself never
leaves the build machine, which is the answer to the question a hospital
security reviewer will eventually ask.

**1. Buy the certificate.** An **SSL.com Code Signing Certificate**, OV unless a
customer's procurement demands EV, with **eSigner Cloud Signing** included.
DigiCert KeyLocker and Certum SimplySign are the same shape if you prefer them,
but the tooling below is SSL.com-specific.

**2. Complete vetting.** For OV this is organisation verification: SSL.com
confirms the legal entity exists and that you are authorised to request on its
behalf. Expect to supply incorporation documents and to take a verification
phone call at a number they establish independently. Budget a few business days.

**3. Enrol the certificate in eSigner** and set up TOTP two-factor
authentication, following SSL.com's
[automation guide](https://www.ssl.com/how-to/automate-esigner-ev-code-signing/).
When it shows you the QR code, also reveal and copy the **secret string** behind
it — that is what CI needs, and it is shown only at setup time.

**4. Download CodeSignTool** from the SSL.com dashboard. It ships as a `.bat`
(Windows) or `.sh` (Linux/macOS) wrapper around a Java jar. The Windows download
bundles a Java runtime; the Linux/macOS one requires Java to be installed.

**5. Collect four values** from the dashboard: account username, account
password, the **Credential ID** (a UUID naming the certificate slot), and the
**TOTP secret** from step 3.

CI environment variables (e.g., GitHub Actions):

```text
TRANSTRACK_SIGN_MODE=ssl_esigner
ESIGNER_USERNAME=<your account username>
ESIGNER_PASSWORD=<your account password>
ESIGNER_CREDENTIAL_ID=<credential UUID>
ESIGNER_TOTP_SECRET=<the TOTP secret string, not a 6-digit code>
ESIGNER_TOOL_PATH=C:\CodeSignTool\CodeSignTool.bat
ESIGNER_TOOL_URL=<direct download URL for the CodeSignTool zip>
```

`ESIGNER_TOOL_URL` is used by the release workflow to install CodeSignTool on
the runner before the build; SSL.com does not publish a stable URL, so take the
current one from your dashboard and store it as a repository secret. If the
mode is active and the URL is missing, the workflow fails rather than building
an unsigned installer.

Three details that cause most first-attempt failures:

**`ESIGNER_TOTP_SECRET` is the secret, not a code.** CodeSignTool computes the
six-digit code itself from the secret, which is why it can run unattended. The
secret is a long base64-looking string
(`ii5gVvZ9G+WkxB3FauAnoL/z14AXSMistcE0jZMWWNSjQDlql2kt2D6Z+l8=`), not the six
digits your authenticator app shows. Storing the digits produces `Error: invalid
otp`, which reads like a 2FA problem and is not.

**The account password cannot contain `"` or `%`.** CodeSignTool is a batch
file, so its arguments are re-parsed by the Windows command interpreter. Most
special characters survive being quoted; those two cannot — a double quote ends
the quoted run and a percent sign triggers variable expansion even inside
quotes. The signer refuses such a password up front with a clear message rather
than sending a corrupted one and letting it look like an authentication failure.
Every other special character is fine.

**A zero exit status is not proof.** CodeSignTool sometimes prints a failure and
exits 0. The signer therefore signs into a temporary directory, confirms a
signed file was actually produced, moves it over the original, and then re-reads
the artifact to confirm it carries a signature. Any of those failing fails the
build.

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
the signer's own auto-detect, and fails the release if none are. For Windows the
repository secrets are:

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

Buy an **SSL.com OV Code Signing Certificate with eSigner Cloud Signing**,
roughly $150–300/year. Skip EV unless a customer asks for it in writing — it
costs two to three times as much and, since Microsoft stopped granting it
automatic SmartScreen trust, buys nothing technical. If procurement later
insists on EV, the certificate changes and the pipeline does not: same
`ssl_esigner` mode, same four secrets.

The long pole is organisation vetting, not anything in this repository. Start
that before you need the release.

Azure Artifact Signing would be cheaper at about $10/month, but it requires an
organisation verifiable for three years or more, which TransTrack Medical
Software does not yet meet. Worth revisiting at renewal once the company clears
that bar.

macOS has no equivalent decision: Apple Developer Program Organization
enrolment at $99/year, and the D-U-N-S number takes about two weeks, so start
that first if a macOS build matters to you.
