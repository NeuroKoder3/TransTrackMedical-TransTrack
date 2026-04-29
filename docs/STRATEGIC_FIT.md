# TransTrack — Strategic Fit Brief

> Audience: corporate development / strategy teams at transplant-software
> companies considering acquisition, OEM, or distribution partnership.
> The most natural acquirer or partner today is **CareDx** (NASDAQ: CDNA),
> given their concentration in transplant patient management software and
> diagnostics.

This document is intended to make the diligence call short.

---

## 1. The problem TransTrack uniquely solves

National transplant systems (UNOS / OPTN / UNet) and transplant
patient-management suites (CareDx Ottr, CareDx TXAccess, etc.) handle the
allocation and longitudinal-management surfaces well. None of them are
purpose-built for the operational layer that decides whether a candidate
**stays active on the waitlist** in the first place.

Inactivation is rarely a clinical event. It is, overwhelmingly, an
operational event:

* annual evaluation expired before re-eval was scheduled
* required labs lapsed
* aHHQ never refreshed
* insurance lapsed and the social-work referral didn't close
* coordinator panel got too big and the patient stopped getting touched
* status flipped between active and inactive twice and the third flip
  stuck

TransTrack is the only product in the transplant software market with a
**deterministic, explainable, counterfactual** Inactivation Risk Engine
designed specifically to prevent these failures. It does not duplicate
allocation, longitudinal CTM, or diagnostics — it complements them.

## 2. Where TransTrack fits in CareDx's stack

| Layer | CareDx today | TransTrack adds |
|---|---|---|
| Pre-listing waitlist coordination | Limited | **Operational risk intelligence + inactivation prevention** (the differentiator) |
| Allocation | OPTN UNet (national, regulated) | Out of scope; TransTrack does not allocate |
| Patient management software | Ottr (waitlist + post-tx CTM) | Embeds beneath Ottr as an inactivation-prevention layer; or runs alongside as the "operations cockpit" for coordinators |
| Transplant patient access | TXAccess | Complementary; TransTrack is the inside-the-center workflow surface |
| Diagnostics | AlloSure, AlloMap, AlloSeq | Complementary — TransTrack ingests lab currency signals but does not interpret diagnostic values |

The engine is designed to be **embedded**: a CDS Hook on the optional server
tier can deliver the same explainable assessment inside Epic / Cerner / Ottr
without TransTrack's UI being present. The pure-function scoring core
(`electron/services/inactivationRiskEngine.cjs`, ~530 lines, zero external
deps) drops into any Node-compatible runtime.

## 3. Differentiators that survive a technical review

1. **Pure-function, deterministic, explainable scoring.** Every score is
   reproducible from a fingerprinted input snapshot. There is no opaque
   model. SHAP-style additive decomposition shows exactly why a patient
   was flagged. (`tests/inactivationRiskEngine.test.cjs` — 33 cases —
   asserts determinism, weight invariants, and decomposition correctness.)
2. **Counterfactual interventions.** Coordinators don't just see a score —
   they see "if you resolve this insurance barrier, the score drops
   from 78 to 41." That is the difference between a dashboard and an
   action queue.
3. **Center-level ROI projection.** `projectCenterImpact` returns expected
   inactivations avoided per quarter and the dollar value, against a
   configurable cost-per-inactivation. This is the slide a transplant
   administrator brings to the quarterly review — and the slide that
   gets renewals signed.
4. **Offline-first, encrypted-at-rest, validated.** AES-256 SQLCipher,
   PBKDF2-SHA512 ≥256 000, OS-keychain key protection, immutable audit
   logs (DB-trigger enforced), TOTP MFA, full IQ/OQ/PQ validation
   templates, ISO 14971-style risk register, HIPAA Security Rule mapping,
   21 CFR Part 11 control mapping. (`docs/compliance/`.)
5. **Optional FHIR R4 / SMART on FHIR v2 / CDS Hooks 1.1 server tier.**
   Already runs against the Epic on FHIR sandbox today (evidence:
   `demo-evidence/epic-roundtrip-20260426-193254.txt`). The same engine
   can be a CDS Hook embedded in Ottr / TXAccess workflows.
6. **Mature CI/CD.** ESLint, TypeScript check, npm audit (moderate+),
   CodeQL, Snyk, CycloneDX SBOM, Playwright E2E, Vitest component
   coverage, dependency lockfile integrity, Dependabot — all on every PR.
7. **Dormant license-enforcement scaffolding.** The codebase already
   contains a license subsystem (HMAC integrity seal, machine binding,
   tier prefixes). The public 1.0 ships with all features unlocked.
   An OEM partner who wants paywalled tiers can reactivate the
   subsystem behind a build flag without rewriting it.

## 4. Acquisition / partnership readiness checklist

| Item | Status |
|---|---|
| Comprehensive validation package (URS / SRS / SDS / Traceability / Risk Register / IQ / OQ / PQ) | Done — `docs/compliance/` |
| HIPAA Security Rule control mapping | Done |
| 21 CFR Part 11 control mapping | Done |
| FDA device-status rationale (CDS exemption) | Done — `docs/compliance/FDA_DEVICE_RATIONALE.md` |
| ISO 14971-style risk register with residual risk | Done — `docs/compliance/RISK_REGISTER.md` |
| Threat model | Done — `docs/THREAT_MODEL.md` |
| Disaster recovery / BCDR | Done — `policies/BUSINESS_CONTINUITY_AND_DR.md` |
| Encryption key management SOP | Done — `docs/ENCRYPTION_KEY_MANAGEMENT.md` |
| Incident response plan | Done — `policies/INCIDENT_RESPONSE_PLAN.md` |
| Operator runbook (5-minute Docker smoke test) | Done — `RUNBOOK.md` |
| Production deployment guide | Done — `docs/DEPLOYMENT_PRODUCTION.md` |
| Inactivation Risk Engine technical spec | Done — `docs/INACTIVATION_RISK_ENGINE.md` |
| Test count (Node + Vitest) | 270+ (all passing on `main`) |
| Working pre-built Windows installer | Yes (`release/enterprise/` — pending code signature) |
| Working Epic FHIR sandbox round-trip | Yes — recorded in `demo-evidence/` |
| `npm run release:check` single-command release gate | Yes |

### Closeable gates (engineering effort: low)

| Gate | Status | Owner |
|---|---|---|
| Code-signing certificate (Windows EV) | Procurement | Vendor |
| Apple Developer enrollment + macOS notarization | Procurement | Vendor |
| First customer IQ/OQ/PQ dry run | Schedulable | Joint |
| Recalibrate logistic probabilities against deploying-center cohort | Pluggable; intercepts/slopes are config | Customer |

## 5. The ask

If CareDx (or any equivalent transplant-software acquirer) needs:

* a **white-label inactivation-prevention layer** to embed inside Ottr / TXAccess,
* a **CDS Hook** they can offer to Epic-using transplant centers,
* a **standalone offline cockpit** to sell into transplant centers that
  haven't standardized on Ottr,
* or the underlying **pure-function scoring core** as a Node module their
  own product team can wrap,

TransTrack is engineered to deliver all four from a single codebase.
The differentiated capability — deterministic, explainable, counterfactual
inactivation-prevention scoring — does not exist in any competing product
today.

Engineering contact: `Trans_Track@outlook.com`.
