# GitHub Repository Setup Guide

This document provides instructions for maintaining the canonical TransTrack GitHub repository.

## Prerequisites

1. Install Git: https://git-scm.com/download/win
2. Install GitHub CLI: https://cli.github.com/
3. Authenticate with GitHub: `gh auth login`

## Creating the Repository

### Option 1: Using GitHub CLI

```powershell
cd c:\TransTrack

# Verify repository remote
git remote -v

# Push current branch to the canonical GitHub repository
git push -u origin main
```

### Option 2: Manual Setup

1. Confirm repository settings on GitHub:
   - Go to https://github.com/new
   - Repository name: `TransTrackMedical-TransTrack`
   - Description: `Transplant waitlist and operations management — local-first desktop application with HIPAA Security Rule and 21 CFR Part 11 design controls`
   - Public or Private (as needed)
   - DO NOT recreate or reinitialize the existing repository

2. Ensure local `origin` points to the canonical repository:

```powershell
cd c:\TransTrack
git remote set-url origin https://github.com/NeuroKoder3/TransTrackMedical-TransTrack.git
git push -u origin main
```

## Repository Settings

After creating the repository, configure these settings:

### Topics (Tags)

Add these topics to your repository for discoverability:

```
transplant
organ-transplant
waitlist-management
medical-software
healthcare
hipaa-compliant
fda-compliant
aatb
unos
organ-matching
donor-matching
ehr-integration
fhir
clinical-software
hospital-software
transplant-center
organ-procurement
tissue-banking
medical-records
patient-management
healthcare-it
electron-app
offline-first
encrypted-database
```

### Add Topics via GitHub CLI

```powershell
gh repo edit --add-topic transplant,organ-transplant,hipaa,part-11,medical-software,healthcare,electron-app,local-first,fhir,ehr-integration
```

Avoid `hipaa-compliant` and `fda-compliant` as topics. Compliance is a
determination a deploying organization makes about its own practices; asserting
it as a product attribute is the same error corrected under finding M-17.

### Description

```
Transplant waitlist and operations management - local-first Electron desktop application for transplant centers, with HIPAA Security Rule and 21 CFR Part 11 design controls. Patient management, donor matching, operational risk intelligence, and FHIR/HL7 integration.
```

### Website

Add your website or leave as the repository URL.

### Enable Features

- Issues: ✅ Enabled
- Projects: ✅ Enabled (optional)
- Wiki: ✅ Enabled (optional)
- Discussions: ✅ Enabled

## Creating Releases

When ready to release:

```powershell
# Tag the release
git tag -a v1.0.0 -m "TransTrack v1.0.0 - Initial Release"
git push origin v1.0.0

# Create release with binaries
gh release create v1.0.0 --title "TransTrack v1.0.0" --notes-file CHANGELOG.md release/*.exe release/*.dmg release/*.AppImage
```

## Repository Structure

```
TransTrack/
├── .gitignore              # Git ignore patterns
├── README.md               # Main documentation
├── LICENSE                 # Proprietary license
├── CONTRIBUTING.md         # Contribution guidelines
├── package.json            # Node.js configuration
├── vite.config.js          # Vite build configuration
├── electron/               # Electron main process
│   ├── main.js
│   ├── preload.js
│   ├── database/
│   ├── functions/
│   └── ipc/
├── src/                    # React frontend
│   ├── api/
│   ├── components/
│   ├── lib/
│   ├── pages/
│   └── utils/
└── docs/                   # Documentation
    ├── COMPLIANCE.md
    ├── USER_GUIDE.md
    └── GITHUB_SETUP.md
```

## Marketing Keywords

For SEO and discoverability, use these keywords in descriptions and documentation:

**Primary Keywords:**
- Transplant waitlist management software
- HIPAA compliant medical software
- Organ donor matching system
- FDA 21 CFR Part 11 compliant

**Secondary Keywords:**
- Healthcare IT solutions
- Clinical workflow software
- FHIR integration healthcare
- Offline medical records

**Long-tail Keywords:**
- Best transplant center software
- UNOS compatible waitlist management
- Secure patient data management healthcare
- Desktop EHR alternative
