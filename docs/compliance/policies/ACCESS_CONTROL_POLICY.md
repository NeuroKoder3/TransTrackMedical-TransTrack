# Access Control Policy (Template)

| Document control | |
|---|---|
| Document ID | TT-POL-AC-001 |
| Version | 1.0 |

## 1. Purpose

Define the rules for granting, modifying, reviewing, and revoking access to
TransTrack and to the ePHI it contains.

## 2. Roles and minimum permissions

| Role | Allowed actions |
|---|---|
| `admin` | Full system administration, user management, key rotation, audit reports, SIEM configuration. |
| `coordinator` | All operational coordination CRUD; cannot manage users or system settings. |
| `physician` | Read patient records; record clinical findings (post-tx events). Cannot delete. |
| `user` | Limited CRUD on assigned patients only. |
| `viewer` | Read-only access. |
| `regulator` | Read-only with audit-trail visibility for inspection purposes. |

## 3. Account lifecycle

### 3.1 Provisioning

* Triggered by HR onboarding ticket.
* `admin` provisions account with role per role-matrix.
* TOTP MFA enrollment required at first login.
* Initial password is single-use; user forced to change.

### 3.2 Modification

* Role changes require approval by the user's manager and the ISO.
* All changes audited.

### 3.3 Periodic access review

* Quarterly: `admin` runs the user list export and confirms each active account
  with the user's manager.
* Inactive accounts (no login in 90 days) automatically disabled.

### 3.4 Termination / role change

* HR notifies admin within 1 business day.
* Account disabled within 4 hours of notification (immediate for involuntary
  termination).
* All sessions invalidated.
* MFA backup codes revoked.
* Audit retained per Documentation Requirements.

## 4. Authentication

* Password length ≥12, complexity enforced (upper, lower, digit, symbol).
* Password rotation per the configured interval (default 90 days).
* Last 12 passwords cannot be reused.
* TOTP MFA required for `admin`, recommended for all roles, configurable.
* 5 failed attempts → 15 minute lockout (escalating with repeated lockouts).

## 5. Privileged access

`admin` actions (user management, key rotation, SIEM config, restore) are
audited with elevated detail. Privileged operations require:

* Active TOTP MFA session.
* Reauthentication if session age > 30 minutes.

## 6. Emergency access (break-glass)

* One sealed-envelope `admin` account credential maintained in a physical safe.
* Use is logged immediately on opening.
* Credential rotated within 24 hours of any use.

## 7. Logging

All authentication, authorization changes, and access-decision events are
recorded in `audit_logs` and (if configured) forwarded to SIEM.

## 8. Review

Annual policy review. Quarterly access review.

| Role | Signature | Date |
|---|---|---|
| ISO | | |
| HR Director | | |
