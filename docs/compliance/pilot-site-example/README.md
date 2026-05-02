# Pilot Site Validation — Worked Demonstration

> ## ⚠ DEMONSTRATION ONLY — NOT A REAL VALIDATION RECORD
>
> Every document in this directory is a **populated worked example** of the
> validation artifacts a real pilot site would produce. The "Northshore
> Regional Transplant Center" referenced throughout is **a fictional
> organization that does not exist**. All patient counts, throughput
> numbers, defect counts, and signatures are **synthetic** and labelled as
> such. The names of human signatories are generic role-titles, not real
> people.
>
> **Do not redistribute the contents of this directory as evidence of a
> real TransTrack validation. Doing so would misrepresent the regulatory
> status of the product.**
>
> The purpose is the same purpose served by the Validation Summary Report
> *template* in `../VALIDATION_SUMMARY_REPORT_TEMPLATE.md`: to give a real
> deploying organization a fully-fleshed-out walkthrough of what an
> executed package looks like end-to-end. A real pilot site replaces the
> "Northshore Regional" data with their own.

## What's in here

| File | Purpose |
|---|---|
| [`VALIDATION_SUMMARY_REPORT_EXAMPLE.md`](VALIDATION_SUMMARY_REPORT_EXAMPLE.md) | The signed top-level VSR — the one-page document the QA Officer signs. |
| [`IQ_PROTOCOL_EXAMPLE.md`](IQ_PROTOCOL_EXAMPLE.md) | The executed Installation Qualification with each test case marked PASS / FAIL and an evidence column. |
| [`OQ_PROTOCOL_EXAMPLE.md`](OQ_PROTOCOL_EXAMPLE.md) | The executed Operational Qualification with each test case marked PASS / FAIL and an evidence column. |
| [`PQ_PROTOCOL_EXAMPLE.md`](PQ_PROTOCOL_EXAMPLE.md) | The executed Performance Qualification with each scenario marked PASS / FAIL and an evidence column. |

## Relationship to the templates

| Template (under `../`) | Worked example (here) |
|---|---|
| [`VALIDATION_SUMMARY_REPORT_TEMPLATE.md`](../VALIDATION_SUMMARY_REPORT_TEMPLATE.md) | [`VALIDATION_SUMMARY_REPORT_EXAMPLE.md`](VALIDATION_SUMMARY_REPORT_EXAMPLE.md) |
| [`templates/IQ_PROTOCOL_TEMPLATE.md`](../templates/IQ_PROTOCOL_TEMPLATE.md) | [`IQ_PROTOCOL_EXAMPLE.md`](IQ_PROTOCOL_EXAMPLE.md) |
| [`templates/OQ_PROTOCOL_TEMPLATE.md`](../templates/OQ_PROTOCOL_TEMPLATE.md) | [`OQ_PROTOCOL_EXAMPLE.md`](OQ_PROTOCOL_EXAMPLE.md) |
| [`templates/PQ_PROTOCOL_TEMPLATE.md`](../templates/PQ_PROTOCOL_TEMPLATE.md) | [`PQ_PROTOCOL_EXAMPLE.md`](PQ_PROTOCOL_EXAMPLE.md) |

## How a real pilot site uses this

1. Read this directory front-to-back to see how the four documents
   compose into a coherent validation package.
2. For each artifact, copy the **template** (not the example) into the
   customer's document control system.
3. Execute the protocol against the customer's real environment, capture
   the same evidence categories shown in the example, and sign.
4. The VSR (signed) becomes the customer's authorization to use TransTrack
   in production at that site.

## Provenance

| Field | Value |
|---|---|
| Created on | 2026-05-01 |
| Created by | TransTrack engineering, as production-readiness blocker B5 from the project-evaluation report. |
| Status | Demonstration only — *no real validation has been executed by the open-source TransTrack project against any real pilot site at this date.* |
| Software version demonstrated against | v1.2.0 (commit `e1436e2`) |

When a real pilot validates against a future build, the resulting executed
package should be filed under
`docs/compliance/<customer>-<YYYYMM>-validation/` (or in the customer's
own document control system if the customer prefers their artifacts not be
public).
