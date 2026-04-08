# TransTrack

## Transplant Waitlist & Operations Management

[![License](https://img.shields.io/badge/license-Evaluation%20Available-blue.svg)](LICENSE)
[![HIPAA Compliant](https://img.shields.io/badge/HIPAA-Compliant-green.svg)](docs/COMPLIANCE.md)
[![FDA 21 CFR Part 11](https://img.shields.io/badge/FDA-21%20CFR%20Part%2011-green.svg)](docs/COMPLIANCE.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

TransTrack is an offline, HIPAA-compliant, FDA 21 CFR Part 11-ready desktop application for transplant centers and pre-transplant coordination teams. It provides secure, cloud-independent data management and operational risk intelligence to help reduce the risk of patient inactivation before transplant.

> **Evaluation access:** TransTrack is available for evaluation by qualified healthcare organizations. Evaluation is intended for non-clinical, non-operational testing only. See [LICENSE](LICENSE) and [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for full terms.

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

### EHR Integration

* **FHIR R4** data import/export
* Validation rule configuration and history tracking

### Compliance

* **HIPAA**: encryption, access control, audit trails
* **FDA 21 CFR Part 11**: electronic records integrity and validation
* **Offline operation**: no PHI leaves the local system

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

* **Frontend**: React 18, Tailwind CSS, Radix UI, Framer Motion
* **Desktop**: Electron 35
* **Database**: Encrypted SQLite (SQLCipher, AES-256-CBC)
* **Build**: Vite 6, electron-builder
* **Languages**: TypeScript / JavaScript

## Installation

> **Note:** Evaluation versions are for testing only — do **not** use with live patient data.

### Pre-built Installers

Download from the [Releases page](https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases).

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

## Quick Start (Evaluation)

1. Launch TransTrack
2. Use the default credentials provided in your evaluation package
3. Change your password on first login (you will be prompted automatically)
4. Explore features using sample/test data

Default credentials are provided separately in your evaluation onboarding materials for security purposes. Contact [Trans_Track@outlook.com](mailto:Trans_Track@outlook.com) if you need assistance.

---

## Compliance & Security

### HIPAA

* Encryption at rest (AES-256)
* Role-based access control
* Automatic session timeouts
* Full audit trails

### FDA 21 CFR Part 11

* Timestamped, immutable audit trail
* User authentication and documentation
* Validation artifacts for compliance

### Security

* Fully offline operation
* Local encryption
* Secure, encrypted backups

[View full compliance documentation](docs/COMPLIANCE.md)

---

## Evaluation Notice

This software is provided for evaluation purposes only.

- Not for clinical decision-making
- Not connected to national transplant systems
- Intended for operational workflow assessment

## Contact

**[Trans_Track@outlook.com](mailto:Trans_Track@outlook.com)** — evaluation access, enterprise deployment, or technical inquiries.
