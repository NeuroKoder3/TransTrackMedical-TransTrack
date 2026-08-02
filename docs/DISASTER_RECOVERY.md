# Disaster Recovery — Operational Procedures

| Document ID | TT-DR-001 |
| --- | --- |
| Version | 2.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Information Security Officer |
| Normative parent | [`compliance/policies/BUSINESS_CONTINUITY_AND_DR.md`](compliance/policies/BUSINESS_CONTINUITY_AND_DR.md) (TT-POL-BCDR-001) |

> **This document is procedural, not normative.** The recovery objectives, the
> drill schedule and the retention rules are set by the Business Continuity and
> Disaster Recovery policy, **TT-POL-BCDR-001**. Where this document and the
> policy differ, the policy governs. This document describes *how* to execute
> the recovery, scenario by scenario.

## Objectives

Reproduced from TT-POL-BCDR-001 §1. Do not amend them here; amend the policy.

| Metric | Target | Basis |
|--------|--------|-------|
| **RTO** (Recovery Time Objective) | ≤ 4 hours | Time to restore full functionality on replacement hardware |
| **RPO** (Recovery Point Objective) | ≤ 24 hours | The application's built-in automated backup runs on a 24-hour interval (`electron/services/disasterRecovery.cjs`, `autoBackupIntervalHours: 24`). Worst-case loss is therefore one backup interval. |
| **MTTR** (Mean Time to Recovery) | ≤ 2 hours | Expected duration of a single-workstation restore |

> **Correction.** Revision 1 of this document stated an RPO of 1 hour while
> TT-POL-BCDR-001 stated 24 hours. Two authoritative objectives for one system
> is itself a defect (finding M-17). The reconciled objective is **≤ 24 hours**,
> because that is what the product actually delivers unaided: the built-in
> scheduler backs up once per 24 hours and retains 30 automatic backups. An
> hourly RPO was never achievable from the application alone.
>
> A site that requires a tighter RPO must engineer it and record it in its own
> business continuity plan — for example by scheduling `backup:create-and-verify`
> hourly through the OS task scheduler, or by placing the application data
> directory on storage with hourly snapshots. A site-tightened RPO does not
> change the vendor's stated objective.

## Architecture Context

TransTrack is a **local-first desktop application** with:
- Local encrypted SQLite database (SQLCipher)
- No cloud dependency for core operations
- Optional EHR integration via FHIR, and an optional early-access server tier

This simplifies disaster recovery relative to cloud-based systems, but it also
concentrates risk: for a desktop-only deployment, the workstation holds the only
copy of the data unless backups are being taken off the machine. Verify that
backups are actually leaving the workstation.

Sites running the optional server tier have a second recovery domain —
PostgreSQL — that is outside the scope of this document and must be covered by
the site's own database recovery procedures.

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
- **Frequency**: Every 24 hours, by the application's built-in scheduler (`autoBackupIntervalHours: 24`). This is what the ≤ 24 hour RPO is based on.
- **Retention**: 30 automatic backups are retained by the application (`maxAutoBackups: 30`); TT-POL-BCDR-001 §1 additionally requires daily for 30 days, weekly for 12 weeks and monthly for 12 months, which requires the site to copy backups to its own retained storage
- **Location**: Separate physical drive or network share. The application writes backups to the local application data directory by default; a site that does not move them off the workstation has no protection against workstation loss
- **Offsite copy**: at least one weekly copy in a geographically separate facility, per TT-POL-BCDR-001 §2
- **Verification**: Weekly integrity verification via `backup:create-and-verify`; monthly test restore

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
- **Frequency**: Quarterly file-restore drill; annual full-host failure simulation (TT-POL-BCDR-001 §4)
- **Scope**: Full restore from backup to clean workstation
- **Documentation**: Follow the drill procedure and record the outcome in the drill log in [`../RUNBOOK.md`](../RUNBOOK.md#5-disaster-recovery-drill) §5

> **No drill has been executed for release 1.3.0.** The quarterly restore drill
> mandated by TT-POL-BCDR-001 §4 has not been performed against this release by
> the vendor or by any site, and there is therefore no evidence that a restore
> completes within the stated RTO. The drill log in the runbook is empty for
> this release. Recorded as residual risk **RR-11** in
> [`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md).

## Contact Information

| Role | Contact | Responsibility |
|------|---------|---------------|
| IT Administrator | [Site-specific] | First responder, backup restoration |
| Compliance Officer | [Site-specific] | Breach notification, regulatory reporting |
| TransTrack Support | `support@transtrack.example` | Software-specific recovery assistance |
| TransTrack Security | `security@transtrack.example` | Suspected compromise or PHI exposure — see [`../SECURITY.md`](../SECURITY.md#reporting-a-security-issue) |

Vendor addresses are role-based placeholders that are not yet provisioned; see
residual risk **RR-15**.

## HIPAA Breach Notification

If a disaster involves potential PHI exposure:
1. Notify Compliance Officer immediately
2. Begin breach risk assessment (45 CFR 164.402)
3. Notify affected individuals within 60 days if breach confirmed
4. Notify HHS if breach affects 500+ individuals
5. Document all notification activities

---

*These procedures must be reviewed and updated annually or after any disaster
event, and whenever TT-POL-BCDR-001 changes.*

## Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.0 | 2026-03-21 | Initial procedures. | Information Security Officer |
| 2.0 | 2026-08-02 | Reconciled the RPO with TT-POL-BCDR-001, which stated a different objective (finding M-17 item 7). Declared this document procedural and the BCDR policy normative. Corrected the automated-backup frequency to match the application's 24-hour scheduler. Added an explicit statement that no DR drill has been executed for this release (RR-11) and pointed the drill log at the runbook. Replaced the consumer webmail contact with role-based addresses (L-13). Added document control header. | Information Security Officer |
