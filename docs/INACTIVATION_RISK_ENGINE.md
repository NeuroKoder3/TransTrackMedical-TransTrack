# Inactivation Risk Engine v2

> Operational, not clinical. Decision support, not decision-making.
> Allocation decisions remain in OPTN UNet. This engine prevents
> candidates from being **operationally inactivated** — losing their seat
> on the active waitlist because of paperwork, evaluation expiry, or
> non-clinical readiness barriers, not because of medical contraindication.

| Property | Value |
|---|---|
| Module | `electron/services/inactivationRiskEngine.cjs` |
| IPC channels | `inactivationRisk:*` (preload bridge: `window.electronAPI.inactivationRisk`) |
| Tests | `tests/inactivationRiskEngine.test.cjs` (33 cases, pure function, no DB) |
| Model version | `2.0.0` |
| Determinism | Pure function. Same inputs + same `nowMs` → same output. |
| Explainability | Full per-factor decomposition + counterfactual simulation. |
| External dependencies | None (no AI/ML, no cloud, no network). |

---

## 1. What the engine answers

For any active candidate, the engine answers four questions:

1. **How likely is this candidate to be operationally inactivated?**
   A composite 0–100 risk score, classified as `none` / `low` / `moderate` / `high` / `critical`.
2. **What is the calibrated probability of inactivation in 30 / 60 / 90 days?**
   Logistic mapping with documented intercept/slope; recalibratable per center during PQ.
3. **Why?**
   Per-factor decomposition: every contributing factor with its raw sub-score, weight,
   weighted contribution, and percent share of the composite. SHAP-style additive.
4. **What should we do about it?**
   Ranked list of counterfactual interventions: "if we resolve this insurance barrier,
   the score drops from 78 to 41". The coordinator is given the highest-impact action
   first, with the projected score reduction.

For the center as a whole, a fifth question:

5. **What is the dollar value of inactivation prevention this quarter?**
   `projectCenterImpact(roster)` returns expected inactivations within 90 days
   (baseline vs. post-intervention) and the dollar value avoided, against a
   default cost-of-inactivation that the deploying center should override
   with their own finance number.

---

## 2. Factors and weights

```
EVAL_EXPIRY      0.22   evaluation window closing or expired
DOCUMENTATION    0.14   patient record staleness
BARRIERS         0.20   open non-clinical readiness barriers
LAB_CURRENCY     0.10   required labs missing or expired (currency only)
AHHQ_CURRENCY    0.08   adult Health History Questionnaire status
STATUS_CHURN     0.10   flapping status changes
CONTACT_RECENCY  0.10   days since last patient touchpoint
COORDINATOR_LOAD 0.06   coordinator panel size
                ─────
                 1.00
```

Weights sum to exactly 1.0 — enforced at module load with an assertion.
Each sub-scorer is independently testable, returns 0–100, and is documented
in source. Each preventable factor maps to a canonical intervention type
that the counterfactual simulator understands.

## 3. Calibration

The composite score is mapped to a probability of inactivation in N days
through a fixed logistic function:

```
P(inactivation within N days | score) = sigmoid(intercept_N + slope_N * score)
```

The default intercept/slope pairs (`d30`, `d60`, `d90`) are conservative and
chosen so that:

| score | P(30d) | P(60d) | P(90d) |
|---|---|---|---|
| 25  | ~10% | ~18% | ~25% |
| 50  | ~30% | ~45% | ~55% |
| 75  | ~65% | ~78% | ~85% |
| 90  | ~82% | ~90% | ~94% |

Deploying organizations are expected to recalibrate {intercept, slope}
against their own historical inactivation cohort during PQ. Recalibration
does not change the model shape (logistic) and does not require a new
model version. Recalibration that changes factor weights or sub-scoring
logic does require a new model version.

## 4. Determinism, audit, and reproducibility

* The pure-function path takes a snapshot object and returns an assessment.
  It does **not** read the database, the file system, the network, or the
  wall clock unless `nowMs` is omitted.
* Every assessment carries:
  * `modelVersion` — the model that produced it.
  * `inputsFingerprint` — first 16 hex chars of SHA-256 over the canonical-key-ordered
    input snapshot. Same inputs → same fingerprint, always.
  * `assessedAtISO` — wall-clock timestamp at scoring.
  * `disclaimer` — operational/non-clinical/non-allocative caveat.
* Historical scores stored in the database can be re-explained by replaying
  the input snapshot through the matching model version.

## 5. Counterfactual simulation

`simulateIntervention(inputs, intervention)` returns `{ before, after, scoreReduction, fullAssessmentAfter }`.

Supported interventions:

| `intervention.type` | What it changes |
|---|---|
| `resolveBarrier` (with `barrierId`) | Removes one barrier from `openBarriers` |
| `resolveAllBarriers` | Empties `openBarriers` |
| `refreshEvaluation` | Sets `lastEvaluationDateISO` to `now` |
| `refreshDocument` | Sets `lastDocumentUpdateISO` to `now` |
| `refreshLabs` | Zeroes `labsMissingCount` and `labsExpiredCount` |
| `refreshAHHQ` | Sets `ahhqStatus` to `current` |
| `recordContact` | Sets `lastContactISO` to `now` |

The engine also returns an `interventions[]` list ranked by projected score
reduction so coordinators can act on the highest-impact item first.

## 6. Center-level projection (`projectCenterImpact`)

Given an array of input snapshots — typically every active candidate at
the center — the engine returns:

* Distribution by risk level
* Expected inactivations within 90 days, baseline vs. post-intervention
* Inactivations avoided
* Estimated dollars avoided (against `costPerInactivationUSD`, defaulted to
  $18 000 — a deliberately conservative figure based on published
  re-evaluation cost ranges; centers should override with their own)
* Per-candidate before/after table

This is the artefact a transplant administrator brings to the quarterly
operations review.

## 7. IPC contract

Available on the renderer via the preload bridge:

```js
window.electronAPI.inactivationRisk.getModelInfo()
window.electronAPI.inactivationRisk.assessPatient(patientId)
window.electronAPI.inactivationRisk.simulateIntervention({ patientId, intervention })
window.electronAPI.inactivationRisk.projectCenterImpact({ costPerInactivationUSD?, interventionCapPerCandidate? })
```

All channels:

* require an authenticated session (`shared.validateSession()`);
* are scoped to the caller's `org_id` (no cross-org leakage);
* are audit-logged with the score, model version, and inputs fingerprint;
* are rate-limited via the global IPC middleware.

`projectCenterImpact` additionally requires the `admin`, `coordinator`,
or `regulator` role because it surfaces aggregate ROI numbers.

## 8. What the engine is NOT

* It is **not** a clinical risk score. It does not consider lab values,
  diagnoses, comorbidities, or imaging. It only considers operational
  signals (expiry windows, barriers, churn, contact recency).
* It is **not** an allocation system. Allocation is performed by OPTN UNet.
* It is **not** an FDA medical device. See `docs/compliance/FDA_DEVICE_RATIONALE.md`
  for the §520(o)(1)(E) Clinical Decision Support exemption rationale.
* It does **not** replace coordinator judgment. The coordinator is the
  decision-maker; the engine is decision support.

## 9. Roadmap

* Per-organ recalibration (kidney vs. liver have different inactivation
  drivers; current model is organ-agnostic).
* Center-specific weight learning from local outcomes (within the
  customer's encrypted database; no PHI leaves the device).
* CDS Hooks 1.1 service exposing the same engine inside the optional
  server tier so partner systems (Epic, Ottr, TXAccess) can request
  the same explainable assessment in their own UI.
* Bulk projection NDJSON export at `/fhir/$inactivationRisk` (server tier).
