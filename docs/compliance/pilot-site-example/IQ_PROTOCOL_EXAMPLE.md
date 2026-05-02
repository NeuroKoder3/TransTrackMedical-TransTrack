# IQ Protocol — TransTrack Installation Qualification (Worked Example)

> ## ⚠ DEMONSTRATION ONLY — NOT A REAL VALIDATION RECORD
>
> "Northshore Regional Transplant Center" is a **fictional** organization.
> All test results below are **synthetic** demonstration data. See
> [`README.md`](README.md). The purpose of this file is to model what an
> executed IQ protocol looks like end-to-end so a real pilot site has a
> walkthrough to follow against the empty template at
> [`../templates/IQ_PROTOCOL_TEMPLATE.md`](../templates/IQ_PROTOCOL_TEMPLATE.md).

---

| Document control | |
|---|---|
| Document ID | TT-IQ-NRTC-001 (example) |
| Software version | **v1.2.0** (build `e1436e2`) |
| Target host | NRTC-TX-WS01 — Coordinator workstation 1 (Windows 11 22H2) *(example)* |
| Executed by | _J. Park, Center IT_ *(role-title placeholder)* |
| Reviewed by | _Marcus Johnson, MS — QA Officer_ *(role-title placeholder)* |
| Date executed | 2026-05-22 *(example)* |

## Purpose

Verify that TransTrack v1.2.0 has been installed on the target host
correctly, on a hardened OS image, with all prerequisites met, and that
the running build matches the validated release.

## Reference workstation specification

| Item | Required | Actual at NRTC-TX-WS01 (example) |
|---|---|---|
| Operating system | Windows 10/11 (22H2 or later), macOS 12+, or RHEL 8/9 | Windows 11 Pro 22H2 (build 22631.4317) |
| CPU | 4-core x86_64 or arm64 | Intel i5-13500 (6P+8E) |
| RAM | ≥8 GB | 32 GB |
| Disk | ≥256 GB SSD | 512 GB NVMe |
| Disk encryption | BitLocker / FileVault / LUKS enabled | BitLocker XTS-AES-256, TPM-protected, recovery key escrowed in Center AD |
| OS account | Per-user; no shared accounts | Per-user, no local-admin for `transtrack-svc` runtime account |
| AV / EDR | Customer-standard endpoint security agent | CrowdStrike Falcon (NRTC sensor group `Clinical-Hardened`) |
| Network egress | Default-deny; SIEM / EHR endpoints whitelisted only | Default-deny via Center firewall; only the Center SIEM (`siem.nrtc.local:514`) is whitelisted from this host |

## Test cases (executed)

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| IQ-01 | Verify host meets the reference specification. | All items checked. | **PASS** | Workstation spec sheet `NRTC-WS01-spec-2026-05-22.pdf` |
| IQ-02 | Verify host disk is encrypted. | Yes. | **PASS** | Screenshot of `manage-bde -status C:` output, BitLocker XTS-AES-256, "Fully Encrypted" |
| IQ-03 | Verify only authorized users have OS-level local-admin rights. | Documented list matches actual. | **PASS** | Output of `net localgroup administrators` matches Center AD group `NRTC-TX-Admins` (3 members), no extra users |
| IQ-04 | Install TransTrack v1.2.0 from the signed installer (`TransTrack-Enterprise-1.2.0-x64.exe`). | Installer signature valid; installation completes without error. | **PASS** | Right-click → Properties → Digital Signatures: `signed by SSL.com EV Code Signing CA Intermediate, valid` (per Center policy that v1.2.0 is signed for the pilot) — install log `TransTrack-install-2026-05-22.log`, exit code 0 |
| IQ-05 | Compute SHA-256 of installed `electron/main.cjs` and compare to the release manifest. | Hashes match. | **PASS** | `Get-FileHash` SHA-256: matches the v1.2.0 release manifest published in `release/enterprise/latest.yml` |
| IQ-06 | Launch TransTrack and verify the About dialog reports v1.2.0. | Yes. | **PASS** | Screenshot `iq06-about-dialog.png`: "TransTrack 1.2.0 (build e1436e2)" |
| IQ-07 | Verify the encrypted database file (`transtrack.db`) is created at `%APPDATA%\TransTrack\` (Windows). | Yes. | **PASS** | `dir %APPDATA%\TransTrack\transtrack.db` shows file present, 96 KB initial size |
| IQ-08 | Verify the database file is not human-readable (cannot open as plain SQLite). | `sqlite3` reports "file is encrypted or is not a database". | **PASS** | `sqlite3 %APPDATA%\TransTrack\transtrack.db ".tables"` → `Error: file is not a database` (SQLCipher-encrypted) |
| IQ-09 | Verify the integrity-check pass occurs at startup (log line). | Log line present. | **PASS** | `transtrack.log` line: `2026-05-22T13:08:14.221Z INFO db.integrityCheck status=ok pages=42 elapsedMs=18` |
| IQ-10 | Run `system:getMigrationStatus` (admin) and verify all migrations are applied. | `pending: 0`. | **PASS** | Admin → System Diagnostics → Migration Status screen: "Applied: 27, Pending: 0" |
| IQ-11 | Verify outbound network access is restricted to whitelisted endpoints. | Network capture shows no unexpected egress. | **PASS** | 30-min Wireshark capture `iq11-egress.pcapng`: only DNS to `dns.nrtc.local`, NTP to `time.nrtc.local`, syslog to `siem.nrtc.local:514` |
| IQ-12 | Verify the host clock is synchronized to authorized NTP source. | Drift ≤2 seconds. | **PASS** | `w32tm /query /status` → drift 0.014 s, source `time.nrtc.local` |

## Acceptance

100% of mandatory IQ test cases must pass.

**Result: 12/12 PASS. IQ accepted.**

| Role | Name (placeholder) | Signature | Date |
|---|---|---|---|
| Executor | _J. Park, Center IT_ | _signed_ | 2026-05-22 |
| Reviewer | _Marcus Johnson, MS — QA Officer_ | _signed_ | 2026-05-23 |

---

> *End-of-document reminder:* the host, network identifiers, signatures,
> and evidence file references above are demonstration data.
