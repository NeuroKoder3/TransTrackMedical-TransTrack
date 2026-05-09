# SECURITY ADVISORY: Malware impersonating TransTrack — `the-vishal-gupta` lookalike repos

**Status:** active — reports filed, takedowns in progress
**Reported:** 2026-05-08 / 2026-05-09
**Severity:** Critical (confirmed malware distribution under TransTrack brand)
**Affected systems:** any Windows host that downloaded and executed an archive named `Trans-Medical-Track-*.zip`, `github-the-io-gupta-vishal-revel.zip`, or `the_gupta_vishal_io_github_v3.9.zip` from the URLs below.

---

## TL;DR

A GitHub user, **`the-vishal-gupta`** (`https://github.com/the-vishal-gupta`), has set up two repositories and a GitHub Pages site that:

1. Distribute confirmed Windows malware under the **"TransTrackMedical-TransTrack"** brand;
2. Host a copy of this project's source code on a non-default branch, with a fabricated commercial LICENSE and `PRICING.md` directing payments to the legitimate maintainer's PayPal account in what appears to be a payment-fraud staging configuration;
3. Operate a polished GitHub Pages "download" page that claims to be the official TransTrack site and directs visitors to the malware archives.

**Do not download any "TransTrack", "TransTrackMedical", or "Trans-Medical-Track" archive that does not come from this repository's official [Releases page](https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases).** The only authorized contact for this project is **Trans_Track@outlook.com**.

---

## Confirmed malicious URLs

> ⚠️ **Do not visit these URLs in a browser unless you are working in an isolated sandbox or VM.** They are listed here for forensic and reporting purposes only.

- `https://github.com/the-vishal-gupta/TransTrackMedical-TransTrack` (impersonating repository)
- `https://github.com/the-vishal-gupta/TransTrackMedical-TransTrack/tree/main` (non-default branch hosting copied source code + fabricated commercial LICENSE)
- `https://github.com/the-vishal-gupta/the-vishal-gupta.github.io` (GitHub Pages source repo)
- `https://the-vishal-gupta.github.io/` (rendered "download" page)

### Malware archives (do not download outside a sandbox)

- `https://github.com/the-vishal-gupta/TransTrackMedical-TransTrack/raw/master/theomicrist/Trans-Medical-Track-2.1.zip`
- `https://github.com/the-vishal-gupta/TransTrackMedical-TransTrack/raw/master/theomicrist/Trans-Medical-Track-v1.7.zip`
- `https://github.com/the-vishal-gupta/the-vishal-gupta.github.io/raw/main/Satieno/github-the-io-gupta-vishal-revel.zip`
- `https://github.com/the-vishal-gupta/the-vishal-gupta.github.io/raw/main/Satieno/the_gupta_vishal_io_github_v3.9.zip`

---

## Malware analysis (VirusTotal)

VirusTotal scanned the URL `…/Satieno/github-the-io-gupta-vishal-revel.zip` (mirrored under the name `Trans-Medical-Track-2.1.zip` in the other repo, identical 493,748-byte payload):

- **Body SHA-256:** `063d4df029a44cf56cfa4b4d0c8d5cd2244383577389ad2de842aa3d11f869ac`
- **Detection rate:** **39 / 66** security vendors flagged the file as malicious.
- **Tags:** `zip`, `contains-pe`

The ZIP contains four bundled files:

| File | Type | Size | VT detections | Notes |
|---|---|---:|---:|---|
| `luau.exe` | Win32 .NET (MSIL) EXE | 282 KB | **36 / 70** | Detected as `Trojan.MSIL.Agent` / `Trojan.GenericKD` / `Trojan.Wacatac` / similar by Microsoft, Sophos, Bitdefender, Kaspersky, ESET, McAfee, Symantec, Trend Micro, CrowdStrike, Elastic, Cylance, Emsisoft, Fortinet, GData, AhnLab, Avast, AVG, Cynet, Ikarus, Quick Heal, Rising, Varist, VIPRE, ZoneAlarm, and others. |
| `asm.txt` | "Text" (obfuscated payload) | 302 KB | **24 / 60** | Disguised as plain text. At 302 KB this is the encrypted/obfuscated second-stage payload. |
| `luau1.dll` | Win32 DLL | 381 KB | 1 / 71 | Bundled alongside the dropper; low-detection but suspicious by association. |
| `StartApp.bat` | DOS batch file | 22 B | 1 / 61 | The autorun launcher; one short line that invokes `luau.exe`. |

The "luau" / "luau1" filenames are also unrelated to either the legitimate Luau language or any TransTrack component. They are kit-style names from a generic .NET trojan dropper.

---

## What the impersonator is doing — full picture

### 1. Lookalike landing page

`https://the-vishal-gupta.github.io/` presents itself as the official "TransTrackMedical-TransTrack" download page, claims HIPAA Security Rule, FDA 21 CFR Part 11, and AATB compliance, and directs visitors to a "Releases page." The page lists a fake support address — **`support@transtrackmedical.org`**, a domain not owned by this project.

### 2. Two-branch repository

The repository `the-vishal-gupta/TransTrackMedical-TransTrack`:

- **Default (`master`) branch** contains only an empty `basic.txt` file and a folder `theomicrist/` holding the malware archives. There is no source code on `master`.
- **`main` branch** (not visible from the default repository view) contains a **copy of this project's source code** as it existed during an earlier "commercial license" iteration. That copy includes:
  - A fabricated 7,644-byte `LICENSE` titled "TRANSTRACK COMMERCIAL SOFTWARE LICENSE AGREEMENT", referencing the legitimate maintainer's contact email;
  - A `PRICING.md` charging `$2,499 / $7,499 / $24,999` and including PayPal links of the form `https://www.paypal.me/<legitimate-maintainer-handle>/<amount>USD`;
  - A `LICENSE_NOTICE.md` claiming "evaluation use limited to 14 days";
  - A rewritten `README.md` that removes the legitimate maintainer's authorship and points readers at the malicious `theomicrist/` archives.

The PayPal handle in the fake `PRICING.md` belongs to the legitimate maintainer of *this* repository. The maintainer did not authorize, write, or push any of the content on `the-vishal-gupta`'s repositories. The presence of the legitimate PayPal link in a fraudulent commercial-license document is consistent with a payment-fraud staging configuration, not with redistribution of the project under its actual MIT license.

### 3. Mirrored payloads under SEO-stuffed names

The same two malware payloads appear in both of `the-vishal-gupta`'s repositories under different, keyword-stuffed paths (`theomicrist/`, `Satieno/`) and different filenames. The two larger archives have identical byte sizes (1,388,193 bytes); the two smaller archives have identical byte sizes (493,748 bytes). This is consistent with a generic distribution kit that auto-rotates filenames to evade pattern matching.

---

## How to verify you have the legitimate TransTrack

The **only** authoritative source for TransTrack / TransTrackMedical-TransTrack is:

| Item | Authoritative value |
|---|---|
| Repository | `https://github.com/NeuroKoder3/TransTrackMedical-TransTrack` |
| Releases page | `https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases` |
| Maintainer email | `Trans_Track@outlook.com` |
| First-use commit | `9c908f818145d86e0e07895c06eff1b147f31426` (24 January 2026) |
| Trademark notice | [`TRADEMARK.md`](https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/blob/main/TRADEMARK.md) in this repository |
| License | [MIT](https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/blob/main/LICENSE) — free of charge, no payment ever solicited |

Official installer artifacts use these exact name patterns:

- `TransTrack-<semver>-x64.exe` (Windows)
- `TransTrack-<semver>-x64.dmg`, `TransTrack-<semver>-arm64.dmg` (macOS)
- `TransTrack-<semver>.AppImage` (Linux)

Any file named `Trans-Medical-Track-<anything>`, `TransTrackMedical-TransTrack.zip`, anything under a `theomicrist/` or `Satieno/` path, or any "v3.9" / "v1.7" / "v2.1" archive purporting to be TransTrack is **not** a TransTrack release.

---

## If you may have downloaded a malicious ZIP

1. **Disconnect the affected machine from any network**, including Wi-Fi, before any further analysis.
2. Run a full scan with Microsoft Defender (with up-to-date signatures) or your organization's enterprise EDR product. The trojan is well-detected by every major engine; an up-to-date scanner will identify and quarantine it.
3. Rotate any credentials (browser-stored passwords, SSO tokens, RDP credentials, VPN, signing keys) that were present on the machine. .NET trojans of this family routinely include credential-theft modules.
4. **If the affected machine has handled or had visibility into PHI** (Protected Health Information): treat this as a potential PHI exposure event under your organization's incident-response and HIPAA breach-notification procedures. Notify your privacy / security officer and document the exposure window.
5. Email **`Trans_Track@outlook.com`** so we can keep a list of affected reporters and notify you when GitHub completes its takedowns.

---

## Reports filed / in progress

This impersonation is being reported (filings in progress as of the date of this advisory):

- GitHub Trust & Safety — Malware/Exploit report (with VirusTotal evidence)
- GitHub DMCA takedown (for source code copied on the `main` branch)
- GitHub Acceptable Use / Impersonation report
- FBI IC3 (Internet Crime Complaint Center) — federal complaint
- PayPal — notice of fraudulent use of the maintainer's payment link

This advisory will be updated as those reports are actioned and as further evidence becomes available.

---

## Acknowledgements

If you have additional samples, screenshots, archive snapshots (e.g., `web.archive.org`), VirusTotal report links, or evidence of distribution beyond the URLs above (other GitHub accounts, package registries, social-media posts, mirror sites, etc.), please send them to **`Trans_Track@outlook.com`**. We will incorporate them into the takedown reports.

— TransTrack maintainers
