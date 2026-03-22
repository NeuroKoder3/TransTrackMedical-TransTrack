# TransTrack Production Deployment Guide

## Overview

This document provides step-by-step instructions for deploying TransTrack to a production environment for the first time. Follow every section in order.

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Disk | 10 GB free | 50+ GB SSD |
| Display | 1024x768 | 1920x1080 |

### Software Requirements

- Windows 10/11 (x64), macOS 12+, or Ubuntu 20.04+
- No internet connection required after installation (offline-first)
- Administrator privileges for installation

### Compliance Prerequisites

- [ ] HIPAA Business Associate Agreement (BAA) signed
- [ ] Security risk assessment completed
- [ ] Data backup strategy documented and approved
- [ ] Incident response plan reviewed and signed
- [ ] Staff HIPAA training completed

---

## Step 1: Environment Preparation

### 1.1 Create Service Account

Create a dedicated Windows/macOS user account for TransTrack:
- Username: `transtrack-svc` (or per organization policy)
- Permissions: Standard user (no admin required at runtime)
- Password: Follow organization's password policy

### 1.2 Prepare Installation Directory

```
Windows: C:\Program Files\TransTrack\
macOS:   /Applications/TransTrack.app
Linux:   /opt/transtrack/
```

### 1.3 Configure Data Directory

TransTrack stores encrypted data in the user's application data folder:

```
Windows: %APPDATA%\TransTrack\
macOS:   ~/Library/Application Support/TransTrack/
Linux:   ~/.config/TransTrack/
```

Ensure this location:
- Has adequate disk space (minimum 5 GB)
- Is included in the organization's backup schedule
- Is on a local drive (NOT a network share)
- Has appropriate filesystem permissions

---

## Step 2: Build Enterprise Package

### 2.1 Set Up Build Environment

```bash
# Clone repository
git clone https://github.com/TransTrackMedical/TransTrack.git
cd TransTrack

# Install dependencies
npm ci

# Verify no high-severity vulnerabilities
npm audit --production --audit-level=high
```

### 2.2 Configure Code Signing

Set environment variables for code signing:

```bash
# Windows
set CSC_LINK=path/to/certificate.pfx
set CSC_KEY_PASSWORD=your-certificate-password

# macOS
export CSC_LINK=path/to/certificate.p12
export CSC_KEY_PASSWORD=your-certificate-password
export APPLE_ID=your-apple-id
export APPLE_APP_SPECIFIC_PASSWORD=your-app-password
```

### 2.3 Build

```bash
# Windows
npm run build:enterprise:win

# macOS
npm run build:enterprise:mac

# Linux
npm run build:enterprise:linux
```

The installer will be in the `release/` directory.

---

## Step 3: Installation

### 3.1 Install Application

Run the installer on the target machine:

- **Windows**: Run `TransTrack-Enterprise-1.0.0-x64.exe`
  - Choose "Install for all users" if shared workstation
  - Accept the default installation directory
- **macOS**: Open `TransTrack-Enterprise-1.0.0.dmg`, drag to Applications
- **Linux**: Install `.deb` package or run `.AppImage`

### 3.2 First Launch

1. Launch TransTrack
2. The application will:
   - Generate a 256-bit AES encryption key
   - Create the encrypted SQLite database
   - Create a default organization
   - Seed the default admin account

### 3.3 Record the Encryption Key Location

**CRITICAL**: The encryption key is stored at:
```
%APPDATA%/TransTrack/.transtrack-key
```

- Back up this file immediately to a secure, separate location
- Without this key, database recovery is impossible
- Store the backup according to your key management policy

---

## Step 4: Initial Configuration

### 4.1 Change Default Admin Password

1. Log in with: `admin@transtrack.local` / `Admin123!`
2. You will be prompted to change the password
3. Set a password meeting the requirements:
   - Minimum 12 characters
   - At least one uppercase, lowercase, number, and special character

### 4.2 Configure Organization

1. Navigate to Settings → Organization
2. Update:
   - Organization name
   - Organization type (Transplant Center, OPO, etc.)
   - Contact information

### 4.3 Activate Enterprise License

1. Navigate to Settings → License
2. Enter your license key (provided by TransTrack support)
3. Verify license tier shows "Enterprise" or "Professional"

### 4.4 Create User Accounts

1. Navigate to Admin → User Management
2. Create accounts for each team member with appropriate roles:

| Role | Access Level |
|------|-------------|
| `admin` | Full system access, user management |
| `coordinator` | Patient management, donor matching, reporting |
| `physician` | Patient records, clinical data (read/write) |
| `user` | Basic patient data entry |
| `viewer` | Read-only access |
| `regulator` | Compliance reports and audit logs only |

---

## Step 5: Backup Configuration

### 5.1 Configure Automated Backups

1. Navigate to Settings → Backup
2. Set backup schedule (recommended: daily)
3. Set backup retention (recommended: 30 days minimum)

### 5.2 Verify Backup Works

1. Create a manual backup via Recovery → Create Backup
2. Verify the backup via Recovery → Verify Backup
3. Confirm the verification shows:
   - `checksumVerified: true`
   - `integrityCheckPassed: true`
   - `restoreTestPassed: true`

### 5.3 Document Backup Locations

Record and secure:
- Primary backup directory: `%APPDATA%/TransTrack/backups/`
- Encryption key backup location: [DOCUMENT HERE]
- Off-site backup procedure: [DOCUMENT HERE]

---

## Step 6: Security Verification

### 6.1 Verify Encryption

Check via Settings → Encryption:
- Status: Enabled
- Algorithm: AES-256-CBC
- Key Derivation: PBKDF2-HMAC-SHA512

### 6.2 Verify DevTools are Disabled

1. Try pressing F12 or Ctrl+Shift+I
2. DevTools should NOT open in the enterprise build

### 6.3 Verify Audit Logging

1. Perform a test action (create a test patient)
2. Navigate to Audit Logs
3. Verify the action is recorded with:
   - User email
   - Timestamp
   - Action type
   - Entity details

### 6.4 Verify Organization Isolation

If multi-tenant: confirm users can only see data from their organization.

---

## Step 7: Compliance Checklist

### Security

- [ ] DevTools disabled in packaged build (tested)
- [ ] Audit log immutability triggers verified
- [ ] Encryption key stored and backed up securely
- [ ] All IPC handlers validate org_id
- [ ] Rate limiting active
- [ ] Request context tracing implemented

### Functionality

- [ ] Backup + verify + restore tested
- [ ] FHIR R4 validation functional
- [ ] Database migration strategy documented
- [ ] Key rotation procedure documented and tested
- [ ] Priority scoring verified with representative data
- [ ] Audit log performance acceptable

### Testing

- [ ] All business logic tests pass
- [ ] Security audit clean (npm audit)
- [ ] Compliance tests pass
- [ ] Load tests pass (5000 patients in <1s queries)

### Documentation

- [ ] This deployment guide completed
- [ ] Incident response runbook signed off
- [ ] Encryption key management documented
- [ ] Operations manual distributed to staff
- [ ] API reference available for integrations

### Compliance Review

- [ ] Legal review of BAA completed
- [ ] Security architecture approved
- [ ] Data residency controls verified
- [ ] Backup recovery tested by ops team
- [ ] HIPAA/FDA compliance matrix reviewed

### Final Approval

- [ ] Security lead: _________________ Date: _____
- [ ] Product lead: _________________ Date: _____
- [ ] Compliance officer: _________________ Date: _____
- [ ] Customer (pilot): _________________ Date: _____

---

## Step 8: Go-Live

1. Remove test data created during verification
2. Import production patient data (if migrating from another system)
3. Verify data integrity after import
4. Enable automated backups
5. Distribute user credentials securely
6. Schedule 30-day post-deployment review

---

## Post-Deployment Monitoring

### Daily

- Verify automated backups completed
- Check application logs for errors
- Monitor disk space

### Weekly

- Review audit log summaries
- Check for software updates
- Verify backup integrity

### Monthly

- Run full compliance test suite
- Review user access and deactivate unused accounts
- Verify encryption key backup is current

### Quarterly

- Consider encryption key rotation
- Review and update incident response plan
- Conduct tabletop security exercise

---

## Rollback Procedure

If critical issues are found post-deployment:

1. Stop TransTrack on affected machines
2. Restore from pre-deployment backup
3. Reinstall previous version
4. Verify data integrity
5. Document the rollback and root cause

---

## Support

- Email: Trans_Track@outlook.com
- Documentation: See `docs/` directory in the installation
- Emergency: Follow incident response procedures in `INCIDENT_RESPONSE.md`

**Deploy Only After All Checklist Items Are Complete**
