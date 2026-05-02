# TransTrack Compliance & Validation Package

This directory contains the documentation that a deploying organization (transplant
center, OPO, or transplant IT vendor) needs in order to validate TransTrack against
HIPAA Security Rule, 21 CFR Part 11, AATB Standards, and internal change-control
requirements.

> **Important:** Nothing in this directory is a certification. These are design-control
> documents and templates. Actual compliance attestations (SOC 2 Type II, HITRUST r2,
> 21 CFR Part 11 validation summary signed by a QA officer, FDA non-device determination,
> etc.) must be produced by the deploying organization or its auditors.

## Document Index

### Validation framework
| Document | Purpose |
|---|---|
| [`VALIDATION_PLAN.md`](VALIDATION_PLAN.md) | Master plan describing the validation lifecycle, roles, and deliverables (GAMP 5 Category 4 software). |
| [`SYSTEM_REQUIREMENTS_SPECIFICATION.md`](SYSTEM_REQUIREMENTS_SPECIFICATION.md) | Numbered functional and non-functional requirements (URS / SRS). |
| [`SOFTWARE_DESIGN_SPECIFICATION.md`](SOFTWARE_DESIGN_SPECIFICATION.md) | High-level design and architecture mapped to requirements. |
| [`TRACEABILITY_MATRIX.md`](TRACEABILITY_MATRIX.md) | Requirement → design → test traceability. |
| [`RISK_REGISTER.md`](RISK_REGISTER.md) | ISO 14971-style risk register and mitigations. |
| [`VALIDATION_SUMMARY_REPORT_TEMPLATE.md`](VALIDATION_SUMMARY_REPORT_TEMPLATE.md) | Template for the deploying organization to sign after IQ/OQ/PQ are executed. |

### Qualification protocols (templates to execute on the customer site)
| Document | Purpose |
|---|---|
| [`templates/IQ_PROTOCOL_TEMPLATE.md`](templates/IQ_PROTOCOL_TEMPLATE.md) | Installation Qualification — verify environment, prerequisites, install correctness. |
| [`templates/OQ_PROTOCOL_TEMPLATE.md`](templates/OQ_PROTOCOL_TEMPLATE.md) | Operational Qualification — verify each requirement-driven function works. |
| [`templates/PQ_PROTOCOL_TEMPLATE.md`](templates/PQ_PROTOCOL_TEMPLATE.md) | Performance Qualification — verify the system performs in the deployed clinical workflow. |

### Worked validation example (demonstration only — not a real validation)
| Document | Purpose |
|---|---|
| [`pilot-site-example/README.md`](pilot-site-example/README.md) | Index for a fully-fleshed-out walkthrough of an executed validation package against a **fictional** pilot site. Demonstration data only — see the disclaimer banner. |
| [`pilot-site-example/VALIDATION_SUMMARY_REPORT_EXAMPLE.md`](pilot-site-example/VALIDATION_SUMMARY_REPORT_EXAMPLE.md) | Worked example of the signed top-level VSR. |
| [`pilot-site-example/IQ_PROTOCOL_EXAMPLE.md`](pilot-site-example/IQ_PROTOCOL_EXAMPLE.md) | Worked example of an executed IQ protocol. |
| [`pilot-site-example/OQ_PROTOCOL_EXAMPLE.md`](pilot-site-example/OQ_PROTOCOL_EXAMPLE.md) | Worked example of an executed OQ protocol (with three Severity-3 findings to model the defect-handling flow). |
| [`pilot-site-example/PQ_PROTOCOL_EXAMPLE.md`](pilot-site-example/PQ_PROTOCOL_EXAMPLE.md) | Worked example of an executed PQ protocol. |

### Regulatory mappings
| Document | Purpose |
|---|---|
| [`HIPAA_SECURITY_RULE_MAPPING.md`](HIPAA_SECURITY_RULE_MAPPING.md) | Maps each 45 CFR §164.308 / .310 / .312 control to TransTrack design controls. |
| [`PART_11_CONTROL_MAPPING.md`](PART_11_CONTROL_MAPPING.md) | Maps each 21 CFR Part 11 §11.10 / .30 / .50 / .70 / .200 / .300 requirement to TransTrack controls. |
| [`FDA_DEVICE_RATIONALE.md`](FDA_DEVICE_RATIONALE.md) | Rationale and counter-positions for why TransTrack is operated as a non-device CDS tool, with caveats for legal review. |

### Operational policies (HIPAA Administrative Safeguards)
| Document | Purpose |
|---|---|
| [`policies/INFORMATION_SECURITY_POLICY.md`](policies/INFORMATION_SECURITY_POLICY.md) | Top-level information security policy. |
| [`policies/ACCESS_CONTROL_POLICY.md`](policies/ACCESS_CONTROL_POLICY.md) | Account management, RBAC, MFA, deprovisioning. |
| [`policies/INCIDENT_RESPONSE_PLAN.md`](policies/INCIDENT_RESPONSE_PLAN.md) | Detection, containment, eradication, recovery, lessons learned, breach notification timing. |
| [`policies/BUSINESS_CONTINUITY_AND_DR.md`](policies/BUSINESS_CONTINUITY_AND_DR.md) | RTO/RPO targets, backup, restore drills. |
| [`policies/DATA_RETENTION_AND_DESTRUCTION.md`](policies/DATA_RETENTION_AND_DESTRUCTION.md) | Retention windows, destruction methods. |
| [`policies/CHANGE_MANAGEMENT_SOP.md`](policies/CHANGE_MANAGEMENT_SOP.md) | SDLC change control aligned with Part 11. |
| [`policies/BREACH_NOTIFICATION_POLICY.md`](policies/BREACH_NOTIFICATION_POLICY.md) | HIPAA Breach Notification Rule procedures. |

## How to use this package as a customer

1. Read `VALIDATION_PLAN.md` end-to-end and adapt to your organization's QMS.
2. Review `RISK_REGISTER.md` and add organization-specific risks.
3. Execute `templates/IQ_PROTOCOL_TEMPLATE.md` on each install.
4. Execute `templates/OQ_PROTOCOL_TEMPLATE.md` after the IQ passes.
5. Execute `templates/PQ_PROTOCOL_TEMPLATE.md` with your real (test) clinical workflow.
6. Use `VALIDATION_SUMMARY_REPORT_TEMPLATE.md` as the signed cover document.
7. Map your local SOPs to `HIPAA_SECURITY_RULE_MAPPING.md` and `PART_11_CONTROL_MAPPING.md`.

## How to use this package as a vendor / acquirer

The presence and quality of these artifacts is itself a buying signal. A reviewer
should expect to find: numbered requirements traced to tests, a risk register with
mitigations, executable IQ/OQ/PQ templates, and explicit policy documents that map
to HIPAA Administrative Safeguards. All of those exist here.
