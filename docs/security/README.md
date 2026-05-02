# TransTrack — Security Engagement Index

This directory holds the artifacts that make a third-party penetration test
**executable as procurement work** rather than as a research project.

> **Status (2026-05-01) — NO INDEPENDENT PENETRATION TEST HAS BEEN EXECUTED.**
>
> The artifacts in this directory are **scope, vendor selection, remediation
> tracking, and publication templates**. They are deliberately *not* findings.
> No engagement is currently in flight. When a real engagement runs against a
> specific build, the templates here are the input/output forms; the
> populated, signed deliverables become the historical record at
> `docs/security/engagements/YYYY-MM-vendor/`.
>
> See `PENETRATION_TEST_SUMMARY_TEMPLATE.md` for the publication shape and
> `PENETRATION_TEST_SCOPE.md` for the definitive Statement of Work.

## Files in this directory

| File | Purpose | State |
|---|---|---|
| [`PENETRATION_TEST_SCOPE.md`](PENETRATION_TEST_SCOPE.md) | Statement of Work / scope of engagement. Hand to a CREST/OSCP/CEH-credentialed firm to fixed-price the test. | Ready to send |
| [`PENTEST_VENDOR_CHECKLIST.md`](PENTEST_VENDOR_CHECKLIST.md) | Vendor selection criteria, shortlist template, and reference-check questions. | Ready to use |
| [`PENTEST_REMEDIATION_TRACKER.md`](PENTEST_REMEDIATION_TRACKER.md) | Severity-driven remediation tracker with SLAs aligned to `SECURITY.md`. | Ready to use; fill as findings arrive |
| [`PENETRATION_TEST_SUMMARY_TEMPLATE.md`](PENETRATION_TEST_SUMMARY_TEMPLATE.md) | The public, customer-facing summary published after each engagement. | Template — no engagement to publish |

## How this connects to the production-readiness gate

The April-2026 project evaluation report (B4) identified a third-party
penetration test as a **mandatory item before broad commercial release**. It is
*not* mandatory for a supervised pilot under a signed BAA. The flow is:

```
   Vendor selection (PENTEST_VENDOR_CHECKLIST)
            │
            ▼
   Engagement contracted against PENETRATION_TEST_SCOPE
            │
            ▼
   Test executed against a tagged build (Win .exe + Fastify server tier)
            │
            ▼
   Findings tracked in PENTEST_REMEDIATION_TRACKER
            │
            ▼
   When all Critical/High closed → publish PENETRATION_TEST_SUMMARY
            │
            ▼
   Release-readiness gate flips this item from "pending" to "executed".
```

## Honesty rule

No findings, severities, vendor names, dates, or signatures may be added to
the publication template without a corresponding signed deliverable from a
real engagement on file. **Do not populate the summary template with sample
data.** The empty template is the truth; a populated template is a contract.
