# WITHDRAWN — TransTrack Formal Validation Artifacts

| Document ID | TT-VAL-001 |
| --- | --- |
| Version | 2.0 (withdrawal notice) |
| Status | **Withdrawn and superseded** |
| Withdrawn on | 2026-08-02 |
| Superseded by | [`docs/compliance/`](compliance/) — see the index below |
| Owner | Quality Assurance Officer |

## This document no longer contains a validation package

Every clause of TT-VAL-001 v1.0.1 is withdrawn. Nothing in the prior content
may be cited as evidence of validation, and the content has been removed
rather than left in place with a banner, so that it cannot be quoted out of
context.

## Why it was withdrawn

The document described itself as "formal validation artifacts" for TransTrack
v1.0.0. It contained a 19-case IQ/OQ/PQ/SEC protocol whose entire results
column was blank, a test execution summary table with no numbers in it, a
conclusion reading "[To be completed after validation execution]", and an
unsigned approval block. It also asserted compliance with AATB Standards for
Tissue Banking, for which no control mapping has ever existed in this
repository.

More seriously, it was a **second** validation package. `docs/compliance/`
already held a validation plan, protocol templates, a traceability matrix and
a risk register, at a different version, for a different release, with
different case identifiers. A reader could not tell which package governed,
and neither package had been executed.

A validation review recorded this as finding C-2. The remedy is one package,
at one vintage, with real execution records — not two.

## Where the current package is

| Document | Purpose |
| --- | --- |
| [`compliance/VALIDATION_PLAN.md`](compliance/VALIDATION_PLAN.md) | The governing plan. Ratified, effective 2026-08-02, scoped to release 1.3.0. |
| [`compliance/VALIDATION_SUMMARY_REPORT.md`](compliance/VALIDATION_SUMMARY_REPORT.md) | **Start here.** States which qualification stages are complete and which are not. |
| [`compliance/executed/IQ_TT-IQ-001.md`](compliance/executed/IQ_TT-IQ-001.md) | Executed Installation Qualification — vendor portion complete, host portion enumerated as not executed. |
| [`compliance/executed/OQ_TT-OQ-001.md`](compliance/executed/OQ_TT-OQ-001.md) | Executed Operational Qualification — the automated verification that actually ran, every case citing a test file that exists. |
| [`compliance/executed/PQ_TT-PQ-001.md`](compliance/executed/PQ_TT-PQ-001.md) | Performance Qualification protocol — **not executed**; the deploying organization's responsibility. |
| [`compliance/FMEA.md`](compliance/FMEA.md) | Failure mode and effects analysis. |
| [`compliance/RESIDUAL_RISK.md`](compliance/RESIDUAL_RISK.md) | Formal residual-risk statements with closure criteria. |
| [`compliance/RISK_REGISTER.md`](compliance/RISK_REGISTER.md) | ISO 14971-style hazard register. |
| [`compliance/TRACEABILITY_MATRIX.md`](compliance/TRACEABILITY_MATRIX.md) | Requirement → design → implementation → verification. |
| [`compliance/CLINICAL_SOURCES.md`](compliance/CLINICAL_SOURCES.md) | Controlled source for every clinical constant. |
| [`compliance/README.md`](compliance/README.md) | Index of the whole package. |

## What replaced each withdrawn section

| Withdrawn section | Replacement |
| --- | --- |
| §3 Validation Plan | `compliance/VALIDATION_PLAN.md` v2.0 |
| §4 Installation Qualification (IQ-001 to IQ-003) | `compliance/executed/IQ_TT-IQ-001.md`; site protocol at `compliance/templates/IQ_PROTOCOL_TEMPLATE.md` |
| §5 Operational Qualification (OQ-001 to OQ-009) | `compliance/executed/OQ_TT-OQ-001.md`; site protocol at `compliance/templates/OQ_PROTOCOL_TEMPLATE.md` |
| §6 Performance Qualification (PQ-001 to PQ-003) | `compliance/executed/PQ_TT-PQ-001.md` |
| §7 Security Validation (SEC-001 to SEC-004) | Folded into the executed OQ: SEC-001 → OQ-A01, SEC-002 → OQ-A40, SEC-003 → OQ-A23, SEC-004 → OQ-A05 and OQ-A06 |
| §8 Traceability Matrix | `compliance/TRACEABILITY_MATRIX.md`, machine-checked by `scripts/check-compliance-docs.mjs` |
| §9 Deviation Handling | `compliance/VALIDATION_SUMMARY_REPORT.md` §5 and `compliance/policies/CHANGE_MANAGEMENT_SOP.md` |
| §10 Validation Summary | `compliance/VALIDATION_SUMMARY_REPORT.md` |
| AATB compliance claim (§1.1, §1.3) | **Removed, not replaced.** No AATB control mapping exists in this repository and none is asserted. |
| Appendix B System Requirements | `compliance/templates/IQ_PROTOCOL_TEMPLATE.md`, "Reference workstation specification" |

## Retention

The withdrawn content remains available in this repository's version control
history for anyone who needs to audit what was previously published. It is not
reproduced here, because a withdrawn validation document that still reads like
a validation document is the problem this notice exists to solve.
