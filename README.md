# TransTrack

## Transplant Operations & Workflow Management

[![License](https://img.shields.io/badge/license-Commercial-blue.svg)](LICENSE)
[![Price](https://img.shields.io/badge/price-from%20%242%2C499-green.svg)](PRICING.md)
[![HIPAA Compliant](https://img.shields.io/badge/HIPAA-Compliant-green.svg)](docs/COMPLIANCE.md)
[![FDA 21 CFR Part 11](https://img.shields.io/badge/FDA-21%20CFR%20Part%2011-green.svg)](docs/COMPLIANCE.md)
[![AATB Standards](https://img.shields.io/badge/AATB-Standards-green.svg)](docs/COMPLIANCE.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

> **⚠️ IMPORTANT LICENSE NOTICE**
>
> TransTrack is **source-available commercial software**.
>
> - Viewing and evaluating the source code is permitted for a limited time (14 days)
> - Evaluation is limited to non-clinical, non-operational testing only
> - **Use in clinical, operational, or production environments requires a [commercial license](PRICING.md)**
>
> See [LICENSE](LICENSE) and [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for full terms.

<p align="center">
  <img src="docs/images/dashboard-preview.svg" alt="TransTrack Dashboard" width="800">
</p>

**TransTrack** is a comprehensive, **fully offline**, **HIPAA-compliant** desktop application for transplant operations teams. Built with modern technologies and designed for transplant centers, OPOs, and tissue banks that require regulatory compliance without cloud dependencies.

---

## Why TransTrack Exists

TransTrack was built to address a gap in transplant operations: **operational visibility and readiness risk** that sits outside of national allocation systems.

It focuses on surfacing non-clinical and administrative risks such as expiring evaluations, documentation gaps, and status churn that can quietly place candidates at risk of inactivation.

> **Important Clarification**: TransTrack provides operational prioritization indicators for internal workflow management. It does **not** perform allocation decisions, listing authority functions, or replace UNOS, OPTN, or any national systems.

---

## Who This Is For

TransTrack is intended for:

- **Transplant operations and coordination teams** - Workflow visibility and readiness tracking
- **OPO operations and quality teams** - Documentation and compliance management
- **Clinical informatics and healthcare IT groups** - Secure, offline-first data management
- **Compliance and audit stakeholders** - Immutable audit trails and validation artifacts

**TransTrack is NOT intended for:**

- ❌ Allocation decisions
- ❌ Listing authority
- ❌ Replacement of UNOS, OPTN, or national systems

---

## Core Value: Operational Risk Intelligence

The heart of TransTrack is proactive risk detection that helps teams stay ahead of operational issues:

- **Expiring Evaluations** - Surface candidates with evaluations approaching expiration
- **Documentation Gaps** - Identify missing or stale documentation before it causes problems
- **Status Churn Detection** - Track candidates with frequent status changes that may indicate workflow issues
- **Readiness Tracking** - Operational indicators for internal workflow visibility

<p align="center">
  <img src="docs/images/risk-dashboard.svg" alt="Risk Intelligence Dashboard" width="700">
</p>

---

## Key Features

### Patient Waitlist Management
- Complete patient demographics and medical history
- Operational prioritization indicators aligned with publicly documented concepts, intended solely for internal workflow visibility and readiness tracking (does not perform allocation or listing decisions)
- Real-time waitlist status tracking
- Comprehensive patient search and filtering

### Advanced Donor Matching
- Intelligent donor-recipient compatibility matching
- Blood type compatibility verification
- HLA typing and matching analysis
- Virtual crossmatch simulation
- Predicted graft survival calculations

### Operational Readiness Indicators
- Reference display of publicly documented scoring concepts (MELD, LAS, PRA/CPRA) for informational purposes
- Configurable workflow visibility settings
- Time-on-waitlist tracking for operational awareness
- Internal urgency indicators for workflow prioritization

> **Note**: These indicators are for internal operational visibility only and do not perform or replace official allocation calculations.

### EHR Integration
- **FHIR R4** data import/export
- Patient data synchronization
- Validation rule management
- Import history tracking

### Regulatory Compliance
- **HIPAA** - Full technical safeguard implementation
- **FDA 21 CFR Part 11** - Electronic records compliance
- **AATB Standards** - Tissue banking requirements
- Immutable audit trails
- Role-based access control

### Offline-First Architecture
- **No internet connection required**
- Local encrypted database (AES-256)
- Complete data sovereignty
- Secure backup/restore capabilities

### Enterprise Features
- **Role-Based Access with Audit Justification** - Users must document reasons for accessing sensitive data
- **Disaster Recovery & Business Continuity** - Automated backups, verification, and one-click restore
- **Read-Only Compliance View** - Dedicated view for regulators and auditors
- **Offline Degradation with Reconciliation** - Graceful handling of offline scenarios with data sync
- **Formal Validation Artifacts** - FDA 21 CFR Part 11 compliant validation documentation

---

## Screenshots

### Dashboard Overview
<p align="center">
  <img src="docs/images/dashboard-preview.svg" alt="TransTrack Dashboard" width="700">
</p>

### Patient Waitlist Management
<p align="center">
  <img src="docs/images/patient-management.svg" alt="Patient Management" width="700">
</p>

### Donor-Recipient Matching
<p align="center">
  <img src="docs/images/donor-matching.svg" alt="Donor Matching" width="700">
</p>

### Compliance Center
<p align="center">
  <img src="docs/images/compliance-center.svg" alt="Compliance Center" width="700">
</p>

### Disaster Recovery
<p align="center">
  <img src="docs/images/disaster-recovery.svg" alt="Disaster Recovery" width="700">
</p>

### Audit Trail (FDA 21 CFR Part 11)
<p align="center">
  <img src="docs/images/audit-trail.svg" alt="Audit Trail" width="700">
</p>

---

## Technology Stack

- **Frontend**: React 18, Tailwind CSS, Radix UI, Framer Motion
- **Desktop**: Electron 29
- **Database**: SQLite with encryption
- **Build**: Vite, electron-builder
- **Languages**: JavaScript/TypeScript

---

## Installation

> **⚠️ IMPORTANT**
>
> Pre-built installers and production builds are provided for **licensed or authorized evaluation use only**.
>
> **Do not use TransTrack with live patient data** without a valid commercial license and appropriate institutional approvals.

### Pre-built Installers

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| Windows (x64) | [TransTrack-1.0.0-x64.exe](../../releases) |
| macOS (Intel) | [TransTrack-1.0.0-x64.dmg](../../releases) |
| macOS (Apple Silicon) | [TransTrack-1.0.0-arm64.dmg](../../releases) |
| Linux | [TransTrack-1.0.0.AppImage](../../releases) |

### Build from Source

```bash
# Clone the repository
git clone https://github.com/TransTrackMedical/TransTrack.git
cd TransTrack

# Install dependencies
npm install

# Development mode
npm run dev:electron

# Build for production
npm run build:electron
```

---

## Quick Start (Evaluation Only)

> **Note**: These steps are for authorized evaluation environments only. Do not use with live patient data without a commercial license.

1. **Launch TransTrack** from your applications menu
2. **Login** with evaluation credentials:
   - Email: `admin@transtrack.local`
   - Password: `admin123`
3. **Change your password** immediately (Settings → Security)
4. **Explore features** using sample/test data only
5. **Contact sales** for production licensing: Trans_Track@outlook.com

---

## System Requirements

### Minimum Requirements
- **OS**: Windows 10, macOS 10.14, Ubuntu 18.04
- **RAM**: 4 GB
- **Storage**: 500 MB free space
- **Display**: 1024 x 768 resolution

### Recommended
- **OS**: Windows 11, macOS 12+, Ubuntu 22.04
- **RAM**: 8 GB
- **Storage**: 2 GB free space
- **Display**: 1920 x 1080 resolution

---

## Compliance & Security

TransTrack is designed for healthcare environments requiring strict regulatory compliance:

### HIPAA Technical Safeguards
- ✅ Encryption at rest (AES-256)
- ✅ Unique user identification
- ✅ Role-based access control
- ✅ Automatic session timeout
- ✅ Complete audit trails
- ✅ No network transmission of PHI

### FDA 21 CFR Part 11
- ✅ Electronic records integrity
- ✅ Audit trail with timestamps
- ✅ User authentication
- ✅ System documentation

### Data Security
- All patient data encrypted locally
- No cloud storage or transmission
- Secure backup capabilities
- Complete data sovereignty

[View Full Compliance Documentation →](docs/COMPLIANCE.md)

---

## Documentation

- [User Guide](docs/USER_GUIDE.md)
- [Compliance Documentation](docs/COMPLIANCE.md)
- [API Reference](docs/API.md)
- [Development Guide](docs/DEVELOPMENT.md)

---

## Use Cases

### Transplant Operations Teams
- Operational workflow visibility and readiness tracking
- Documentation gap identification
- Internal coordination and status monitoring

### OPO Operations & Quality Teams
- Donor registration and tracking
- Quality documentation management
- Compliance and audit trail maintenance

### Clinical Informatics & Healthcare IT
- Secure, offline-first data management
- EHR integration via FHIR
- Regulatory compliance infrastructure

### Compliance & Audit Stakeholders
- Immutable audit trails (FDA 21 CFR Part 11)
- Read-only compliance views for regulators
- Validation artifact generation

---

## Roadmap

### Version 1.1
- [ ] Multi-organ workflow support
- [ ] Advanced reporting dashboard
- [ ] Enhanced risk indicator configuration
- [ ] Batch patient import

### Version 1.2
- [ ] Secure multi-user sync (optional)
- [ ] Mobile companion app
- [ ] Extended FHIR support
- [ ] HL7 integration

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run Electron in development
npm run dev:electron

# Run tests
npm test

# Lint code
npm run lint
```

---

## Licensing & Pricing

TransTrack is commercial software requiring a paid license for production use.

*Pricing reflects the regulatory, validation, and support requirements of clinical and operational healthcare environments.*

| License | Price | Installations | Support |
|---------|-------|---------------|---------|
| **Starter** | $2,499 | 1 workstation | Email (48hr) |
| **Professional** | $7,499 | Up to 5 | Priority (24hr) |
| **Enterprise** | $24,999 | Unlimited | 24/7 Phone & Email |

### [View Full Pricing Details →](PRICING.md)

**Discounts Available:**
- Nonprofit organizations: 25% off
- Academic institutions: 40% off
- Multi-year commitments: Volume pricing

### 14-Day Evaluation

Qualified healthcare organizations can request a free 14-day evaluation license for non-clinical, non-operational testing only.

📧 **Trans_Track@outlook.com**

---

## Support

### Sales & Licensing
📧 Trans_Track@outlook.com

### Technical Support (Licensed Customers)
📧 Trans_Track@outlook.com

### Enterprise Solutions
Custom integrations, training, and dedicated support:
📧 Trans_Track@outlook.com

### Pre-Sales Questions
- [GitHub Discussions](../../discussions)
- [Request a Demo](mailto:Trans_Track@outlook.com)

---

## Keywords

`transplant` `transplant-operations` `waitlist-management` `OPO` `HIPAA` `FDA-21-CFR-Part-11` `AATB` `clinical-informatics` `healthcare-IT` `FHIR` `audit-trail` `operational-risk` `offline-first` `encrypted-database` `compliance` `regulatory` `tissue-banking`

---

<p align="center">
  <strong>TransTrack</strong> - Secure, Compliant, Offline Transplant Operations
  <br>
  <em>Operational visibility for transplant teams</em>
</p>
