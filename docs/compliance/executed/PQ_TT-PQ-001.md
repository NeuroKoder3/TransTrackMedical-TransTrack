# Performance Qualification — NOT EXECUTED BY THE VENDOR

| Document ID | TT-PQ-001 |
| --- | --- |
| Version | 1.0 |
| Status | **NOT EXECUTED** — issued as a ready-to-execute protocol for the deploying organization |
| Software version | TransTrack 1.3.0 |
| Date issued | 2026-08-02 |
| Issued by role | Quality Assurance Officer |
| Date executed | **Not executed. No date.** |
| Executed by | **Not executed. No executor.** |
| Governing plan | [`../VALIDATION_PLAN.md`](../VALIDATION_PLAN.md) v2.0 |
| Related | [`IQ_TT-IQ-001.md`](IQ_TT-IQ-001.md), [`OQ_TT-OQ-001.md`](OQ_TT-OQ-001.md), [`../VALIDATION_SUMMARY_REPORT.md`](../VALIDATION_SUMMARY_REPORT.md) |

> # NOT EXECUTED
>
> **No Performance Qualification has been executed for TransTrack 1.3.0, by
> the vendor or by anyone else.** Every result cell in this document is empty
> because no scenario has been run. Nothing in this document should be read as
> evidence of performance.
>
> PQ demonstrates that the system performs its intended function, in the
> intended environment, with the intended users, at representative volumes.
> The vendor has none of those three things:
>
> | PQ requires | Vendor position |
> |---|---|
> | Real clinical coordinators executing their own workflow | The vendor has no clinical users. |
> | A representative candidate population | The vendor holds synthetic records only. See [`TEST_DATA_PROVENANCE.md`](../../TEST_DATA_PROVENANCE.md). |
> | The site's hosts, identity provider, network, SIEM and (if used) PostgreSQL | The vendor has none of these. |
>
> A vendor-executed PQ against invented users and an invented workflow would
> be fabricated evidence. This document is therefore issued as a **protocol**:
> the deploying organization executes it, records its results in the cells
> below, and signs §8.
>
> **Performance Qualification is the deploying organization's
> responsibility.** Recorded as
> [RR-05](../RESIDUAL_RISK.md#rr-05--performance-qualification-has-not-been-executed).

## 1. Purpose

Verify that TransTrack 1.3.0 performs as intended in the deploying
organization's actual clinical-coordination workflow, with representative data
volumes, representative users, and the organization's own infrastructure.

Where Operational Qualification asks "does each function behave as specified?",
Performance Qualification asks "does the assembled system do the job the
organization bought it to do, in the place it will do it?" A system can pass
every OQ case and fail PQ — because the patient list is too slow at the site's
real volume, because the coordinator's workflow needs a step the software does
not support, or because the risk scores turn out to be uninformative for that
centre's population.

## 2. Scope

In scope: the assembled TransTrack deployment as configured for production,
exercised by the organization's own staff against a representative synthetic
population in a non-PHI test environment.

Explicitly in scope for this release, because they cannot be closed anywhere
else:

* **Calibration of the inactivation risk engine** against the site's observed
  outcomes ([RR-02](../RESIDUAL_RISK.md#rr-02--the-inactivation-risk-engine-is-not-clinically-validated),
  FMEA action A-04).
* **Training on the distinction between the TransTrack Lung Triage Index and
  the OPTN Lung Allocation Score** ([RR-07](../RESIDUAL_RISK.md#rr-07--the-lung-triage-index-is-an-internal-instrument),
  FMEA action A-03).
* **Confirmation that PELD is unavailable** and that coordinators know where
  to obtain it ([RR-01](../RESIDUAL_RISK.md#rr-01--peld-is-not-computed)).
* **A restore drill**, which is the only way RR-11 and FMEA action A-02 close.

Out of scope: the host operating system, identity provider, network and SIEM,
which are validated by the organization's IT department under its own SOPs.

## 3. Pre-conditions

All must be true before any scenario is executed. Record the evidence
reference for each.

| # | Pre-condition | Evidence | Confirmed |
| --- | --- | --- | --- |
| P-1 | The vendor portion of IQ is reviewed and accepted ([`IQ_TT-IQ-001.md`](IQ_TT-IQ-001.md) §4). | | |
| P-2 | The host portion of IQ is executed and passing on every target host ([`IQ_TT-IQ-001.md`](IQ_TT-IQ-001.md) §5). | | |
| P-3 | The automated OQ record is reviewed and accepted ([`OQ_TT-OQ-001.md`](OQ_TT-OQ-001.md)). | | |
| P-4 | The interactive OQ ([`../templates/OQ_PROTOCOL_TEMPLATE.md`](../templates/OQ_PROTOCOL_TEMPLATE.md)) is executed with 100% of Mandatory cases passing. | | |
| P-5 | The test environment is loaded with at least 1 000 **synthetic** candidates distributed across the organ types the program serves (for a mixed programme, approximately 600 kidney, 200 liver, 100 lung, 50 heart, 50 pancreas). No production PHI is used. | | |
| P-6 | At least three representative end users are available: one administrator, one coordinator, one viewer. Named by role in the execution record; individual names are recorded in the organization's own training log, not in this document. | | |
| P-7 | [`../RESIDUAL_RISK.md`](../RESIDUAL_RISK.md) has been read by the Customer Quality Assurance Officer, and every entry whose closure owner is the deploying organization has an owner assigned at the site. | | |
| P-8 | **Server tier only.** IQ steps IQ-S15 and IQ-S16 are executed and passing, so row-level security is known to be enforced rather than inert. | | |

## 4. Execution record — workflow scenarios

Result key: **PASS**, **FAIL**, or **N/A** with a stated reason. A blank cell
means the scenario was not executed. Do not mark a scenario N/A without a
reason; do not leave a cell blank in a submitted record.

| ID | Scenario | Acceptance criterion | Result | Measured value | Notes |
| --- | --- | --- | --- | --- | --- |
| PQ-01 | Admit a new candidate end to end: intake → readiness barriers → labs → aHHQ → priority score. | Completed in under 5 minutes by a coordinator, with no errors and no data re-entry. | | | |
| PQ-02 | Receive a sample HL7 v2 ADT^A01 from the site's interface engine and confirm the candidate appears. | Under 60 seconds from message acceptance to visibility. | | | |
| PQ-03 | Coordinator opens the patient list at the site's full test volume. | First page renders in ≤2 s for 1 000 candidates on the reference workstation (TT-R080). | | | |
| PQ-04 | Coordinator handles a simulated organ offer cycle through to acceptance. | State transition and audit row are both correct; the decline-reason field is not required on an acceptance path. | | | |
| PQ-05 | Coordinator handles a simulated decline with a structured reason code. | Reason recorded; the backup recipient path behaves as the site expects. | | | |
| PQ-06 | Post-transplant: record a transplant event, an immunosuppression regimen and follow-up labs. | All recorded; follow-up tasks generated at the configured intervals. | | | |
| PQ-07 | Living-donor evaluation: complete each milestone and confirm 6/12/24-month follow-up tasks appear. | Tasks generated at the correct intervals per OPTN Policy 14. | | | |
| PQ-08 | Generate a monthly administrator audit report scoped to one coordinator. | Report opens in ≤10 s and contains exactly the expected rows for the period. | | | |
| PQ-09 | Back up, then simulate a disaster and restore onto a second host. | Restore completes in ≤30 minutes for 100 000 records (TT-R083); integrity check passes; a known sample of candidates is present and unmodified. | | | |
| PQ-10 | Take the SIEM destination offline during activity, then restore it. | Events queue and replay with no loss within queue capacity. | | | |
| PQ-11 | Run a 4-hour session under representative coordinator load. | No memory growth trend; no untrapped errors in the log. | | | |
| PQ-12 | Walk every screen that displays a score. | The "operational, not allocative" label is present and legible on each. | | | |

## 5. Execution record — residual-risk closure scenarios

These scenarios exist to close specific entries in
[`../RESIDUAL_RISK.md`](../RESIDUAL_RISK.md). They are **Mandatory**. A PQ that
omits them leaves the corresponding risk open regardless of how the scenarios
in §4 turn out.

| ID | Scenario | Acceptance criterion | Closes | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| PQ-20 | Run the inactivation risk engine in shadow mode and collect observed inactivation outcomes for at least four quarters. | Predicted-versus-observed calibration computed by decile and recorded. | RR-02 step 2 | | |
| PQ-21 | Re-derive or explicitly accept the engine's factor weights and probability curves in light of PQ-20. | Decision recorded in the site configuration change log with the approving role. | RR-02 steps 3–4 | | |
| PQ-22 | Train coordinators on the distinction between the TransTrack Lung Triage Index and the OPTN Lung Allocation Score / Composite Allocation Score. | Every coordinator's training record names the instrument by its full name and states the prohibited uses. Verified by spot check: ask a coordinator what the lung figure on screen is. | RR-07 (reduction) | | |
| PQ-23 | Confirm that where the centre holds a real LAS or CAS from UNet, it is entered into `patient.las_score` and displayed unambiguously alongside the TTLI. | No screen presents the two values in a way that invites confusion. | RR-07 (reduction) | | |
| PQ-24 | Confirm with a pediatric liver coordinator that PELD is reported as unavailable, and that the coordinator knows to obtain it from the OPTN calculator. | The unavailability reason is visible at the point of use; the alternative source is known. | RR-01 (site awareness) | | |
| PQ-25 | Execute a file-restore drill on a non-production host using the procedure and log template in [`RUNBOOK.md`](../../../RUNBOOK.md#5-disaster-recovery-drill) §5. | Measured recovery time and recovery point are within the objectives in `docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md` §1. Gaps recorded and either remediated or accepted in writing. | RR-11, FMEA A-02 | | |
| PQ-26 | Record which optional egress paths are enabled (remote log sink, SIEM forwarder, auto-update, server tier) and confirm a BAA or a documented no-PHI determination exists for each. | One determination per enabled path, with the approving role. | RR-12 | | |
| PQ-27 | **Server tier only.** Execute a cross-tenant negative test against the live database: a query issued for tenant A against a row belonging to tenant B returns no rows, both with the tenant GUC set and with it unset. | No rows returned in either case. | RR-04, FMEA A-05 | | |
| PQ-28 | Confirm full-disk encryption is enabled and centrally attested on every host, and that the host decommissioning procedure follows NIST SP 800-88. | Attestation export per host; decommissioning procedure referenced. | RR-08, FMEA A-01 | | |

## 6. Acceptance criteria

PQ is accepted when **all** of the following hold:

1. Every pre-condition in §3 is confirmed.
2. All Mandatory scenarios in §4 pass. Performance targets TT-R080 to TT-R083
   are met with the measured values recorded, not merely asserted.
3. All scenarios in §5 pass, or are marked N/A with a stated reason that the
   Customer Quality Assurance Officer accepts in writing.
4. No Severity 1 or Severity 2 defect is open, per the scale in
   [`../RISK_REGISTER.md`](../RISK_REGISTER.md).
5. Every deviation is recorded in §7 with a disposition.

## 7. Deviations

| ID | Scenario | Deviation observed | Severity | Root cause | Corrective action | Re-test result | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

_No rows. No scenario has been executed._

## 8. Signature block

Signatures are applied by the deploying organization after execution. **The
vendor does not sign this document**, because the vendor did not execute it.

| Role | Party | Scope of signature | Signature | Date |
| --- | --- | --- | --- | --- |
| Customer Transplant Administrator | Customer | §4 scenarios executed as recorded | _pending site execution_ | _pending site execution_ |
| Customer Quality Assurance Officer | Customer | §5, §6 and §7 reviewed; PQ accepted | _pending site execution_ | _pending site execution_ |
| Customer IT / Security | Customer | PQ-09, PQ-25, PQ-26, PQ-27, PQ-28 executed | _pending site execution_ | _pending site execution_ |
| Clinical Informatics or equivalent site role | Customer | PQ-20 to PQ-24 executed and accepted | _pending site execution_ | _pending site execution_ |

## 9. Change history

| Version | Date | Change | Author role |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Initial issue as a ready-to-execute protocol, marked NOT EXECUTED. Created in response to validation finding C-2(b). Adds §5, the residual-risk closure scenarios, which the previous PQ template did not contain. | Quality Assurance Officer |
