# Test and Demonstration Data Provenance

| Document ID | TT-TDP-001 |
| --- | --- |
| Version | 1.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Privacy Officer |

## Statement

**No file tracked in this repository contains real protected health
information.** Every patient-shaped record in the repository is either
synthetic data authored for this project or a record drawn from a vendor
sandbox that is itself populated with fabricated patients.

This document exists so that the fact is evidenced rather than merely true.
Finding I-8 of the validation review observed that the repository's sample and
demonstration data appeared appropriately fictional but that nothing recorded
their provenance, which leaves a reviewer to infer it from the data. Inference
is not evidence.

## Inventory

| Location | What it is | Provenance | Contains real PHI |
|---|---|---|---|
| `sample-data/epic-fhir-bundle-demo.json` | A 43-entry FHIR R4 collection Bundle — 5 Patients, 19 Observations, 8 Conditions, 11 MedicationStatements | Authored for this project as an Epic-shaped import fixture. The `meta.source` field reads `Epic EHR - Demo Transplant Center`, which is a label, not a real organization. Patient identities (`Rodriguez, Maria Elena`; `Thompson, James Robert`; `Chen, Wei`; `Okonkwo, Adaeze`; `Petrov, Dmitri`) and MRNs (`MRN-2026-10001` through `-10005`) were invented. The identifier system OID is Epic's published sandbox namespace. | No |
| `demo-evidence/epic-roundtrip-20260426-193254.txt` | Console transcript of a SMART Backend Services round-trip against Epic's public sandbox | Captured from `https://fhir.epic.com/interconnect-fhir-oauth`. The subject is `erXuFYUfucBZaryVksYEcMg3` — "Camila Maria Lopez", Epic's publicly documented sandbox test patient, used by every developer who integrates with Epic. The clinical values in the transcript (HbA1c 5.1, platelets 322, a PCOS problem-list entry) are Epic's sandbox fixtures. | No |
| `docs/compliance/pilot-site-example/` | A worked example of an executed validation package | Explicitly labelled fictional in its own disclaimer banner. The site, the personnel and the findings are illustrative. | No |
| `tests/**` fixtures | Patients, donors, organs and HL7 messages constructed inside the test suites | Constructed in code at test time; no fixture file is derived from a clinical source. | No |
| `electron/services/calculators/reference/*.json` | OPTN coefficient and percentile tables (`optn-epts.json`, `optn-kdpi.json`, `optn-peld.json`) | Public OPTN policy sources, registered in [`compliance/CLINICAL_SOURCES.md`](compliance/CLINICAL_SOURCES.md). Population-level constants; contains no patient data of any kind. | No |

## Why the Epic sandbox records are not PHI

Epic's `fhir.epic.com` sandbox is a public developer environment. Its patient
records — Camila Lopez, Nancy Smart, Jason Argonaut and the rest of the set —
are fabricated by Epic and published for integration testing. They correspond
to no living or deceased individual, they are not sourced from any covered
entity's records, and access to them requires no Business Associate Agreement.
Reproducing a sandbox transcript in this repository therefore discloses
nothing.

This does **not** extend to any Epic *production* environment. A transcript
captured against a customer's live Epic instance would contain PHI and must
never be committed. The gate is the FHIR base URL: `fhir.epic.com` is the
sandbox; anything else is presumed production.

## Rules for contributors

1. **Never commit a record derived from a real patient**, in any form —
   database file, export, log excerpt, screenshot, HL7 message, FHIR bundle,
   support bundle, or crash dump. This holds even if the record is
   de-identified, because de-identification under 45 CFR §164.514 is a formal
   determination and not something to improvise in a pull request.
2. **Never commit a transcript from a production EHR**, including one where
   the patient data has been manually redacted. Redaction of a transcript is
   not reliable; regenerate it against the sandbox instead.
3. **Synthetic records must be obviously synthetic.** Use MRNs in a reserved
   pattern (`MRN-YYYY-NNNNN`), and do not reuse a name, date of birth and MRN
   combination that could coincide with a real person at a deploying site.
4. **Record the provenance of any new fixture here.** A fixture directory that
   is not listed in the inventory above has no evidenced provenance, which is
   the condition this document exists to prevent.
5. When a security report or a bug reproduction appears to require real data,
   say so in the report rather than attaching it, and arrange a controlled
   channel — see [`../SECURITY.md`](../SECURITY.md#what-to-include).

## Verification

The repository is scanned for PHI-shaped content by `tests/phiLeakage.test.cjs`
and `tests/loggerRedaction.test.cjs`, which verify that the application does
not emit patient identifiers into logs, support bundles or forwarded events.
Those tests constrain the running application; they do not, and cannot, prove
the absence of real PHI in a committed fixture. That assurance rests on the
inventory above and on the contributor rules, both of which are reviewable
statements rather than automated checks.

## Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.0 | 2026-08-02 | Initial issue, in response to validation finding I-8. | Privacy Officer |
