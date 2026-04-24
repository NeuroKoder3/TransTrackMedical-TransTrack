# HIPAA Security Rule Control Mapping

Maps each Standard / Implementation Specification of the HIPAA Security Rule
(45 CFR §164.308 Administrative, §164.310 Physical, §164.312 Technical) to the
TransTrack design controls that support it.

> **Required (R)** specifications must be implemented; **Addressable (A)** must be
> implemented or a documented compensating control must exist. The "Customer
> responsibility" column flags items that the deploying organization must own.

## §164.308 Administrative Safeguards

| Standard | Spec | R/A | TransTrack control | Customer responsibility |
|---|---|---|---|---|
| Security Management Process (a)(1) | Risk Analysis (i)(A) | R | `RISK_REGISTER.md` baseline | Extend with site-specific risks |
| | Risk Management (i)(B) | R | Risk register includes mitigations and residual risk class | Approve residual risk |
| | Sanction Policy (i)(C) | R | — | Customer HR policy |
| | Information System Activity Review (i)(D) | R | Audit logs + admin audit reports | Periodic review SOP |
| Assigned Security Responsibility (a)(2) | | R | — | Designate Security Officer |
| Workforce Security (a)(3) | Authorization/Supervision (i)(A) | A | RBAC with `admin / coordinator / physician / user / viewer / regulator` roles | Authorization SOP |
| | Workforce Clearance (i)(B) | A | — | Customer onboarding |
| | Termination Procedures (i)(C) | A | Disable user via admin UI; sessions invalidated | Offboarding SOP |
| Information Access Management (a)(4) | Isolating HCC functions (i)(A) | R | Per-org isolation (`org_id` scoping) | — |
| | Access Authorization (i)(B) | A | RBAC with role assignment audited | Authorization matrix |
| | Access Establishment & Modification (i)(C) | A | All role changes audited | Periodic access review |
| Security Awareness & Training (a)(5) | Security Reminders (i)(A) | A | Login banner; About dialog disclaimers | Training program |
| | Protection from Malicious Software (i)(B) | A | — | Endpoint AV |
| | Log-in Monitoring (i)(C) | A | Failed-login tracking, lockout, audit | — |
| | Password Management (i)(D) | A | Complexity, history, expiration, MFA | Password reset SOP |
| Security Incident Procedures (a)(6) | Response & Reporting | R | `policies/INCIDENT_RESPONSE_PLAN.md` | Adopt and run drills |
| Contingency Plan (a)(7) | Data Backup Plan (i)(A) | R | Encrypted backup tooling | Schedule + offsite copy |
| | Disaster Recovery Plan (i)(B) | R | `policies/BUSINESS_CONTINUITY_AND_DR.md` | Run drills |
| | Emergency Mode Operation Plan (i)(C) | R | Offline-first, no external dependency | — |
| | Testing and Revision (i)(D) | A | Restore drill in BCDR policy | Document drills |
| | Applications & Data Criticality Analysis (i)(E) | A | — | Customer business impact analysis |
| Evaluation (a)(8) | | R | Validation Plan + periodic review | Annual evaluation |
| Business Associate Contracts (b)(1) | | R | — | Customer–vendor BAA if applicable |

## §164.310 Physical Safeguards

| Standard | Spec | R/A | TransTrack control | Customer responsibility |
|---|---|---|---|---|
| Facility Access Controls (a)(1) | Contingency Operations (i)(A) | A | — | Customer facility plan |
| | Facility Security Plan (i)(B) | A | — | Customer facility plan |
| | Access Control & Validation (i)(C) | A | — | Customer facility plan |
| | Maintenance Records (i)(D) | A | — | Customer facility plan |
| Workstation Use (b) | | R | — | Customer policy |
| Workstation Security (c) | | R | — | Customer policy |
| Device & Media Controls (d)(1) | Disposal (i)(A) | R | Encrypted DB; key destruction = data destruction | Documented destruction |
| | Media Re-use (i)(B) | R | Same | Documented procedure |
| | Accountability (i)(C) | A | Backup log / audit | Asset register |
| | Data Backup & Storage (i)(D) | A | Backup tooling | Storage location SOP |

## §164.312 Technical Safeguards

| Standard | Spec | R/A | TransTrack control | Customer responsibility |
|---|---|---|---|---|
| Access Control (a)(1) | Unique User Identification (i)(A) | R | `users.id` unique per org; no shared accounts permitted | Account governance |
| | Emergency Access Procedure (i)(B) | R | Break-glass admin account documented in `policies/INCIDENT_RESPONSE_PLAN.md` | Maintain sealed credentials |
| | Automatic Logoff (i)(C) | A | `IdleTimeoutManager` enforces idle logout (default 15 min) | Configure timeout |
| | Encryption & Decryption (i)(D) | A | SQLCipher AES-256 + PBKDF2-SHA512 ≥256 000 | — |
| Audit Controls (b) | | R | Append-only audit logs + DB-trigger immutability + optional SIEM forward | Log retention policy |
| Integrity (c)(1) | Mechanism to Authenticate ePHI (i)(A) | A | SQLCipher integrity check at startup | — |
| Person/Entity Authentication (d) | | R | Username/password + TOTP MFA | MFA enforcement policy |
| Transmission Security (e)(1) | Integrity Controls (i)(A) | A | No untrusted network egress by default; FHIR / SIEM TLS configurable | TLS configuration |
| | Encryption (i)(B) | A | TLS for SIEM and FHIR endpoints | TLS configuration |

## §164.314 Organizational Requirements

Customer-owned (BAA, group health plan).

## §164.316 Documentation Requirements

| Standard | TransTrack control | Customer responsibility |
|---|---|---|
| Policies & Procedures (a) | Policy templates in `policies/` | Adopt, sign, distribute |
| Documentation (b)(1)(i) Time limit | — | 6-year retention from creation or last effective date |
| (b)(2)(i) Availability | — | Document control system |
| (b)(2)(ii) Updates | Periodic review section of Validation Plan | Annual review |
