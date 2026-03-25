# TransTrack

## Transplant Waitlist & Operations Management

[![License](https://img.shields.io/badge/license-Evaluation%20Available-blue.svg)](LICENSE)
[![HIPAA Compliant](https://img.shields.io/badge/HIPAA-Compliant-green.svg)](docs/COMPLIANCE.md)
[![FDA 21 CFR Part 11](https://img.shields.io/badge/FDA-21%20CFR%20Part%2011-green.svg)](docs/COMPLIANCE.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

---

## 🎥 Demo Video

[▶️ Watch or Download the Demo](https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases/download/v1.0.0/TransTrack-Wait-list.Management.Demo.mp4)

> *Short overview of TransTrack's offline workflow, operational risk intelligence, and readiness tracking.*

---

> **📋 EVALUATION ACCESS**
>
> TransTrack is available for **evaluation by qualified healthcare organizations**.
>
> * Request an evaluation to explore the full feature set
> * Evaluation is intended for **non-clinical, non-operational testing only**
> * Contact us to discuss your organization's needs and licensing options
>
> See [LICENSE](LICENSE) and [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for full terms.

<p align="center">
  <img src="docs/images/dashboard-preview.svg" alt="TransTrack Dashboard" width="800">
</p>

**TransTrack** is a comprehensive, **offline, HIPAA-compliant**, and **FDA 21 CFR Part 11-ready** desktop application built for **transplant centers and pre-transplant coordination teams**. It provides secure, cloud-independent data management and **operational risk intelligence** to help reduce the risk of **patient inactivation** before transplant.

---

## Why TransTrack Exists

TransTrack addresses a critical gap in transplant operations — **operational risk intelligence** outside of national allocation systems. It helps coordination teams identify and act on **readiness risks** such as expiring evaluations, missing documentation, or frequent status changes, preventing unnecessary inactivation of candidates awaiting transplant.

> **Note:** TransTrack provides **operational prioritization and readiness tracking** only. It does **not** perform allocation decisions or replace **UNOS/OPTN** systems.

---

## Who This Is For

TransTrack is designed for:

* **Transplant operations and coordination teams** – Workflow visibility and readiness tracking
* **Clinical informatics and healthcare IT** – Secure, offline-first data management
* **Compliance and audit staff** – Immutable audit trails and validation artifacts

**TransTrack is NOT intended for:**

* ❌ Allocation or listing authority functions
* ❌ National registry replacements (UNOS, OPTN)

---

## Core Value: Operational Risk Intelligence

The heart of TransTrack is proactive detection of operational risks that can delay or jeopardize patient readiness:

* **Expiring Evaluations** – Detect upcoming expirations automatically
* **Documentation Gaps** – Identify missing or outdated records
* **Status Churn Detection** – Track frequent candidate status changes
* **Readiness Barriers** – Manage non-clinical obstacles (insurance, transport, support, etc.)
* **Risk-Level Indicators** – Highlight high-risk cases before they cause inactivation
* **Transplant Clock** – Real-time operational pulse and activity rhythm monitoring

<p align="center">
  <img src="docs/images/risk-intelligence-dashboard.png" alt="Operational Risk Intelligence Dashboard" width="700">
</p>

### Transplant Clock — Real-Time Operational Awareness

The **Transplant Clock** is a visual heartbeat of your transplant program, providing real-time operational awareness for coordination teams:

* **Time Since Last Update** – Visual indicator showing system activity freshness (green/yellow/red status)
* **Operational Pulse** – Aggregated view of open barriers, aHHQ issues, lab gaps, and at-risk patients
* **Average Resolution Time** – Track how quickly your team resolves operational tasks
* **Next Expiration** – Countdown to the nearest expiring document or evaluation
* **Team Load Indicator** – Monitor coordinator workload distribution (Light/Moderate/Heavy)
* **Pulse Rate (Hz)** – Dynamic rhythm that increases with more open tasks

<p align="center">
  <img src="docs/images/transplant-clock.png" alt="Transplant Clock - Real-Time Operational Awareness" width="700">
</p>

> **100% Local Computation** – All metrics are computed locally from the encrypted SQLite database. No cloud, API, or AI inference required.

---

## Key Features

### Patient Waitlist Management

* Comprehensive candidate demographics and evaluation tracking
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

* **HIPAA**: Encryption, access control, audit trails
* **FDA 21 CFR Part 11**: Electronic records integrity and validation
* **Offline operation**: No PHI leaves the local system

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
* **Desktop**: Electron 29
* **Database**: Encrypted SQLite
* **Build**: Vite, electron-builder
* **Languages**: TypeScript / JavaScript

---

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

---

## Quick Start (Evaluation)

1. Launch **TransTrack**
2. Login: `admin@transtrac.local` / `Admin123!`
3. Change your password (Settings → Security)
4. Explore features using sample/test data
5. Contact us: [Trans_Track@outlook.com](mailto:Trans_Track@outlook.com)

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

[View Full Compliance Documentation →](docs/COMPLIANCE.md)

---

## 📊 Repository Insights

* 🚀 **1,100+ clones** in the last 14 days
* 🌎 Visitors from **GitHub, Google, and transplant coordination networks**
* 🔒 Built for **HIPAA & FDA 21 CFR Part 11 compliance**
* 🎥 [Watch the Demo](https://github.com/NeuroKoder3/TransTrackMedical-TransTrack/releases/download/v1.0.0/TransTrack-Wait-list.Management.Demo.mp4)

⭐ If you find TransTrack valuable, please **star this repository** to help others in the transplant community discover it.

---

## Contact & Support

📧 **[Trans_Track@outlook.com](mailto:Trans_Track@outlook.com)**
For evaluation access, enterprise deployment, or technical inquiries.

---

## Keywords

### Transplant & Clinical
`transplant` `organ-transplant` `kidney-transplant` `liver-transplant` `heart-transplant` `lung-transplant` `transplant-coordinator` `transplant-center` `transplant-operations` `pre-transplant` `organ-procurement` `organ-matching` `donor-matching` `donor-recipient-matching` `tissue-banking` `waitlist-management` `patient-readiness` `readiness-barriers` `patient-safety`

### Healthcare IT & Informatics
`healthcare-software` `medical-software` `clinical-software` `hospital-software` `healthcare-IT` `health-informatics` `clinical-informatics` `clinical-decision-support` `healthcare-analytics` `patient-management` `patient-tracking` `medical-records` `electronic-health-records` `healthcare-operations` `risk-intelligence` `operational-risk`

### Compliance & Regulatory
`HIPAA` `hipaa-compliant` `FDA-21-CFR-Part-11` `fda-compliant` `AATB` `UNOS` `OPTN` `regulatory-compliance` `healthcare-compliance` `audit-trail` `PHI-protection` `data-sovereignty`

### Integration & Interoperability
`EHR-integration` `FHIR` `FHIR-R4` `HL7` `interoperability`

### Architecture & Security
`offline-first` `desktop-application` `electron-app` `cross-platform` `encrypted-database` `data-encryption` `AES-256` `secure-desktop-app`

---

## About TransTrack

TransTrack is a **transplant waitlist management system** designed for **organ transplant centers**, **transplant coordinators**, and **healthcare IT teams**. It provides **operational risk intelligence** to help prevent patient inactivation before kidney, liver, heart, and lung transplants.

Built as an **offline-first desktop application** with **HIPAA-compliant** security and **FDA 21 CFR Part 11** readiness, TransTrack delivers **encrypted patient data management**, **FHIR R4 EHR integration**, **audit trails**, and **real-time operational monitoring** — all without requiring cloud connectivity or internet access.

TransTrack is purpose-built for:
- **Transplant coordination teams** managing complex waitlists and patient readiness
- **Clinical informatics departments** seeking secure, interoperable healthcare software
- **Hospital compliance and audit staff** requiring regulatory-grade documentation
- **Healthcare IT organizations** evaluating offline-capable medical software solutions

> Looking for transplant software, organ transplant waitlist tools, HIPAA-compliant healthcare applications, or FDA-validated clinical desktop software? TransTrack was built for you.

---

<p align="center">
  <strong>TransTrack</strong> — HIPAA-Compliant, Offline Pre-Transplant Waitlist Management
  <br>
  <em>Operational Risk Intelligence for Transplant Coordination Teams</em>
</p>
