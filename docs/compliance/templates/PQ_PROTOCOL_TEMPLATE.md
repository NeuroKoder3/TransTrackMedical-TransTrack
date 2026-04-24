# PQ Protocol — TransTrack Performance Qualification

| Document control | |
|---|---|
| Document ID | TT-PQ-_____ |
| Software version | vX.Y.Z |
| Executed by | _____ (clinical user) |
| Reviewed by | _____ (QA) |
| Date executed | _____ |

## Purpose

Verify TransTrack performs as intended in the customer's actual clinical-coordination
workflow with representative volumes and representative users. PQ is executed in a
**non-PHI test environment** populated with synthetic patients that approximate
the live workload.

## Pre-conditions

* IQ and OQ protocols executed and PASS.
* Test environment loaded with at least 1 000 synthetic patients across
  organ types appropriate for the program (e.g., 600 kidney, 200 liver,
  100 lung, 50 heart, 50 pancreas).
* Three representative end users are available: 1 admin, 1 coordinator, 1 viewer.

## Workflow scenarios

| ID | Scenario | Acceptance | Pass/Fail | Notes |
|---|---|---|---|---|
| PQ-01 | Admit a new patient end-to-end (intake → barriers → labs → AHHQ → priority score). | <5 min, no errors. | | |
| PQ-02 | Receive a sample HL7 v2 ADT^A01 message and confirm patient appears within 60 seconds. | <60 s. | | |
| PQ-03 | Coordinator opens patient list. | First page renders ≤2 s for 1 000 patients. | | |
| PQ-04 | Coordinator handles a simulated organ offer cycle (offer → accept). | Audit row + state transition correct. | | |
| PQ-05 | Coordinator handles a simulated decline with reason code. | Reason recorded; backup recipient notified. | | |
| PQ-06 | Post-transplant: record transplant event, immunosuppression regimen, follow-up labs. | All recorded; tasks generated. | | |
| PQ-07 | Living-donor evaluation: complete each step; verify 6/12/24-month follow-up tasks. | Tasks generated at correct intervals. | | |
| PQ-08 | Generate monthly admin audit report scoped to one coordinator. | Report opens ≤10 s; contains expected rows. | | |
| PQ-09 | Backup, then simulate disaster: restore on a second host. | Restore completes ≤30 min for 100 000 records; data integrity preserved. | | |
| PQ-10 | SIEM forwarder destination outage: events queued and replayed when destination returns. | No event loss within queue capacity. | | |
| PQ-11 | Run end-to-end smoke for 4 hours under coordinator user load. | No memory leaks; no untrapped errors. | | |
| PQ-12 | Validate "operational not allocative" labels visible on every score-bearing screen. | All present. | | |

## Acceptance

* All Mandatory PQ scenarios PASS.
* Performance targets met (TT-R080 to TT-R083).
* No Severity 1 or 2 defects open.

| Role | Signature | Date |
|---|---|---|
| Executor | | |
| QA Reviewer | | |
| Transplant Administrator | | |
