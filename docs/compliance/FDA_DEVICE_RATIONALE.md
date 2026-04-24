# FDA Device-Status Rationale (DRAFT — Legal Review Required)

> **CRITICAL:** This document is a *technical-engineering rationale* drafted to
> support a regulatory determination. It is **not** legal advice and does **not**
> constitute an FDA determination. Any deploying organization or vendor planning
> to commercialize TransTrack must obtain a written opinion from qualified
> FDA regulatory counsel. Do not rely on this document.

## 1. Question

Is TransTrack a **medical device** under 21 USC §321(h)(1) and the FDA's
Software-as-a-Medical-Device (SaMD) framework, or is it Clinical Decision Support
(CDS) software that falls outside the device definition under §520(o)(1)(E) of
the FD&C Act (21st Century Cures Act, 2016)?

## 2. Statutory text — §520(o)(1)(E) carve-out

Software is **not** a medical device if it meets all four of the following:

* (i)  Not intended to acquire, process, or analyze a medical image or a signal
        from an in-vitro diagnostic device or a pattern or signal from a signal
        acquisition system.
* (ii) Intended for the purpose of displaying, analyzing, or printing medical
        information about a patient or other medical information (such as
        peer-reviewed clinical studies and clinical practice guidelines).
* (iii) Intended for the purpose of supporting or providing recommendations to
         a health care professional about prevention, diagnosis, or treatment
         of a disease or condition.
* (iv) Intended for the purpose of enabling such health care professional to
        independently review the basis for such recommendations such that the
        professional does not rely primarily on any of such recommendations to
        make a clinical diagnosis or treatment decision regarding an individual
        patient.

## 3. TransTrack mapping

| Criterion | TransTrack design |
|---|---|
| (i) No image / IVD signal processing | TransTrack does not ingest DICOM, waveform, or IVD instrument data. Lab values are stored as opaque strings without interpretation. **Met.** |
| (ii) Display / analyze patient medical information | TransTrack displays waitlist information, MELD/LAS scores, organ-offer history, follow-up status. **Met.** |
| (iii) Support / recommendations to HCPs | TransTrack surfaces operational priority rankings and risk scores. These are framed as **operational coordination signals**, not clinical recommendations. **Met with documentation.** |
| (iv) Independent review by HCP | TransTrack labels every score as a *reference value*, displays the formula and inputs (so the HCP can re-derive), and explicitly states that allocation decisions are made via OPTN UNet, not TransTrack. **Met with explicit UI controls.** |

## 4. Allocation: why TransTrack is *not* an allocation system

OPTN allocation is performed by UNet using national policies. TransTrack:

* Does **not** rank organs across a national waitlist.
* Does **not** generate a UNOS Match Run.
* Does **not** transmit data to UNet.
* Does **not** assign organs.

TransTrack's "match" feature is an **internal operational ranking** for the
center's own coordination workflow. The OPTN-style export ships with a watermark
"NOT FOR UNet SUBMISSION".

## 5. Calculators (MELD, MELD-Na, MELD 3.0, PELD, LAS, KDPI, EPTS)

These are scoring formulas published in peer-reviewed literature and adopted by
OPTN policies. TransTrack's implementations:

* Reproduce the published formula deterministically.
* Cite the source publication (`citation` field on each calculator module).
* Hard-stop with "Insufficient data" if any required input is missing.
* Display the underlying inputs alongside the score so the HCP can re-derive.

This places the calculators within criterion (iv): the HCP can independently
review the basis. Calculators are nonetheless flagged as **reference values, not
official OPTN-submitted scores**.

## 6. Risk-control argument supporting CDS classification

* No algorithm is opaque to the user.
* No real-time alerting drives clinical action without HCP review.
* No automated diagnosis or treatment recommendation.
* Outputs are advisory and editable.

## 7. Counter-positions to consider

| Counter-position | Mitigation |
|---|---|
| KDPI / EPTS displayed in donor-matching screen could be construed as device-quality scoring | Screen labels them as reference values, formula and inputs visible, citations linked. |
| Risk-prediction service generates an inactivation risk score | Score frames the patient operational journey, not clinical diagnosis. Output is advisory only. |
| Allocation Priority Score includes "medical urgency weight" | Score is org-configurable and labelled "operational, not allocative". |
| Post-transplant follow-up tracks rejection episodes / biopsies | Tracking ≠ diagnosis. Recording an episode entered by an HCP is documentation. |

## 8. Recommended action for vendor

1. Obtain written FDA-counsel opinion citing this rationale.
2. If counsel concurs: file a **Section 513(g) Request for Information** with
   the FDA for a written determination, or proceed with a documented
   self-determination of CDS exemption.
3. If counsel does **not** concur: reposition affected features (e.g., make
   risk-prediction admin-only, suppress KDPI/EPTS display, strip post-transplant
   tracking) **or** pursue a **510(k)** submission.
4. Maintain this rationale alongside the Validation Plan for inspection.

## 9. References

* 21 USC §321(h)(1)
* 21 USC §360j(o) (added by 21st Century Cures Act, 2016)
* FDA Guidance: *Clinical Decision Support Software*, Sept 2022.
* FDA Guidance: *Software as a Medical Device (SaMD) — Clinical Evaluation*, 2017.
* OPTN Policies, current version, especially Policies 8 and 14.
