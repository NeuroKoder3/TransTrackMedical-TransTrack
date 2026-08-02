# Controlled Clinical Source Register

| Document ID | TT-CSR-001 |
| --- | --- |
| Version | 1.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Clinical Informatics Lead |
| Review cadence | Annual, and within 30 days of any OPTN policy notice affecting an entry |

## 1. Purpose

Validation finding C-3 recorded that "there is no documented mapping from any
constant in these modules to a specific, dated revision of an authoritative
document". This register is that mapping.

Every clinical constant TransTrack computes with — coefficient, clamp, bound,
percentile table, scaling factor — is traceable to exactly one entry below.
Each entry names the controlled source, the revision consulted, the date it was
consulted, and where the constant is implemented.

Three rules govern this register:

1. **No unsourced clinical constant.** A calculator may not contain a numeric
   clinical constant that is not traceable to an entry here. The
   `tests/calculatorReferenceVectors.test.cjs` suite enforces this for the
   externally-owned tables.
2. **No silent staleness.** Every externally-owned table carries a `reviewBy`
   date in `electron/services/calculators/reference/*.json`. When that date
   passes, results are flagged `stale`, the health check degrades, and the
   build fails. See §4.
3. **No guessed constants.** Where a controlled source is not obtainable, the
   calculator returns no score. It never substitutes an approximation, a
   superseded revision, or a value from a secondary source. See RR-01 in
   [`RESIDUAL_RISK.md`](RESIDUAL_RISK.md).

## 2. Register

### SRC-OPTN-P9D — MELD, MELD-Na, MELD 3.0

| Field | Value |
| --- | --- |
| Source | OPTN Policy 9.1.D, *MELD Score*; policy notice "Improving Liver Allocation: MELD, PELD, Status 1A and Status 1B" |
| Revision | Policy notice dated 06/27/2022, in effect 2023-07-13 |
| URL | https://optn.transplant.hrsa.gov/media/3idbp5vq/policy-guid-change_impr-liv-alloc-meld-peld-sta-1a-sta-1b_liv.pdf |
| Supporting literature | Kamath PS et al. *Hepatology* 2001;33:464-470 (MELD); Kim WR et al. *Gastroenterology* 2021;161:1887-1895 (MELD 3.0); Chan/Hsu et al., "MELD 3.0 for adolescent liver transplant candidates", *Hepatology* 2023, Table 1 (adolescent variant) |
| Consulted | 2026-08-02 |
| Implemented in | `electron/services/calculators/meld.cjs` |
| Verified by | `tests/calculatorReferenceVectors.test.cjs` — MELD, MELD-Na and MELD 3.0 blocks |

Constants traced to this entry:

| Constant | Value | Policy text |
| --- | --- | --- |
| MELD(i) coefficients | 0.957 ln(Cr), 0.378 ln(bili), 1.120 ln(INR), +0.643 | §9.1.D |
| MELD lab floor | 1.0 | "Laboratory values less than 1.0 will be set to 1.0" |
| MELD creatinine cap | 4.0 mg/dL | ">4.0 mg/dL, ≥2 dialysis treatments or 24h CVVHD in prior 7 days → 4.0" |
| MELD-Na adjustment | +1.32(137−Na) − 0.033·MELD·(137−Na), applied above MELD 11 | §9.1.D |
| MELD 3.0 coefficients | 1.33 female, 4.56 ln(bili), 0.82(137−Na), −0.24(137−Na)ln(bili), 9.09 ln(INR), 11.14 ln(Cr), 1.85(3.5−alb), −1.83(3.5−alb)ln(Cr), +6 | §9.1.D |
| MELD 3.0 adolescent variant (12–17) | intercept 7.33, no sex term | *Hepatology* 2023 Table 1 |
| MELD 3.0 creatinine cap | 3.0 mg/dL (and on dialysis) | "lowering the maximum creatinine value from 4.0 to 3.0 mg/dL" |
| MELD 3.0 albumin bounds | 1.5–3.5 g/dL | "Albumin values less than 1.5 g/dL will be set to 1.5 g/dL, and values greater than 3.5 g/dL will be set to 3.5 g/dL" |
| Sodium bounds | 125–137 mmol/L | §9.1.D |
| Score bounds | 6–40, rounded to the nearest whole number | "The minimum MELD score is 6. The maximum MELD score is 40." |

### SRC-OPTN-P9E — PELD / PELD-Cr

| Field | Value |
| --- | --- |
| Source | OPTN Policy 9.1.E, *PELD Score*, Table 9-1 |
| Revision | Policy notice dated 06/27/2022, in effect 2023-07-13 |
| URL | https://optn.transplant.hrsa.gov/media/3idbp5vq/policy-guid-change_impr-liv-alloc-meld-peld-sta-1a-sta-1b_liv.pdf |
| Consulted | 2026-08-02 |
| Reference table | `electron/services/calculators/reference/optn-peld.json` |
| Status | **AWAITING_CONTROLLED_SOURCE** — see RR-01 |
| Implemented in | `electron/services/calculators/meld.cjs` (`calculatePELD`) |

Constants confirmed from the policy narrative and enforced in code:

| Constant | Value | Policy text |
| --- | --- | --- |
| Albumin / bilirubin / INR floor | 1.0 | "Albumin, bilirubin, and INR values less than 1.0 will be set to 1.0 when calculating a candidate's PELD score" |
| Creatinine cap | 1.3 mg/dL (and on dialysis / 24h CVVHD) | §9.1.E |
| Scaling | (Σ Table 9-1 terms + 1.5287) × 10 + 2.82 | §9.1.E |
| Score minimum | 6, rounded to the nearest whole number | §9.1.E |
| Applicability | candidates under 12 years old | §9.1.E |

The **per-term coefficients** are published only in Table 9-1, which is
rendered as an image in the policy PDF and is not reproducible from the
surrounding narrative. TransTrack therefore does not compute PELD. See RR-01.

The **superseded** pre-2023 equation (McDiarmid SV et al. *Transplantation*
2002;74:173-181) remains implemented as `calculatePELDLegacy2016` for
reconciling historical records. It is stamped `superseded: true`, is not
reachable through the PELD calculator dispatch, and is never returned under the
`PELD` label.

### SRC-OPTN-P8 — KDRI / KDPI

| Field | Value |
| --- | --- |
| Source | OPTN Policy 8.5.A, *Kidney Donor Profile Index*; OPTN KDPI calculator reference data |
| Revision | 2022 reference cohort |
| URL | https://optn.transplant.hrsa.gov/data/allocation-calculators/kdpi-calculator/ |
| Supporting literature | Rao PS et al. *Transplantation* 2009;88:231-236 |
| Consulted | 2026-08-02 |
| Reference table | `electron/services/calculators/reference/optn-kdpi.json` |
| Review by | 2026-12-31 |
| Implemented in | `electron/services/calculators/kdpi.cjs` |
| Verified by | `tests/calculatorReferenceVectors.test.cjs` — KDRI block, including the xβ = 0 reference donor and each coefficient in isolation |

The Rao xβ coefficients are implemented directly and verified against the
published model. The **median-KDRI scaling factor (1.32)** and the
**KDRI→KDPI percentile map** are OPTN-owned annual data and live in the
reference table, not in code. The shipped map is a six-anchor piecewise-linear
approximation of the published cumulative distribution; every result carries
`source.approximation: true` and a disclaimer directing decision-grade values to
the OPTN calculator.

### SRC-OPTN-P8B — EPTS

| Field | Value |
| --- | --- |
| Source | OPTN Policy 8.5.B, *Estimated Post-Transplant Survival*; OPTN EPTS calculator reference data |
| Revision | 2022 reference cohort |
| URL | https://optn.transplant.hrsa.gov/data/allocation-calculators/epts-calculator/ |
| Supporting literature | Rao PS et al. *Transplantation* 2009 |
| Consulted | 2026-08-02 |
| Reference table | `electron/services/calculators/reference/optn-epts.json` |
| Review by | 2026-12-31 |
| Implemented in | `electron/services/calculators/epts.cjs` |
| Verified by | `tests/calculatorReferenceVectors.test.cjs` — EPTS block |

Same split as KDPI: the raw-EPTS regression terms are implemented and verified;
the raw→percentile map is externally owned, versioned, and flagged as an
approximation.

### SRC-FHIR-R4-COMPARTMENT — FHIR patient compartment

| Field | Value |
| --- | --- |
| Source | HL7 FHIR R4 `CompartmentDefinition/patient` |
| Revision | FHIR R4 v4.0.1 |
| URL | http://hl7.org/fhir/R4/compartmentdefinition-patient.html |
| Consulted | 2026-08-02 |
| Implemented in | `server/src/fhir/compartment.js` |
| Verified by | `server/test/unit/patientCompartment.test.mjs` |

### SRC-DEF-PCT — Percentage and percentile bounds

Ranges that follow from the definition of the quantity rather than from a
policy document: PRA, CPRA, KDPI and EPTS are percentages or percentiles and
are therefore bounded 0–100. Implemented in
`electron/functions/validators.cjs`.

### SRC-INTERNAL-TTLI — TransTrack Lung Triage Index

| Field | Value |
| --- | --- |
| Source | **None.** This is an internal TransTrack instrument. |
| Derivation | Expert-set constants. Not fitted to data, not published, not externally validated. |
| Implemented in | `electron/services/calculators/las.cjs` |
| Intended use | Internal worklist ordering of a centre's own lung candidates. |
| Prohibited use | Any allocation, listing or clinical decision. It is **not** the OPTN Lung Allocation Score and **not** the Composite Allocation Score. |

Finding C-3 recorded that this instrument was presented as "LAS" while
implementing invented multipliers. It has been renamed so that its output
cannot be mistaken for a published score, and every result carries
`isPublishedInstrument: false`. Centres requiring a real LAS or CAS obtain it
from UNet and record it in `patient.las_score`, which TransTrack stores but does
not compute.

### SRC-INTERNAL-IRE — Inactivation Risk Engine

| Field | Value |
| --- | --- |
| Source | **None.** Internal TransTrack instrument. |
| Derivation | Expert-elicited factor weights; 30/60/90-day probability curves fitted by logistic regression to an internally authored anchor table, not to observed cohort outcomes. |
| Implemented in | `electron/services/inactivationRiskEngine.cjs` |
| Status | Not clinically validated. Requires site-specific recalibration during PQ. |

See informational findings I-2 and I-3, and
[`RESIDUAL_RISK.md`](RESIDUAL_RISK.md) entry RR-02.

## 3. Change control

An entry in this register may only change through the following steps, all of
which are recorded in the change history below.

1. Obtain the new revision of the controlled source.
2. Update the corresponding `reference/*.json` file, including `sourceRevision`,
   `effectiveDate` and a new `reviewBy`.
3. Add or update the reference vectors in
   `tests/calculatorReferenceVectors.test.cjs` so the new constants are checked
   against the new source, not against the implementation.
4. Update the row in §2.
5. Record the change in the validation package (`VALIDATION_SUMMARY_REPORT.md`
   §7, Change Control) and re-execute the affected OQ cases.

## 4. Staleness control

`electron/services/calculators/referenceData.cjs` reads every table and compares
today's date to `reviewBy`:

| Condition | Behaviour |
| --- | --- |
| Table absent | Calculator returns `REFERENCE_DATA_UNAVAILABLE`. No score is produced. |
| Table present, `status` ≠ `ACTIVE` | Calculator returns `REFERENCE_DATA_UNAVAILABLE` with the declared reason. |
| Table present, within `reviewBy` | Score returned; `source` block names the revision. |
| Table present, past `reviewBy` | Score returned but flagged `stale` with the overdue day count; the disclaimer states the divergence risk; `healthCheck` reports a degraded state; `tests/calculatorReferenceVectors.test.cjs` **fails the build**. |

The failing build is deliberate. Finding H-10's substance was that divergence
from OPTN was "guaranteed and silent"; the control that closes it is the one
that makes divergence noisy.

## 5. Change history

| Version | Date | Change | Author |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Initial register, created in response to validation finding C-3. Confirmed the PELD albumin floor of 1.0 against OPTN Policy 9.1.E (the validation report flagged it for reconciliation; the source confirms the implementation was correct). Identified and corrected a genuine defect: MELD 3.0 applied the adult intercept and sex term to candidates aged 12–17, who take a distinct published equation. | Clinical Informatics Lead |
