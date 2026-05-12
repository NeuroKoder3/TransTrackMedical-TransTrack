# TransTrack

## Transplant Waitlist & Operations Management

[![HIPAA Aligned](https://img.shields.io/badge/HIPAA-Security%20Rule%20Aligned-blue.svg)](docs/compliance/HIPAA_SECURITY_RULE_MAPPING.md)
[![21 CFR Part 11 Aligned](https://img.shields.io/badge/21%20CFR%20Part%2011-Architected%20For-blue.svg)](docs/compliance/PART_11_CONTROL_MAPPING.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

TransTrack is an offline-first desktop application for transplant centers and pre-transplant coordination teams. It is **architected to support** HIPAA Security Rule controls and **designed for alignment with** FDA 21 CFR Part 11 electronic-records requirements; formal certification is the responsibility of the deploying organization and its auditors. It provides secure, cloud-independent data management and operational risk intelligence to help reduce the risk of patient inactivation before transplant.

> **Important:** "HIPAA aligned" and "Part 11 architected" describe the product's design controls — they are not certifications. SOC 2 / HITRUST / 21 CFR Part 11 validation, and any FDA determinations, must be performed by the deploying organization with qualified auditors.

> **Licensing Notice:** TransTrack is proprietary software. Use, operation, and deployment require a valid license activation issued by TransTrack Medical Software. Unauthorized use, redistribution, or rebranding is prohibited.

> **Impersonation and Safety Warning:** The project has identified unaffiliated third-party pages impersonating TransTrack. Do not download installers, archives, or updates from unofficial pages. Use only the official repository and releases listed below.

> **Known Unaffiliated Page (Do Not Use):** `https://the-vishal-gupta.github.io/` is not an authorized TransTrack channel. Treat downloads or links from that page as unsafe.

<p align="center">
  <img src="docs/images/dashboard-preview.svg" alt="TransTrack Dashboard" width="800">
</p>

## Demo

[Watch or download the demo video](https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases/download/v1.0.0/TransTrack-Wait-list.Management.Demo.mp4) — a short overview of TransTrack's offline workflow, operational risk intelligence, and readiness tracking.

---

## Why TransTrack Exists

TransTrack addresses a gap in transplant operations: operational risk intelligence outside of national allocation systems. It helps coordination teams identify and act on readiness risks — expiring evaluations, missing documentation, frequent status changes — before they cause unnecessary candidate inactivation.

**TransTrack does not perform allocation decisions or replace UNOS/OPTN systems.** It provides operational prioritization and readiness tracking only.

### The Problem

Transplant centers face operational failures that impact patient readiness:

- Missing or delayed evaluations
- Unresolved non-clinical barriers (insurance, logistics)
- Coordination gaps across teams

These lead to candidate inactivation, delayed transplants, and increased compliance risk.

### System Positioning

TransTrack operates between EHR systems and transplant registries.

- Does not replace UNOS/OPTN
- Does not perform organ allocation
- Focuses on operational readiness and coordination

### Who This Is For

* **Transplant operations and coordination teams** — workflow visibility and readiness tracking
* **Clinical informatics and healthcare IT** — secure, offline-first data management
* **Compliance and audit staff** — immutable audit trails and validation artifacts

TransTrack is **not** intended for allocation or listing authority functions, or as a national registry replacement (UNOS, OPTN).

---

## Core Value: Operational Risk Intelligence

The core of TransTrack is proactive detection of operational risks that can delay or jeopardize patient readiness:

* **Expiring Evaluations** — detect upcoming expirations automatically
* **Documentation Gaps** — identify missing or outdated records
* **Status Churn Detection** — track frequent candidate status changes
* **Readiness Barriers** — manage non-clinical obstacles (insurance, transport, support, etc.)
* **Risk-Level Indicators** — highlight high-risk cases before they cause inactivation
* **Inactivation Risk Engine v2** — deterministic, explainable per-patient inactivation
  scoring with 30 / 60 / 90-day calibrated probabilities, full per-factor
  decomposition, and counterfactual intervention simulation ("if you resolve
  this insurance barrier, the score drops from 78 to 41"). See
  [`docs/INACTIVATION_RISK_ENGINE.md`](docs/INACTIVATION_RISK_ENGINE.md) for
  the technical specification.
* **Transplant Clock** — real-time operational pulse and activity rhythm monitoring

<p align="center">
  <img src="docs/images/risk-intelligence-dashboard.png" alt="Operational Risk Intelligence Dashboard" width="700">
</p>

### Transplant Clock

The Transplant Clock provides real-time operational awareness for coordination teams:

* **Time Since Last Update** — visual indicator showing system activity freshness (green/yellow/red status)
* **Operational Pulse** — aggregated view of open barriers, aHHQ issues, lab gaps, and at-risk patients
* **Average Resolution Time** — track how quickly the team resolves operational tasks
* **Next Expiration** — countdown to the nearest expiring document or evaluation
* **Team Load Indicator** — monitor coordinator workload distribution (Light/Moderate/Heavy)
* **Pulse Rate (Hz)** — dynamic rhythm that increases with more open tasks

<p align="center">
  <img src="docs/images/transplant-clock.png" alt="Transplant Clock - Real-Time Operational Awareness" width="700">
</p>

All metrics are computed locally from the encrypted SQLite database. No cloud, API, or AI inference required.

---

## Features

### Patient Waitlist Management

* Candidate demographics and evaluation tracking
* Configurable readiness indicators and internal prioritization
* Search, filter, and status-based workflow visibility

### Readiness Barriers (Non-Clinical)

* Track operational barriers (insurance, logistics, caregiver support)
* Assign tasks to staff roles (Social Work, Financial, Coordinator)
* Integrated into the risk intelligence dashboard

### Transplant Clock (Real-Time Monitoring)

* Visual system activity rhythm with color-coded freshness indicators
* Operational pulse showing open barriers, aHHQ issues, and lab gaps
* Team workload monitoring and task resolution metrics
* Computed 100% locally — no cloud dependencies

### EHR & Registry Integration

* **FHIR R4** data import/export
* **HL7 v2.x** message ingestion (ADT^A01/A03/A04/A08, ORU^R01) with ACK generation
* **OPTN-style CSV exports** (TCR/TRR/TRF-shaped extracts) — for internal review and reconciliation; *not* an OPTN/UNet submission
* Validation rule configuration and history tracking

### Transplant Clinical Calculators (reference values)

* **MELD**, **MELD-Na**, **MELD 3.0**, **PELD** — liver/pediatric scoring
* **LAS** (legacy lung allocation reference)
* **KDPI / KDRI** — deceased-donor kidney donor profile index with percentile mapping
* **EPTS** — estimated post-transplant survival (Rao 2009) with percentile mapping
* All calculators are reference-only; allocation decisions occur in OPTN/UNet

### Operational Workflows

* **Organ Offer Management** — auditable state machine (PENDING → ACCEPTED_PROVISIONAL → ACCEPTED_FINAL / DECLINED / EXPIRED / RESCINDED) with structured decline-reason codes
* **Post-Transplant Follow-up** — transplant events, immunosuppression regimens, rejection episodes, biopsies, and post-tx readmissions
* **Living Donor Workflow** — separate donor record, evaluation steps, status state machine, and auto-generated 6/12/24-month OPTN Policy 14-style follow-ups

### Compliance posture (design controls — not certifications)

* **HIPAA Security Rule alignment**: AES-256 at-rest encryption (SQLCipher), role-based access control, account lockout, immutable audit logs, audit-log immutability enforced at the database trigger level
* **21 CFR Part 11 alignment**: timestamped audit trail, electronic-record integrity controls, password complexity & history, session controls, validation documentation package included
* **Offline operation**: no PHI leaves the local system unless explicitly exported by an authorized user
* **Validation package**: see [`docs/compliance/`](docs/compliance/) for the validation plan, IQ/OQ/PQ templates, risk register, and HIPAA / Part 11 control mappings

### Offline-First Architecture

* No internet connection required
* AES-256 local encryption
* Secure backup/restore and data sovereignty

### Enterprise Features

* Role-based access and justification
* Disaster recovery and validation documentation
* Read-only compliance view for auditors

---

## Screenshots

### Dashboard Overview

<p align="center">
  <img src="docs/images/dashboard-preview.svg" alt="Dashboard Overview" width="700">
</p>

### Patient Waitlist Management

<p align="center">
  <img src="docs/images/patient-management.svg" alt="Patient Management" width="700">
</p>

### Donor-Recipient Matching

<p align="center">
  <img src="docs/images/donor-matching.svg" alt="Donor Matching" width="700">
</p>

### Risk Intelligence & Barriers

<p align="center">
  <img src="docs/images/readiness-barriers.png" alt="Readiness Barriers" width="700">
</p>

### Transplant Clock & Operational Pulse

<p align="center">
  <img src="docs/images/transplant-clock.png" alt="Transplant Clock - Operational Pulse" width="700">
</p>

### Patient Documentation & Workflow Tracking

<p align="center">
  <img src="docs/images/patient-documentation-tracking.png" alt="Patient Documentation and Workflow Tracking" width="700">
</p>

### Compliance Center

<p align="center">
  <img src="docs/images/compliance-center.svg" alt="Compliance Center" width="700">
</p>

### Disaster Recovery

<p align="center">
  <img src="docs/images/disaster-recovery.svg" alt="Disaster Recovery" width="700">
</p>

### Compliance Center & Audit Trail

<p align="center">
  <img src="docs/images/audit-trail.svg" alt="Audit Trail" width="700">
</p>

---

## Technology Stack

* **Frontend**: React 18, Tailwind CSS, Radix UI, Framer Motion, TanStack Query
* **Desktop runtime**: Electron 39
* **Database**: Encrypted SQLite via SQLCipher (AES-256-CBC, PBKDF2-SHA512 ≥256 000 iterations)
* **Build**: Vite 6, electron-builder, CycloneDX SBOM
* **Languages**: TypeScript / JavaScript (CommonJS in Electron main, ESM in renderer)
* **Optional server tier**: Fastify + PostgreSQL + FHIR R4 + SMART on FHIR v2 + CDS Hooks 1.1 + MLLP/TLS HL7 v2 listener (see `server/`, currently early-access; the desktop client can run fully offline or in thin-client mode against the server)

## Installation

### Pre-built Installers

Download from the [Releases page](https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases).

Only this GitHub Releases page is an authorized download channel.

| Platform              | File                         |
| --------------------- | ---------------------------- |
| Windows (x64)         | `TransTrack-1.0.0-x64.exe`   |
| macOS (Intel)         | `TransTrack-1.0.0-x64.dmg`   |
| macOS (Apple Silicon) | `TransTrack-1.0.0-arm64.dmg` |
| Linux                 | `TransTrack-1.0.0.AppImage`  |

### Build from Source

```bash
# Clone the repository
git clone https://github.com/NeuroKoder3/TransTrackMedical-TransTrack.git
cd TransTrack

# Install dependencies
npm install

# Development mode
npm run dev:electron

# Build for production
npm run build:electron
```

## Quick Start

1. Launch TransTrack.
2. On first launch a **one-time setup token** for the seeded administrator
   account `admin@transtrack.local` is written to:
   - `userData/INITIAL_ADMIN_PASSWORD.txt` (mode `0o600` on POSIX), and
   - the application's stdout / log (a delimited "first-launch administrator
     setup" banner).

   No build-time default password ships with the product. For scripted
   installs, set `TRANSTRACK_INITIAL_ADMIN_PASSWORD` before first launch and
   the file in `userData` will not be written.
3. Sign in at the login screen with `admin@transtrack.local` and the setup
   token. You will be required to change the password immediately
   (`must_change_password = 1`). Delete the token file after rotation.
4. Begin entering or importing data — all features are immediately available.

Contact [Trans_Track@outlook.com](mailto:Trans_Track@outlook.com) if you need assistance.

## Trust and Anti-Impersonation Notice

- Official repository: `https://github.com/NeuroKoder3/TransTrackMedical-TransTrack`
- Official releases: `https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases`
- Official support email: `Trans_Track@outlook.com`
- Any lookalike page claiming to be "official TransTrack" outside these channels should be treated as untrusted.
- If you suspect malware, impersonation, or fraud linked to TransTrack branding, report it immediately to `Trans_Track@outlook.com`.

---

## Compliance & Security (Design Controls)

### HIPAA Security Rule alignment

* Encryption at rest (AES-256, SQLCipher)
* Role-based access control with justification logging
* Automatic session timeouts and idle lockout
* Immutable audit trails enforced at the database trigger level
* Multi-factor authentication (TOTP with backup codes)
* Optional SIEM forwarding (RFC 5424 syslog / CEF)

### 21 CFR Part 11 alignment

* Timestamped, immutable audit trail (append-only with DB-level UPDATE/DELETE blocks)
* Strong password policy with history and expiration
* Session controls and re-authentication for sensitive operations
* Validation documentation package (see [`docs/compliance/`](docs/compliance/))

### Security architecture

* Fully offline operation by default
* Local AES-256 encryption with key rotation support
* Secure, encrypted backups and disaster-recovery tooling
* Independent penetration test and SOC 2 Type II are the responsibility of the deploying organization

[Compliance overview](docs/COMPLIANCE.md) · [Validation package](docs/compliance/README.md)

---

## Important Notice

- Not intended for clinical decision-making
- Not connected to national transplant systems (UNOS/OPTN)
- Designed for operational workflow management and readiness tracking

## Contact

**[Trans_Track@outlook.com](mailto:Trans_Track@outlook.com)** — deployment help or technical inquiries.
