# TransTrack Compliance & Validation Package

| Document ID | TT-CP-INDEX |
| --- | --- |
| Version | 2.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Quality Assurance Officer |

This directory contains the documentation that a deploying organization (transplant
center, OPO, or transplant IT vendor) needs in order to validate TransTrack against
the HIPAA Security Rule, 21 CFR Part 11, and its own internal change-control
requirements.

No AATB (American Association of Tissue Banks) conformance is claimed and no
AATB control mapping exists. Earlier revisions of this index asserted AATB
alignment; the claim was unsupported and has been withdrawn.

> **Important:** Nothing in this directory is a certification. These are design-control
> documents. Actual compliance attestations (SOC 2 Type II, HITRUST r2,
> 21 CFR Part 11 validation summary signed by a QA officer, FDA non-device determination,
> etc.) must be produced by the deploying organization or its auditors.

## Start here

| If you are | Read first |
|---|---|
| Assessing whether this system is validated | [`VALIDATION_SUMMARY_REPORT.md`](VALIDATION_SUMMARY_REPORT.md) — it states plainly which qualification stages are complete and which are not |
| Planning your own validation | [`VALIDATION_PLAN.md`](VALIDATION_PLAN.md), then [`executed/PQ_TT-PQ-001.md`](executed/PQ_TT-PQ-001.md) |
| Assessing residual risk before deployment | [`RESIDUAL_RISK.md`](RESIDUAL_RISK.md) and [`FMEA.md`](FMEA.md) |
| Reviewing clinical calculation provenance | [`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md) |

**Validation status in one line:** vendor software verification for release
1.3.0 is executed and recorded in [`executed/`](executed/); site Installation,
Operational and Performance Qualification are **not** executed and are the
deploying organization's responsibility.

## Scope and product maturity

| Component | Maturity | Covered by the vendor validation package |
|---|---|---|
| Desktop application (`electron/`, `src/`) | Released | Yes — vendor IQ and the automated portion of OQ are executed |
| Optional server tier (`server/`) | **Early access** | Partially. Unit-level verification only. The integration suites require a live PostgreSQL instance, which was not available in the vendor verification environment, so row-level security and cross-tenant isolation are evidenced at the DDL and application-query level rather than by execution against a running database. A site deploying the server tier must extend its own OQ and PQ to cover it. See residual risks **RR-04** and **RR-14**. |

## Document Index

### Executed validation package for release 1.3.0
| Document | Purpose |
|---|---|
| [`VALIDATION_SUMMARY_REPORT.md`](VALIDATION_SUMMARY_REPORT.md) | The signed cover document for this release. States what was executed, by whom, what was not, and why. **Read this first.** |
| [`executed/IQ_TT-IQ-001.md`](executed/IQ_TT-IQ-001.md) | Executed Installation Qualification — vendor portion. Host-specific steps are marked NOT EXECUTED with the reason and the party responsible. |
| [`executed/OQ_TT-OQ-001.md`](executed/OQ_TT-OQ-001.md) | Executed Operational Qualification — automated portion. Every case cites a real test file. The interactive portion is marked NOT EXECUTED. |
| [`executed/PQ_TT-PQ-001.md`](executed/PQ_TT-PQ-001.md) | Performance Qualification protocol. **NOT EXECUTED by the vendor** — PQ requires clinical users and site data and is the deploying organization's responsibility. |
| [`FMEA.md`](FMEA.md) | Failure mode and effects analysis over the actual failure modes of this system, with RPNs and required actions. |
| [`RESIDUAL_RISK.md`](RESIDUAL_RISK.md) | Formal residual-risk statements: what is accepted, why, the compensating controls, and the criteria to close each one. |

### Validation framework
| Document | Purpose |
|---|---|
| [`VALIDATION_PLAN.md`](VALIDATION_PLAN.md) | Master plan describing the validation lifecycle, roles, and deliverables (GAMP 5 Category 4 software). |
| [`SYSTEM_REQUIREMENTS_SPECIFICATION.md`](SYSTEM_REQUIREMENTS_SPECIFICATION.md) | Numbered functional and non-functional requirements (URS / SRS). |
| [`SOFTWARE_DESIGN_SPECIFICATION.md`](SOFTWARE_DESIGN_SPECIFICATION.md) | High-level design and architecture mapped to requirements. |
| [`TRACEABILITY_MATRIX.md`](TRACEABILITY_MATRIX.md) | Requirement → design → test traceability. |
| [`RISK_REGISTER.md`](RISK_REGISTER.md) | ISO 14971-style risk register and mitigations. |
| [`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md) | Controlled-source register for every clinical calculator constant, including the sources that could not be verified. |
| `scripts/check-compliance-docs.mjs` | Automated consistency gate over the documents above: unique requirement ids, a matrix row per requirement, a verification artifact for every Mandatory requirement, and resolvable SDS, OQ and risk references. Runs in the standard test suite. It does **not** currently verify that cited test files exist on disk; that gap was found as I-7 and the citations were audited by hand for this release. |
| [`VALIDATION_SUMMARY_REPORT_TEMPLATE.md`](VALIDATION_SUMMARY_REPORT_TEMPLATE.md) | Blank template for a deploying organization to produce its own site VSR. Not to be confused with `VALIDATION_SUMMARY_REPORT.md`, which is the executed vendor report for this release. |

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
| [`policies/BUSINESS_CONTINUITY_AND_DR.md`](policies/BUSINESS_CONTINUITY_AND_DR.md) | **Normative** RTO/RPO targets, backup retention, restore drill schedule. The procedural companion is [`../DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md). |
| [`policies/DATA_RETENTION_AND_DESTRUCTION.md`](policies/DATA_RETENTION_AND_DESTRUCTION.md) | Retention windows, destruction methods. |
| [`policies/CHANGE_MANAGEMENT_SOP.md`](policies/CHANGE_MANAGEMENT_SOP.md) | SDLC change control aligned with Part 11. |
| [`policies/BREACH_NOTIFICATION_POLICY.md`](policies/BREACH_NOTIFICATION_POLICY.md) | HIPAA Breach Notification Rule procedures. |

## How to use this package as a customer

1. Read [`VALIDATION_SUMMARY_REPORT.md`](VALIDATION_SUMMARY_REPORT.md) to
   establish what the vendor has and has not qualified. Do not assume the
   presence of a validation package means the system is validated for your use.
2. Read `VALIDATION_PLAN.md` end-to-end and adapt it to your organization's QMS.
3. Review `RISK_REGISTER.md`, `FMEA.md` and `RESIDUAL_RISK.md`, and add
   organization-specific risks. Each residual-risk entry names the party who
   must accept it; several are yours, not the vendor's.
4. Execute `templates/IQ_PROTOCOL_TEMPLATE.md` on each install. The vendor's
   `executed/IQ_TT-IQ-001.md` records which steps it could evidence and which it
   explicitly could not — the latter are yours to execute.
5. Execute `templates/OQ_PROTOCOL_TEMPLATE.md` after the IQ passes. The vendor's
   `executed/OQ_TT-OQ-001.md` may be cited as supporting evidence for the
   automated portion; the interactive portion is yours.
6. Execute `executed/PQ_TT-PQ-001.md` with your real clinical workflow and
   clinical users. No vendor evidence exists for this stage.
7. Use `VALIDATION_SUMMARY_REPORT_TEMPLATE.md` as your signed cover document.
8. Map your local SOPs to `HIPAA_SECURITY_RULE_MAPPING.md` and
   `PART_11_CONTROL_MAPPING.md`, noting the stated Part 11 gaps.

## How to read this package critically

A validation package is easy to fake and hard to falsify, so it is worth knowing
where this one is load-bearing and where it is not.

Machine-verified: `scripts/check-compliance-docs.mjs` runs in the standard test
suite and fails the build on a duplicate requirement id, an untraced
requirement, or a dangling SDS, OQ or risk reference. It does not verify that
cited test files exist, so those citations were audited by hand for this release
(finding I-7) and corrected where they pointed at files that had been renamed or
never existed.

Visible rather than inferred: requirements that are *not* implemented are listed
in the traceability matrix with their status rather than omitted, and residual
risks are stated as formal accepted risks rather than left as silence.

Honestly bounded: the executed protocols in `executed/` record a vendor-side
verification run on Linux with Node 22, with no PostgreSQL server, no Windows or
macOS host, no signed installer and no clinical users. Every step that could not
be executed in that environment is marked NOT EXECUTED, with the reason and the
party who must execute it. Read those markings before relying on the package.

## Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.x | — | Prior revisions of the index. | Quality Assurance Officer |
| 2.0 | 2026-08-02 | Indexed the executed validation package for release 1.3.0 (`VALIDATION_SUMMARY_REPORT.md`, `executed/`, `FMEA.md`, `RESIDUAL_RISK.md`) created in response to finding C-2. Withdrew the unsupported AATB conformance claim (M-17 item 3). Added an explicit server-tier early-access statement, which the validation report noted was absent from the compliance documentation (M-17 item 12). Recorded the `check-compliance-docs.mjs` limitation found as I-7. Added document control header. | Quality Assurance Officer |
