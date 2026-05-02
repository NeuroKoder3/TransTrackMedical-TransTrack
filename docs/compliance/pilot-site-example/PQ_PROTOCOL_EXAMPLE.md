# PQ Protocol — TransTrack Performance Qualification (Worked Example)

> ## ⚠ DEMONSTRATION ONLY — NOT A REAL VALIDATION RECORD
>
> "Northshore Regional Transplant Center" is a **fictional** organization.
> All test results, throughput numbers, and signatures below are
> **synthetic** demonstration data. See [`README.md`](README.md). Real
> pilot sites should execute against the empty template at
> [`../templates/PQ_PROTOCOL_TEMPLATE.md`](../templates/PQ_PROTOCOL_TEMPLATE.md).

---

| Document control | |
|---|---|
| Document ID | TT-PQ-NRTC-001 (example) |
| Software version | **v1.2.0** (build `e1436e2`) |
| Executed by | _Sarah Chen, RN — Validation Lead_ + _Coordinators K. Adeyemi & L. Hernandez_ *(role-title placeholders)* |
| Reviewed by | _Marcus Johnson, MS — QA Officer_ *(role-title placeholder)* |
| Date executed | 2026-06-25 *(example)* |

## Purpose

Verify TransTrack v1.2.0 performs as intended in NRTC's actual
clinical-coordination workflow with representative volumes and
representative users. PQ executed in the **non-PHI test environment**
populated with synthetic patients approximating the live workload.

## Pre-conditions

- IQ ([`IQ_PROTOCOL_EXAMPLE.md`](IQ_PROTOCOL_EXAMPLE.md)) and OQ
  ([`OQ_PROTOCOL_EXAMPLE.md`](OQ_PROTOCOL_EXAMPLE.md)) executed and PASS.
- Test environment loaded with **1 042 synthetic patients**:
  - 612 kidney
  - 198 liver
  - 92 lung
  - 78 heart
  - 62 pancreas
- Three representative end users available:
  - 1 admin (`Sarah Chen, RN`)
  - 1 coordinator (`K. Adeyemi`)
  - 1 viewer (`Dr. R. Whitfield`)

## Workflow scenarios (executed)

| ID | Scenario | Acceptance | Pass/Fail | Notes |
|---|---|---|---|---|
| PQ-01 | Admit a new patient end-to-end (intake → barriers → labs → AHHQ → priority score). | <5 min, no errors. | **PASS** | 4 m 12 s end-to-end (synthetic patient `MRN-NRTC-PQ-001`); no errors. |
| PQ-02 | Receive a sample HL7 v2 ADT^A01 message and confirm patient appears within 60 seconds. | <60 s. | **PASS** | Patient appeared 3 s after MLLP send; MRN+DOB matching worked. |
| PQ-03 | Coordinator opens patient list. | First page renders ≤2 s for 1 000+ patients. | **PASS** | First-page render 0.84 s (1 042 patients, 50/page). |
| PQ-04 | Coordinator handles a simulated organ offer cycle (offer → accept). | Audit row + state transition correct. | **PASS** | Transition PENDING→ACCEPTED_PROVISIONAL→ACCEPTED_FINAL audited. |
| PQ-05 | Coordinator handles a simulated decline with reason code. | Reason recorded; backup recipient notified. | **PASS** | Decline reason `MEDICAL_CONDITION_INCOMPATIBLE` recorded; in-app notification raised to next match candidate. |
| PQ-06 | Post-transplant: record transplant event, immunosuppression regimen, follow-up labs. | All recorded; tasks generated. | **PASS** | 3 events, 1 immuno regimen, 4 labs, 2 follow-up tasks generated. |
| PQ-07 | Living-donor evaluation: complete each step; verify 6/12/24-month follow-up tasks. | Tasks generated at correct intervals. | **PASS** | Tasks generated at exactly +6, +12, +24 months from transplant date. |
| PQ-08 | Generate monthly admin audit report scoped to one coordinator. | Report opens ≤10 s; contains expected rows. | **PASS** | 30-day audit report for `K. Adeyemi`: 1 423 rows, render 4.2 s. |
| PQ-09 | Backup, then simulate disaster: restore on a second host. | Restore completes ≤30 min for 100 000 records; data integrity preserved. | **PASS** | 3 successful backup→verify→restore cycles on a second NRTC workstation (`NRTC-TX-WS02`); restore for 1 042-patient dataset completed in 1 m 46 s; row count and integrity hash matched. |
| PQ-10 | SIEM forwarder destination outage: events queued and replayed when destination returns. | No event loss within queue capacity. | **PASS** | Simulated 10-min `siem.nrtc.local` outage: 87 events queued; on recovery, all 87 replayed in CEF. |
| PQ-11 | Run end-to-end smoke for 4 hours under coordinator user load. | No memory leaks; no untrapped errors. | **PASS** | 4 h 02 min synthetic workload by 2 coordinators; renderer process RSS stayed at 312 MB → 318 MB (no leak); 0 untrapped errors in `transtrack.log`. |
| PQ-12 | Validate "operational not allocative" labels visible on every score-bearing screen. | All present. | **PASS** | All 6 score-bearing screens (Dashboard, Patient Detail, Priority Breakdown, Risk Engine, Match Simulator, OPTN Export) carry the disclaimer. |

## Acceptance

* All Mandatory PQ scenarios PASS.
* Performance targets met (TT-R080 to TT-R083 of
  `docs/compliance/SYSTEM_REQUIREMENTS_SPECIFICATION.md`).
* No Severity 1 or 2 defects open.

**Result: 12/12 PASS. PQ accepted.**

| Role | Name (placeholder) | Signature | Date |
|---|---|---|---|
| Executor | _Sarah Chen, RN_ + _K. Adeyemi_ + _L. Hernandez_ | _signed_ | 2026-06-25 |
| QA Reviewer | _Marcus Johnson, MS_ | _signed_ | 2026-06-29 |
| Transplant Administrator | _Dr. R. Whitfield_ | _signed_ | 2026-06-30 |

---

> *End-of-document reminder:* the patient counts, throughput numbers,
> signatures, and host identifiers above are demonstration data.
