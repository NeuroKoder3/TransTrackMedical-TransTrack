# Disaster Recovery & Business Continuity Plan

## Objectives

| Metric | Target | Notes |
|--------|--------|-------|
| **RTO** (Recovery Time Objective) | 4 hours | Time to restore full functionality |
| **RPO** (Recovery Point Objective) | 1 hour | Maximum acceptable data loss |
| **MTTR** (Mean Time to Recovery) | 2 hours | Average recovery duration |

## Architecture Context

TransTrack is an **offline-first desktop application** with:
- Local encrypted SQLite database (SQLCipher)
- No cloud dependency for core operations
- Optional EHR integration via FHIR

This significantly simplifies disaster recovery compared to cloud-based systems.

## Disaster Scenarios

### Scenario 1: Hardware Failure (Workstation)
**Impact**: Single workstation data loss
**Recovery**:
1. Install TransTrack on replacement hardware
2. Restore database backup from most recent backup
3. Restore encryption key from secure key backup
4. Verify backup integrity via `backup:create-and-verify`
5. Verify data completeness

### Scenario 2: Database Corruption
**Impact**: Local database unreadable
**Recovery**:
1. Stop TransTrack application
2. Attempt SQLite integrity check: `PRAGMA integrity_check`
3. If check fails, restore from most recent verified backup
4. Run data completeness verification
5. File incident report

### Scenario 3: Encryption Key Loss
**Impact**: Database inaccessible (cannot decrypt)
**Recovery**:
1. Check backup key file (`.transtrack-key.backup`)
2. Check offline key backup (safe, HSM, etc.)
3. If key recovered, restart application with key in place
4. If key unrecoverable, restore from backup with known key
5. **Critical**: Update key management procedures

### Scenario 4: Ransomware / Malware
**Impact**: Data encrypted by attacker or system compromised
**Recovery**:
1. Disconnect affected workstation from network
2. Do NOT pay ransom
3. Wipe and reimage the workstation
4. Install TransTrack fresh
5. Restore from offline backup (not connected to compromised network)
6. Rotate encryption keys
7. File breach notification per HIPAA requirements

## Backup Procedures

### Automated Backups
- **Frequency**: Every hour (recommended via OS task scheduler)
- **Retention**: 30 days minimum
- **Location**: Separate physical drive or network share
- **Verification**: Weekly integrity verification via `backup:create-and-verify`

### Manual Backups
- Available via File → Backup Database in the application menu
- Automatically verified after creation
- Audit logged

### Backup Verification Checklist
- [ ] Backup file exists and is non-zero size
- [ ] SHA-256 checksum recorded
- [ ] SQLite integrity check passes on backup
- [ ] Required tables present (patients, users, audit_logs, organizations)
- [ ] Record counts match expected values
- [ ] Backup can be opened with encryption key

## Recovery Procedures

### Step-by-Step Recovery
1. **Assess**: Determine the type and scope of the disaster
2. **Notify**: Alert the transplant center IT department and compliance officer
3. **Isolate**: If security-related, isolate affected systems
4. **Restore**: Follow scenario-specific recovery steps above
5. **Verify**: Run integrity checks and data completeness verification
6. **Document**: File incident report with timeline and actions taken
7. **Review**: Conduct post-incident review within 1 week

### Recovery Testing
- **Frequency**: Quarterly
- **Scope**: Full restore from backup to clean workstation
- **Documentation**: Record test date, duration, success/failure, and issues

## Contact Information

| Role | Contact | Responsibility |
|------|---------|---------------|
| IT Administrator | [Site-specific] | First responder, backup restoration |
| Compliance Officer | [Site-specific] | Breach notification, regulatory reporting |
| TransTrack Support | Trans_Track@outlook.com | Software-specific recovery assistance |

## HIPAA Breach Notification

If a disaster involves potential PHI exposure:
1. Notify Compliance Officer immediately
2. Begin breach risk assessment (45 CFR 164.402)
3. Notify affected individuals within 60 days if breach confirmed
4. Notify HHS if breach affects 500+ individuals
5. Document all notification activities

---

*This plan must be reviewed and updated annually or after any disaster event.*
*Last updated: 2026-03-21*
