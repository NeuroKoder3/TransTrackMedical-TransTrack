# TransTrack Validation Plan

| Document control | |
|---|---|
| Document ID | TT-VP-001 |
| Version | 1.0 |
| Status | Template — to be ratified by deploying organization |
| Effective date | _to be set on ratification_ |
| Author | Engineering |
| Approver | _Quality Assurance Officer_ |

## 1. Purpose

This Validation Plan describes the activities, roles, deliverables, and acceptance
criteria that the deploying organization shall execute to validate TransTrack as
fit for its intended use within its quality management system.

## 2. Scope

In scope:
* The TransTrack desktop application (Electron) and its embedded SQLite (SQLCipher)
  database.
* All bundled IPC handlers, services, and migrations.
* Backup, restore, audit logging, MFA, and SIEM forwarding subsystems.

Out of scope:
* The customer's host operating system, identity provider, network, and SIEM —
  these are validated by the customer's IT department under their own SOPs.
* Clinical decision-making — TransTrack is an operational/coordination system and
  does not perform allocation or diagnosis.

## 3. Regulatory framework

| Framework | Applicability |
|---|---|
| HIPAA Security Rule (45 CFR §164.308 / .310 / .312) | Applies. See `HIPAA_SECURITY_RULE_MAPPING.md`. |
| HIPAA Privacy & Breach Notification Rules (45 CFR §164.500 / 164.400) | Customer responsibility; supported by audit logs and breach-notification policy. |
| 21 CFR Part 11 | Applies if the customer treats TransTrack records as 21 CFR Part 11 electronic records. See `PART_11_CONTROL_MAPPING.md`. |
| 21 CFR §860 / §820 (Quality System Regulation) | Customer-dependent — see `FDA_DEVICE_RATIONALE.md`. |
| OPTN Policies / 42 CFR §121 | Operational; TransTrack does not perform UNet-equivalent allocation. |
| GAMP 5 | TransTrack is treated as **Category 4 (configurable)** software. |
| ISO 14971 | Risk management framework adopted in `RISK_REGISTER.md`. |
| ISO/IEC 27001 / SOC 2 | Customer-dependent attestation. |

## 4. Validation lifecycle

We adopt a V-model with explicit traceability between left-leg (specification) and
right-leg (verification) artifacts:

```
URS  ─────────────────────────────────────────────►  PQ
   SRS  ──────────────────────────────────►  OQ
       SDS  ────────────────────►  IQ
```

| Stage | Artifact | Owner | Required? |
|---|---|---|---|
| User Requirements | `SYSTEM_REQUIREMENTS_SPECIFICATION.md` | Customer + Vendor | Yes |
| System Requirements | `SYSTEM_REQUIREMENTS_SPECIFICATION.md` | Vendor | Yes |
| Design | `SOFTWARE_DESIGN_SPECIFICATION.md` | Vendor | Yes |
| Risk Analysis | `RISK_REGISTER.md` | Customer + Vendor | Yes |
| Installation Qualification | `templates/IQ_PROTOCOL_TEMPLATE.md` | Customer | Per install |
| Operational Qualification | `templates/OQ_PROTOCOL_TEMPLATE.md` | Customer | Per major release |
| Performance Qualification | `templates/PQ_PROTOCOL_TEMPLATE.md` | Customer | Per major release |
| Validation Summary | `VALIDATION_SUMMARY_REPORT_TEMPLATE.md` | Customer (QA) | Per major release |
| Periodic Review | _customer SOP_ | Customer (QA) | Annually |

## 5. Roles and responsibilities

| Role | Responsibility |
|---|---|
| Customer Quality Assurance Officer | Approves the Validation Plan, signs the Validation Summary Report, owns periodic review. |
| Customer Transplant Administrator | Approves URS, executes PQ scripts. |
| Customer IT / Security | Approves IQ, owns infrastructure (OS, network, SIEM, IdP). |
| Vendor Engineering | Maintains SRS, SDS, traceability matrix, regression tests. |
| Vendor Release Manager | Provides release notes, signed installers, test summaries. |

## 6. Acceptance criteria

A release is **validated for production use** when **all** of the following are true:

1. SRS, SDS, Risk Register, and Traceability Matrix have been reviewed and the deltas
   from the previous validated release are documented and approved.
2. IQ has been executed on each target machine and 100% of mandatory checks pass.
3. OQ has been executed and 100% of test cases marked **Mandatory** pass.
4. PQ has been executed against the customer's representative workflow with no
   unresolved Severity 1 or Severity 2 defects (per `RISK_REGISTER.md`).
5. The Validation Summary Report is signed by the Quality Assurance Officer.
6. The signed report and supporting evidence are stored in the customer's
   document control system for the retention period defined in
   `policies/DATA_RETENTION_AND_DESTRUCTION.md`.

## 7. Change control during validation

Any change to the system after IQ but before VSR sign-off invokes the change-control
SOP (`policies/CHANGE_MANAGEMENT_SOP.md`). Patches that fix non-validated
functionality may proceed under "delta validation" (re-run only impacted OQ/PQ
sections).

## 8. Periodic review

The Quality Assurance Officer shall conduct a documented periodic review at least
annually covering:
* Audit log integrity sample
* Backup restore drill (per BCDR policy)
* Access review (RBAC + MFA enrollment)
* Open risks vs. mitigations
* CVE / security advisories impacting bundled components (Node.js, Electron,
  SQLCipher, etc.)

## 9. Supporting standards

* GAMP 5 (ISPE, 2nd ed.)
* ISO 14971:2019 — Risk management for medical devices
* IEC 62304 — Software lifecycle for medical device software (informational; not
  invoked unless customer treats TransTrack as a medical device)
* NIST SP 800-66 Rev. 2 — Implementing the HIPAA Security Rule
