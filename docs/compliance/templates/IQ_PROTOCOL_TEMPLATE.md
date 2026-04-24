# IQ Protocol — TransTrack Installation Qualification

| Document control | |
|---|---|
| Document ID | TT-IQ-_____ |
| Software version | vX.Y.Z |
| Target host | _____ (workstation ID / role) |
| Executed by | _____ |
| Reviewed by | _____ |
| Date executed | _____ |

## Purpose

Verify that TransTrack has been installed on the target host correctly, on a
hardened OS image, with all prerequisites met, and that the running build
matches the validated release.

## Reference workstation specification

| Item | Required |
|---|---|
| Operating system | Windows 10/11 (22H2 or later), macOS 12+, or RHEL 8/9 |
| CPU | 4-core x86_64 or arm64 |
| RAM | ≥8 GB |
| Disk | ≥256 GB SSD |
| Disk encryption | BitLocker / FileVault / LUKS enabled |
| OS account | Per-user; no shared accounts |
| AV / EDR | Customer-standard endpoint security agent |
| Network egress | Default-deny; SIEM / EHR endpoints whitelisted only |

## Test cases

| ID | Step | Expected | Pass/Fail | Evidence |
|---|---|---|---|---|
| IQ-01 | Verify host meets the reference specification. | All items checked. | | screenshot |
| IQ-02 | Verify host disk is encrypted. | Yes. | | screenshot |
| IQ-03 | Verify only authorized users have OS-level local-admin rights. | Documented list matches actual. | | export |
| IQ-04 | Install TransTrack vX.Y.Z from the signed installer (`TransTrack-Setup-X.Y.Z.exe` / `.dmg` / `.AppImage`). | Installer signature valid; installation completes without error. | | log |
| IQ-05 | Compute SHA-256 of installed `electron/main.cjs` and compare to the release manifest. | Hashes match. | | hash |
| IQ-06 | Launch TransTrack and verify the About dialog reports vX.Y.Z. | Yes. | | screenshot |
| IQ-07 | Verify the encrypted database file (`transtrack.db`) is created at `%APPDATA%/transtrack/` (Windows) / equivalent. | Yes. | | path |
| IQ-08 | Verify the database file is not human-readable (cannot open as plain SQLite). | `sqlite3` reports "file is encrypted or is not a database". | | screenshot |
| IQ-09 | Verify the integrity-check pass occurs at startup (log line). | Log line present. | | log |
| IQ-10 | Run `system:getMigrationStatus` (admin) and verify all migrations are applied. | `pending: 0`. | | screenshot |
| IQ-11 | Verify outbound network access is restricted to whitelisted endpoints. | Network capture shows no unexpected egress. | | pcap |
| IQ-12 | Verify the host clock is synchronized to authorized NTP source. | Drift ≤2 seconds. | | screenshot |

## Acceptance

100% of mandatory IQ test cases must pass.

| Role | Signature | Date |
|---|---|---|
| Executor | | |
| Reviewer | | |
