# Incident Response Plan (Template)

| Document control | |
|---|---|
| Document ID | TT-POL-IR-001 |
| Version | 1.0 |

## 1. Purpose

Define the lifecycle and roles for responding to security incidents that affect
TransTrack or the ePHI it contains.

## 2. Scope

All confirmed or suspected incidents that may compromise the confidentiality,
integrity, or availability of ePHI within TransTrack.

## 3. Incident severity

| Sev | Definition | Examples |
|---|---|---|
| 1 | Confirmed PHI breach or imminent risk thereof. | Database extracted; admin account compromised; ransomware on host. |
| 2 | Probable PHI exposure or significant disruption. | Lost laptop with TransTrack; suspicious admin activity. |
| 3 | Localized incident with limited PHI risk. | Failed login flood from one IP; benign malware quarantined. |
| 4 | Operational issue with no PHI risk. | Application crash; SIEM forwarder offline. |

## 4. Lifecycle

### 4.1 Detection

* Sources: SIEM alerts, audit-log monitoring, user reports, vendor advisories.
* Anyone aware of a possible incident is required to report to the ISO within
  1 hour.

### 4.2 Triage and classification

* ISO classifies severity within 4 hours of report.
* Incident ticket created in customer ITSM with mandatory fields:
  detected_at, reporter, summary, severity, scope, initial actions.

### 4.3 Containment

* Severity 1: isolate affected host(s) from network within 1 hour;
  invalidate active sessions; rotate admin credentials.
* Severity 2: increase monitoring; restrict affected user(s).
* Severity 3-4: contain at appropriate scope.

### 4.4 Eradication

* Remove malware / revoke credentials / patch vulnerability.
* Forensic image taken before destructive remediation.

### 4.5 Recovery

* Restore from validated backup if integrity is in doubt.
* Verify restored system passes integrity check.
* Resume normal operations under heightened monitoring for ≥7 days.

### 4.6 Lessons learned

* Within 14 days, post-incident review meeting with ISO, system admin,
  affected workforce.
* Update Risk Register and policies as required.

## 5. Breach notification (HIPAA Breach Notification Rule)

If the incident is a **breach** of **unsecured PHI** (i.e., PHI not rendered
unusable per the HHS guidance — e.g., unencrypted backup):

| Recipient | Timing |
|---|---|
| Individuals affected | Without unreasonable delay, ≤60 days from discovery. |
| HHS Secretary (≥500 individuals) | Concurrent with individual notice. |
| HHS Secretary (<500 individuals) | Annual log within 60 days of calendar year end. |
| Prominent media outlets (≥500 in single state/jurisdiction) | Without unreasonable delay, ≤60 days. |
| Business Associates → Covered Entity | ≤60 days from discovery. |
| State attorneys general | Per state law. |

**Discovery** = first day the incident is known or *should reasonably have been
known* by any workforce member other than the perpetrator.

PHI rendered **secured** by encryption per HHS guidance is generally **not** a
breach — TransTrack's at-rest encryption supports this safe-harbor when keys
were not also compromised.

## 6. Roles

| Role | Responsibility |
|---|---|
| Incident Commander (ISO) | Owns the incident end-to-end. |
| HIPAA Privacy Officer | Determines breach status and notification. |
| Legal Counsel | Reviews notifications. |
| Communications | External communications (if needed). |
| System Admin | Technical containment and recovery. |
| Vendor (TransTrack engineering) | Engaged for severity 1-2 promptly. |

## 7. Drills

Tabletop exercise annually. Live drill (e.g., simulated host isolation +
restore) annually.

| Role | Signature | Date |
|---|---|---|
| ISO | | |
| HIPAA Privacy Officer | | |
| Legal Counsel | | |
