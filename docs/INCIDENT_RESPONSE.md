# Incident Response Procedures

## Overview

This document defines TransTrack's incident response procedures for security events, data breaches, and system failures. All staff with access to TransTrack must be familiar with these procedures.

**HIPAA Breach Notification Rule**: 45 CFR §§ 164.400-414

---

## Severity Classification

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| **SEV-1** | Active data breach or system compromise | Immediate (< 1 hour) | Unauthorized PHI access, ransomware |
| **SEV-2** | Potential breach or critical vulnerability | < 4 hours | Suspected unauthorized access, critical CVE |
| **SEV-3** | Security anomaly or non-critical issue | < 24 hours | Failed login spikes, audit log anomalies |
| **SEV-4** | Minor security event | < 72 hours | Policy violations, configuration drift |

---

## Data Breach Notification

### 1. Immediate Actions (Within 1 Hour)

- [ ] Isolate affected machine from network
- [ ] Do NOT power off (preserve volatile evidence)
- [ ] Document the discovery: who, what, when, where
- [ ] Notify Incident Response Lead
- [ ] Notify IT Security team
- [ ] Begin incident log (use template below)

### 2. Assessment (Within 4 Hours)

- [ ] Determine scope of affected data
  - Number of patient records potentially accessed
  - Types of PHI involved (names, DOB, SSN, medical records)
  - Duration of unauthorized access
- [ ] Identify attack vector
  - Physical access to machine?
  - Software vulnerability?
  - Credential compromise?
  - Social engineering?
- [ ] Preserve evidence
  - Copy audit logs from `%APPDATA%/TransTrack/logs/`
  - Export database audit trail via `recovery:createBackup`
  - Screenshot any error messages or anomalies
  - Record system event logs

### 3. Containment (Within 8 Hours)

- [ ] Rotate database encryption key (`encryption:rotateKey`)
- [ ] Force logout all active sessions
- [ ] Reset affected user passwords
- [ ] Apply emergency patches if vulnerability-based
- [ ] Verify audit log immutability (triggers intact)
- [ ] Create verified backup of current state

### 4. Notification (Within 24 Hours Internal, 60 Days External)

#### Internal Notification Chain

1. **Incident Response Lead** → Immediate
2. **HIPAA Privacy Officer** → Within 2 hours
3. **Legal Counsel** → Within 4 hours
4. **Executive Leadership** → Within 8 hours

#### External Notification (if breach confirmed)

**HIPAA requires notification within 60 calendar days of discovery:**

| Affected Individuals | Notification Required |
|---------------------|----------------------|
| < 500 | Individual notice + HHS annual report |
| ≥ 500 | Individual notice + HHS within 60 days + media notice |

- [ ] Notify affected individuals in writing
- [ ] File with HHS Office for Civil Rights (OCR)
- [ ] If ≥ 500 affected: notify prominent media outlets in affected state(s)
- [ ] Document all notifications with dates and recipients

### 5. Recovery

- [ ] Restore from last known-good verified backup
- [ ] Verify data integrity post-restoration
- [ ] Re-enable services with enhanced monitoring
- [ ] Conduct post-restore verification queries
- [ ] Confirm audit trail continuity

### 6. Post-Incident Review (Within 14 Days)

- [ ] Conduct root cause analysis
- [ ] Document lessons learned
- [ ] Update security controls as needed
- [ ] Update this incident response plan
- [ ] Schedule follow-up review (30 days, 90 days)
- [ ] File incident report with compliance team

---

## System Failure Response

### Database Corruption

1. Stop TransTrack application
2. Run `recovery:verifyBackup` on most recent backup
3. If verified, run `recovery:restoreBackup` with admin credentials
4. Verify data integrity after restore
5. Log incident in audit trail

### Encryption Key Loss

1. Locate backup key at `%APPDATA%/TransTrack/.transtrack-key.backup`
2. If backup key exists, copy to `.transtrack-key`
3. If no backup key exists, data recovery is **not possible**
4. Restore from last verified backup created before key loss
5. Rotate encryption key immediately after recovery

### Application Crash Loop

1. Check logs at `%APPDATA%/TransTrack/logs/`
2. Rename database to force fresh initialization (if acceptable)
3. Or restore from backup
4. Report crash details to development team

---

## Incident Log Template

```
INCIDENT ID: INC-[YYYY]-[NNNN]
SEVERITY: SEV-[1-4]
DATE DISCOVERED: [YYYY-MM-DD HH:MM UTC]
DISCOVERED BY: [Name, Role]
DESCRIPTION: [Brief description]

TIMELINE:
  [HH:MM] - [Action taken]
  [HH:MM] - [Action taken]

AFFECTED DATA:
  - Patient records: [count or "unknown"]
  - PHI types: [list]
  - Duration of exposure: [estimate]

ROOT CAUSE: [Once determined]

CONTAINMENT ACTIONS:
  1. [Action]
  2. [Action]

NOTIFICATIONS:
  - [Date] [Recipient] [Method]

RESOLUTION:
  [Description of fix]

FOLLOW-UP ITEMS:
  - [ ] [Action item]
```

---

## Contact Information

| Role | Contact | Availability |
|------|---------|-------------|
| Incident Response Lead | [Designated Person] | 24/7 |
| HIPAA Privacy Officer | [Designated Person] | Business hours + on-call |
| IT Security | Trans_Track@outlook.com | Business hours |
| Legal Counsel | [Designated Firm] | Business hours |
| HHS OCR Breach Portal | https://ocrportal.hhs.gov/ocr/breach/wizard_breach.jsf | 24/7 |

---

## Annual Review

This incident response plan must be:
- Reviewed annually by the security team
- Updated after every SEV-1 or SEV-2 incident
- Tested via tabletop exercise at least once per year
- Distributed to all personnel with TransTrack access

**Last Review Date**: ________________
**Next Review Due**: ________________
**Reviewed By**: ________________
