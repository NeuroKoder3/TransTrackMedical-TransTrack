# Information Security Policy (Template)

| Document control | |
|---|---|
| Document ID | TT-POL-IS-001 |
| Version | 1.0 |
| Status | Template — to be ratified by deploying organization |

## 1. Purpose

This policy establishes the principles and rules that govern the protection of
information assets handled by TransTrack within the organization.

## 2. Scope

Applies to all workforce members, contractors, and business associates who use,
operate, or administer TransTrack and its supporting infrastructure. Covers all
electronic protected health information (ePHI) processed by the application.

## 3. Roles

| Role | Responsibility |
|---|---|
| Information Security Officer (ISO) | Owner of this policy. Approves exceptions. |
| HIPAA Privacy / Security Officer | Owns HIPAA program; reviews this policy annually. |
| System Administrator | Operates TransTrack day-to-day; enforces RBAC; performs key rotation. |
| Workforce member | Complies with this policy; reports incidents. |

## 4. Principles

1. **Confidentiality** — ePHI is accessed strictly on a need-to-know basis.
2. **Integrity** — ePHI is altered only through authorized, audited actions.
3. **Availability** — ePHI is available to authorized users when required for
   patient coordination and safety.
4. **Accountability** — every action against ePHI is attributable to an
   identified person and is auditable.
5. **Least privilege** — users receive the minimum role and permissions
   necessary.
6. **Defense in depth** — encryption, RBAC, MFA, lockout, audit, and SIEM are
   layered controls.

## 5. Mandatory controls

* Per-user accounts; no shared logins.
* TOTP MFA enforced for `admin` role at minimum; recommended for all roles.
* Account lockout after 5 failed attempts for ≥15 minutes.
* Idle session timeout ≤15 minutes.
* Disk encryption enabled on all hosts running TransTrack.
* Endpoint security agent running and reporting to SOC.
* All TransTrack actions audited; audit logs are immutable; audit logs are
  optionally forwarded to the organization SIEM.
* Backups encrypted, tested via documented restore drills.
* Patches applied per the Vulnerability Management section below.

## 6. Vulnerability and patch management

* Critical security patches: applied within 7 days of vendor release.
* High: within 30 days.
* Medium: within 90 days.
* Vendor security advisories monitored continuously.
* Annual penetration test by an independent qualified party.

## 7. Acceptable use

* TransTrack shall not be used for any non-clinical, non-coordination purpose.
* No copying of ePHI to removable media without explicit ISO authorization.
* No screenshots or photographs of TransTrack screens displaying ePHI without
  documented business justification and minimum necessary scope.

## 8. Enforcement

Violations are addressed under the organization's HR sanctions policy, up to
and including termination and notification of authorities for criminal acts.

## 9. Review

Annual review by the ISO. Triggered review on significant change to TransTrack
or to the regulatory environment.

| Role | Signature | Date |
|---|---|---|
| Information Security Officer | | |
| HIPAA Privacy/Security Officer | | |
| Executive Sponsor | | |
