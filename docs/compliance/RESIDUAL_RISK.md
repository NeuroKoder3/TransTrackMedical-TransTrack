# Residual Risk Statement

| Document ID | TT-RR-001 |
| --- | --- |
| Version | 1.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Quality Assurance Officer |
| Contributing roles | Clinical Informatics Lead, Engineering Lead, Information Security Officer |
| Review cadence | Every release, and within 30 days of any event that changes a closure criterion |

## 1. Purpose and standing

A residual risk is a risk that remains after every control the vendor intends
to apply has been applied. ISO 14971 §7 requires that such risks be evaluated,
justified, and disclosed to the user of the system. This document is that
disclosure.

It is deliberately separate from [`RISK_REGISTER.md`](RISK_REGISTER.md). The
risk register records hazards and the mitigations that reduce them; this
document records what is **left over** — the specific things TransTrack does
not do, cannot evidence, or has not verified in the environment available to
the vendor. A deploying organisation must read this document before signing
its own Validation Summary Report, because several entries transfer work or
liability to the deploying organisation.

Three conventions apply throughout:

1. **Nothing here is closed by assertion.** Every entry carries a closure
   criterion that is an observable event, not an opinion.
2. **Fail-closed is preferred to approximate.** Where TransTrack cannot obtain
   an authoritative value, it produces no value. RR-01 is the reference case.
3. **Vendor scope is stated explicitly.** Where an entry says the deploying
   organisation must act, the vendor is not asserting that the risk is
   acceptable on the organisation's behalf; it is asserting only that the
   vendor has done what a vendor can do.

## 2. Summary

| ID | Residual risk | Findings | Severity if realised | Accepted by | Closure owner |
| --- | --- | --- | --- | --- | --- |
| [RR-01](#rr-01--peld-is-not-computed) | PELD is not computed; no pediatric liver reference score | C-3 | 3 — Moderate | Clinical Informatics Lead | Vendor (Clinical Informatics Lead) |
| [RR-02](#rr-02--the-inactivation-risk-engine-is-not-clinically-validated) | Inactivation risk engine is expert-elicited, not fitted or validated | I-2, I-3 | 3 — Moderate | Clinical Informatics Lead | Deploying organisation (during PQ) |
| [RR-03](#rr-03--kdpi-and-epts-percentile-maps-are-approximations) | KDPI / EPTS percentile maps are piecewise approximations | H-10 (partial) | 3 — Moderate | Clinical Informatics Lead | Vendor (Clinical Informatics Lead) |
| [RR-04](#rr-04--rls-is-not-verified-against-a-live-postgresql-instance) | Server-tier RLS verified at DDL and query level only | H-3 | 2 — Major | Engineering Lead | Deploying organisation + Vendor |
| [RR-05](#rr-05--performance-qualification-has-not-been-executed) | PQ not executed by the vendor | C-2 | 2 — Major | Quality Assurance Officer | Deploying organisation |
| [RR-06](#rr-06--installation-qualification-is-partially-executed) | IQ host-specific steps not executed by the vendor | C-2 | 3 — Moderate | Quality Assurance Officer | Deploying organisation |
| [RR-07](#rr-07--the-lung-triage-index-is-an-internal-instrument) | TTLI is internal, not the OPTN LAS or CAS | C-3 | 2 — Major | Clinical Informatics Lead | Vendor (permanent design decision) |
| [RR-08](#rr-08--secure-delete-cannot-guarantee-erasure-on-modern-storage) | Multi-pass overwrite does not erase on SSD / CoW / snapshotted volumes | L-6 | 2 — Major | Information Security Officer | Deploying organisation |
| [RR-09](#rr-09--no-independent-security-assessment) | No independent penetration test or SOC 2 attestation | — | 2 — Major | Information Security Officer | Vendor + deploying organisation |
| [RR-10](#rr-10--release-signing-credentials-are-not-yet-procured) | Code-signing and notarization credentials not procured | — | 2 — Major | Release Manager | Vendor (Release Manager) |
| [RR-11](#rr-11--no-disaster-recovery-drill-has-been-executed-for-this-release) | No executed DR restore drill for 1.3.0 | I-5 | 2 — Major | Information Security Officer | Deploying organisation |
| [RR-12](#rr-12--optional-egress-paths-exist-and-are-off-by-default) | Optional remote log sink, SIEM forwarder and auto-update can egress | M-17 | 3 — Moderate | Information Security Officer | Deploying organisation |
| [RR-13](#rr-13--electronic-signatures-are-application-level-not-1120011300-compliant) | E-signature is application-level, not §11.200-compliant | M-17 | 3 — Moderate | Quality Assurance Officer | Vendor (roadmap) |
| [RR-14](#rr-14--the-server-tier-is-early-access) | Server tier is early access; integration suites need PostgreSQL | M-17 | 2 — Major | Engineering Lead | Vendor + deploying organisation |
| [RR-15](#rr-15--the-security-disclosure-address-is-a-placeholder) | Role-based disclosure address not yet provisioned | L-13 | 3 — Moderate | Information Security Officer | Vendor (Information Security Officer) |
| [RR-16](#rr-16--reference-data-goes-stale-between-optn-publication-cycles) | OPTN reference tables can go stale between publication cycles | H-10 | 3 — Moderate | Clinical Informatics Lead | Vendor (Clinical Informatics Lead) |

Severity uses the scale in [`RISK_REGISTER.md`](RISK_REGISTER.md) §Severity
scale.

---

## RR-01 — PELD is not computed

| Field | Value |
| --- | --- |
| Affected findings | C-3 |
| Affected components | `electron/services/calculators/meld.cjs` (`calculatePELD`), `electron/services/calculators/reference/optn-peld.json` |
| Source register entry | SRC-OPTN-P9E in [`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md) |
| Severity if realised | 3 — Moderate |
| Status | **Open — accepted** |

### Description

OPTN Policy 9.1.E defines the PELD score as a weighted sum of candidate
factors whose per-term coefficients are published in **Table 9-1**. In the
controlled policy document that table is rendered as an image. Its numeric
contents cannot be extracted from the surrounding narrative text, and the
vendor was not able to obtain a machine-readable or textual revision of the
table from an authoritative OPTN source.

Secondary sources reproducing the table were found to contradict OPTN's own
narrative — in particular on the treatment of the growth-failure term and on
whether the pre-2023 or post-2023 coefficient set was being reproduced. A
coefficient set that disagrees with the controlling policy is worse than no
score: it is a score that looks authoritative and is wrong.

TransTrack therefore **fails closed**. `optn-peld.json` carries
`status: AWAITING_CONTROLLED_SOURCE`, and the calculator returns
`REFERENCE_DATA_UNAVAILABLE` rather than a number. The bounds, clamps and
scaling constants that *are* stated in the policy narrative (albumin,
bilirubin and INR floor of 1.0; creatinine cap of 1.3 mg/dL; the
`(Σ + 1.5287) × 10 + 2.82` scaling; the minimum of 6; applicability under age
12) are implemented and enforced, so that only the coefficient gap remains.

### Impact

Pediatric liver candidates have **no PELD reference score in TransTrack**.
Any screen or export that would display PELD displays the unavailability
reason instead. Centres obtain PELD from the OPTN calculator at
<https://optn.transplant.hrsa.gov/data/allocation-calculators/> and, where they
need it recorded, enter it as an externally sourced value.

This does not affect allocation. TransTrack does not perform allocation, and
the authoritative PELD for allocation has always been the one computed in
UNet.

### Why it is accepted

Producing a score from an unverifiable coefficient set would violate rule 3 of
the controlled clinical source register ("no guessed constants") and would
create a clinical-correctness hazard of severity 2. Producing no score creates
an availability gap of severity 3 that is fully visible to the user at the
point of use. The lower-severity, visible failure is the correct trade.

### Compensating controls

| Control | Where |
| --- | --- |
| Calculator returns `REFERENCE_DATA_UNAVAILABLE` with the declared reason rather than a number | `electron/services/calculators/referenceData.cjs` |
| The unavailability reason names OPTN Table 9-1 and directs the user to the OPTN calculator | `optn-peld.json` `statusReason` |
| The superseded pre-2023 equation is retained only as `calculatePELDLegacy2016`, stamped `superseded: true`, unreachable from the PELD dispatch, and never returned under the `PELD` label | `meld.cjs` |
| Reference vectors assert that no PELD value is produced while the table is unpopulated | `tests/calculatorReferenceVectors.test.cjs` |
| The gap is disclosed in the README calculator list | `README.md` |

### Closure criteria

All four must hold:

1. The OPTN Policy 9.1.E Table 9-1 coefficients are obtained from the
   controlled policy document (or from an OPTN-published machine-readable
   dataset), with the revision date recorded.
2. `electron/services/calculators/reference/optn-peld.json` is populated with
   those coefficients, `status` set to `ACTIVE`, and `sourceRevision`,
   `effectiveDate` and `reviewBy` set.
3. Reference vectors covering at least the OPTN worked examples, the clamp
   boundaries and the age-12 applicability edge are added to
   `tests/calculatorReferenceVectors.test.cjs` and assert against the source,
   not against the implementation.
4. SRC-OPTN-P9E in [`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md) is updated and
   the affected OQ case is re-executed under
   [`policies/CHANGE_MANAGEMENT_SOP.md`](policies/CHANGE_MANAGEMENT_SOP.md).

---

## RR-02 — The inactivation risk engine is not clinically validated

| Field | Value |
| --- | --- |
| Affected findings | I-2, I-3 |
| Affected components | `electron/services/inactivationRiskEngine.cjs` |
| Source register entry | SRC-INTERNAL-IRE in [`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md) |
| Severity if realised | 3 — Moderate |
| Status | **Open — accepted, requires site action** |

### Description

The inactivation risk engine assigns each candidate an operational risk score
and reports 30-, 60- and 90-day inactivation probabilities. Neither the factor
weights nor the probability curves are derived from observed outcomes:

* The **factor weights** are expert-elicited. They encode a clinical
  informatics judgement about which operational conditions precede
  inactivation, not a coefficient fitted to a cohort.
* The **30/60/90-day probabilities** are produced by logistic curves fitted to
  an internally authored anchor table. The fit is a fit to that table, not to
  patient outcomes. The anchor table is an expert artefact.

The engine is deterministic and fully decomposable — every score can be
explained as an additive sum of named factors — so it is auditable. It is not
calibrated. A reported "68% probability of inactivation within 60 days" has
not been shown to correspond to 68 of 100 comparable candidates being
inactivated within 60 days at any centre.

### Impact

Risk ordering is likely to be directionally useful (a candidate with three
open barriers and an expired evaluation genuinely is at higher operational
risk than one with none), but the **absolute probabilities are not
trustworthy** and must not be presented to a patient, a payer, or a regulator
as a predicted outcome. A centre that used them to set staffing levels or to
triage outreach capacity would be relying on numbers that have no empirical
basis at that centre.

### Why it is accepted

The alternative — shipping no operational risk signal — removes the product's
core value, and the engine's outputs are operational rather than clinical: no
allocation, listing, or treatment decision depends on them. Calibration
requires observed inactivation outcomes, which by definition can only be
collected at a deploying site. Accepting the risk with mandatory site
recalibration is the only path that can ever close it.

### Compensating controls

| Control | Where |
| --- | --- |
| Register entry states plainly that the instrument is internal, unfitted and not clinically validated | SRC-INTERNAL-IRE |
| Score decomposition is exposed per factor, so a user can see what drove the number rather than treating it as an oracle | `inactivationRiskEngine.cjs`; `docs/INACTIVATION_RISK_ENGINE.md` |
| Counterfactual simulation is expressed as a change in the internal score, not as a change in outcome probability | `inactivationRiskEngine.cjs` |
| Engine outputs are labelled operational, not allocative | Risk register R-006 |
| 37 deterministic unit assertions pin the engine's arithmetic so recalibration is a controlled change rather than a drift | `tests/inactivationRiskEngine.test.cjs` |

### Closure criteria

Closure is **per site**, and is a PQ deliverable:

1. The site collects at least four quarters of observed inactivation outcomes
   with the engine running in shadow mode.
2. The site compares predicted against observed inactivation rates by decile
   and records calibration error.
3. Factor weights and probability curves are re-derived, or explicitly
   accepted as adequate, and the decision is recorded in the site's PQ report.
4. The recalibrated constants are recorded in the site's configuration change
   log and the affected PQ scenarios are re-executed.

Until step 4 completes at a site, the probabilities are to be treated at that
site as an internal ranking signal only.

---

## RR-03 — KDPI and EPTS percentile maps are approximations

| Field | Value |
| --- | --- |
| Affected findings | H-10 (partially closed) |
| Affected components | `electron/services/calculators/kdpi.cjs`, `epts.cjs`, `reference/optn-kdpi.json`, `reference/optn-epts.json` |
| Source register entries | SRC-OPTN-P8, SRC-OPTN-P8B |
| Severity if realised | 3 — Moderate |
| Status | **Open — accepted** |

### Description

KDPI and EPTS each have two parts. The **regression** part — the Rao xβ
coefficients for KDRI and the raw-EPTS terms — is published in the literature,
is implemented directly, and is verified against the published model by
reference vectors, including the xβ = 0 reference donor and each coefficient
in isolation.

The **percentile mapping** part is different. OPTN publishes an annually
refreshed cumulative distribution derived from the prior year's deceased-donor
and candidate cohorts, as a table of many rows. TransTrack ships a
**six-anchor piecewise-linear interpolation** of that distribution rather than
the full table. Between anchors the mapped percentile is an interpolation, not
the published value.

Divergence is largest where the published distribution is most curved, which
for KDPI is at the extremes (very low and very high KDRI) and for EPTS is in
the upper tail.

### Impact

A TransTrack KDPI or EPTS percentile may differ from the OPTN calculator's
value. The difference is small in the body of the distribution and larger at
the extremes. Because KDPI thresholds carry allocation meaning at 20% and 85%,
a candidate or donor near either threshold could be mapped to the wrong side
of it. TransTrack does not perform allocation, so this cannot itself
misallocate an organ, but it could mislead a coordinator reviewing an offer.

### Why it is accepted

Shipping the full OPTN cumulative distribution requires redistributing an
OPTN-owned dataset that is refreshed annually; the vendor cannot guarantee
timely redistribution rights or timely refresh. Shipping nothing removes a
routinely used reference value. Shipping an interpolation that is *labelled as
one on every single result* preserves the utility while removing the false
precision, which is the substance of finding H-10.

### Compensating controls

| Control | Where |
| --- | --- |
| Every KDPI and EPTS result carries `source.approximation: true` | `kdpi.cjs`, `epts.cjs` |
| Every result carries a disclaimer directing decision-grade values to the OPTN calculator | same |
| The maps live in versioned reference JSON, not in code, so a correction is a data change under change control | `reference/optn-kdpi.json`, `reference/optn-epts.json` |
| Both tables carry `reviewBy: 2026-12-31`; passing it flags results `stale` and fails the build (see RR-16) | `referenceData.cjs` |
| The regression half is verified against the published model independently of the map | `tests/calculatorReferenceVectors.test.cjs` |

### Closure criteria

1. The full OPTN KDRI→KDPI and raw-EPTS→percentile mapping tables for the
   current reference cohort are obtained, with redistribution permission
   confirmed, or an OPTN API is integrated.
2. The reference JSON files carry the full tables and `approximation` is set
   to `false`.
3. Reference vectors assert the mapped percentile against the published table
   at a minimum of the 1st, 20th, 50th, 85th and 99th percentile anchors.
4. The disclaimer text is revised to describe an exact lookup, and the
   affected OQ cases are re-executed.

---

## RR-04 — RLS is not verified against a live PostgreSQL instance

| Field | Value |
| --- | --- |
| Affected findings | H-3 |
| Affected components | `server/src/db/migrations/*.sql`, `server/src/db/*.js`, HL7 dead-letter replay path |
| Severity if realised | 2 — Major |
| Status | **Open — accepted, verification deferred to site** |

### Description

Finding H-3 required row-level security on `hl7_dead_letters`,
`hl7_sending_apps` and `issued_licenses`, and required that cross-tenant
dead-letter replay be refused. Both changes were made and are verified in this
environment at two levels:

* **DDL level** — the migration SQL that enables RLS and creates the policies
  is present and is asserted by the server unit suites.
* **Application-query level** — the queries that set and rely on the tenant
  GUC, and the replay path that refuses a cross-tenant dead letter, are
  exercised by `server/test/unit/hl7Tenancy.test.mjs` and
  `server/test/unit/authTenancy.test.mjs` against the route harness.

What has **not** happened is execution against a running PostgreSQL server.
The vendor verification environment for release 1.3.0 is Linux with Node 22
and no database server; `server/test/integration/*.test.mjs` require
PostgreSQL and were not run. Consequently the following are asserted from the
DDL rather than observed:

* that the policies are actually enforced by the engine for the connecting
  role (a policy on a table owned by, or connected to as, a superuser or a
  `BYPASSRLS` role is inert);
* that `FORCE ROW LEVEL SECURITY` is in effect where table ownership and
  connection role coincide;
* that every application code path sets the tenant GUC before its first query
  on a protected table in that transaction.

### Impact

If a deployment connects as a role that bypasses RLS, the policies are
decoration. The application-level `org_id` scoping would still apply to
queries that carry it, but the defence-in-depth layer that H-3 was raised to
add would be absent. Realised, that is a cross-tenant PHI exposure — severity 2.

### Why it is accepted

The control cannot be observed without the infrastructure it protects, and
that infrastructure is site-owned. The vendor has verified everything that can
be verified without it and has stated the gap rather than allowing a reader to
infer from "H-3 closed" that a live test occurred.

### Compensating controls

| Control | Where |
| --- | --- |
| Application-level `org_id` scoping on every query, independent of RLS | `server/src/db/*.js`; risk register R-014 |
| Cross-tenant dead-letter replay refused in application code, not only by policy | `server/test/unit/hl7Tenancy.test.mjs` |
| Tenancy enforcement on the authenticated principal | `server/test/unit/authTenancy.test.mjs` |
| Deployment hardening assertions covering connection role expectations | `server/test/unit/deploymentHardening.test.mjs` |
| Integration suites exist and are runnable by the site against its own instance | `server/test/integration/api.test.mjs`, `fhir.test.mjs`, `mllp.test.mjs` |

### Closure criteria

1. The deploying organisation provisions a PostgreSQL 16 instance matching its
   production configuration and runs `npm run test:integration` in `server/`.
2. The organisation confirms, with evidence, that the application's database
   role is **not** a superuser, does **not** hold `BYPASSRLS`, and is **not**
   the owner of the RLS-protected tables (or that `FORCE ROW LEVEL SECURITY`
   is set).
3. A negative test is executed: a query issued for tenant A against a row
   belonging to tenant B returns no rows, with the GUC set and with it unset.
4. Results are attached to the site's OQ record and this entry is marked
   closed for that deployment.

---

## RR-05 — Performance Qualification has not been executed

| Field | Value |
| --- | --- |
| Affected findings | C-2 |
| Affected components | The validation package as a whole |
| Severity if realised | 2 — Major |
| Status | **Open — vendor cannot close** |

### Description

Performance Qualification demonstrates that the system performs its intended
function in the intended environment with the intended users and
representative data volumes. Each of those three inputs is unavailable to the
vendor:

* **Users** — PQ requires real clinical coordinators executing their own
  workflow. The vendor has none.
* **Site data** — PQ requires a representative candidate population. The
  vendor has synthetic records only (see
  [`TEST_DATA_PROVENANCE.md`](../TEST_DATA_PROVENANCE.md)).
* **Environment** — PQ requires the site's hosts, identity provider, network
  and SIEM. The vendor has none of these.

Accordingly [`executed/PQ_TT-PQ-001.md`](executed/PQ_TT-PQ-001.md) is issued
as **NOT EXECUTED** by the vendor. It is a protocol for the deploying
organisation to execute, not a record of execution.

### Impact

**TransTrack 1.3.0 is not validated for production clinical use by the vendor
and cannot be.** Vendor software verification is complete; site qualification
is not. A deploying organisation that puts the product into production without
executing PQ has an incomplete validation package and will not be able to
demonstrate fitness for intended use to an auditor.

### Why it is accepted

Because PQ is, by construction, the deploying organisation's activity. A
vendor-executed PQ against invented users and invented workflow would be
fabricated evidence. The honest position — vendor verification complete, site
qualification pending, protocol supplied — is defensible; the alternative is
not.

### Compensating controls

| Control | Where |
| --- | --- |
| Executed IQ recording exactly what the vendor could evidence | [`executed/IQ_TT-IQ-001.md`](executed/IQ_TT-IQ-001.md) |
| Executed OQ recording the automated verification that actually ran | [`executed/OQ_TT-OQ-001.md`](executed/OQ_TT-OQ-001.md) |
| PQ protocol issued ready to execute, with pre-conditions and acceptance criteria | [`executed/PQ_TT-PQ-001.md`](executed/PQ_TT-PQ-001.md) |
| The VSR states which stages are complete and which are not, on its first page | [`VALIDATION_SUMMARY_REPORT.md`](VALIDATION_SUMMARY_REPORT.md) |
| The Validation Plan's acceptance criteria require PQ before a release is "validated for production use" | [`VALIDATION_PLAN.md`](VALIDATION_PLAN.md) §6 |

### Closure criteria

1. The deploying organisation executes `executed/PQ_TT-PQ-001.md` in its own
   environment with its own users.
2. All Mandatory PQ scenarios pass, or failures are recorded as defects and
   resolved.
3. The organisation's Quality Assurance Officer signs a site Validation
   Summary Report.

Closure is per deployment and is never inherited from another site.

---

## RR-06 — Installation Qualification is partially executed

| Field | Value |
| --- | --- |
| Affected findings | C-2 |
| Affected components | Installers, host configuration, `electron-builder.enterprise.json` |
| Severity if realised | 3 — Moderate |
| Status | **Open — vendor portion complete, site portion pending** |

### Description

[`executed/IQ_TT-IQ-001.md`](executed/IQ_TT-IQ-001.md) records the portion of
Installation Qualification that can be evidenced from source on a Linux/Node 22
host: dependency installation from a verified lockfile, native module build,
schema and migration creation, file layout, SBOM tooling availability, and the
dependency-vulnerability gate.

Host-specific installation steps are recorded as **NOT EXECUTED**, with the
reason and the executing party named per step. These include installing from a
signed Windows or macOS installer, verifying the installer signature on the
receiving host, confirming the application data directory location on Windows
and macOS, disk-encryption verification, NTP synchronisation, and egress
restriction.

### Impact

The vendor cannot state that TransTrack installs correctly on a Windows or
macOS host, because it has not been observed doing so as part of this release's
qualification. Installation defects specific to those platforms would first be
seen at a site.

### Why it is accepted

Installation Qualification is inherently per-host and per-site. GAMP 5 assigns
it to the deploying organisation; the Validation Plan does likewise. The vendor
has evidenced everything that is host-independent and has enumerated precisely
what remains.

### Compensating controls

| Control | Where |
| --- | --- |
| The build pipeline verifies the packaged native module on Windows (`npm run verify:packaged-native`) | `package.json` |
| The release gate verifies the installer version matches the source version | `scripts/release-readiness-check.mjs` |
| Renderer↔preload bridge coverage catches features that are wired in development and unwired in a package | `tests/rendererBridgeCoverage.test.mjs` |
| The build entry point is guarded against being overwritten by a build artefact | `tests/buildEntryIntegrity.test.mjs` |
| Every NOT EXECUTED step names the executing party and the evidence required | `executed/IQ_TT-IQ-001.md` §5 |

### Closure criteria

1. The deploying organisation executes the site portion of
   `executed/IQ_TT-IQ-001.md` on each target host.
2. Evidence is captured per step as specified.
3. The organisation's IT / Security role signs the IQ record.

Closure is per host.

---

## RR-07 — The Lung Triage Index is an internal instrument

| Field | Value |
| --- | --- |
| Affected findings | C-3 |
| Affected components | `electron/services/calculators/las.cjs` |
| Source register entry | SRC-INTERNAL-TTLI |
| Severity if realised | 2 — Major |
| Status | **Open — accepted; permanent design position** |

### Description

The module formerly presented as "LAS" computes an instrument with
expert-set constants that is **not** the OPTN Lung Allocation Score and
**not** the Composite Allocation Score that superseded it. Finding C-3
recorded that invented multipliers were being presented under a published
score's name. The instrument has been renamed the **TransTrack Lung Triage
Index (TTLI)**, and every result carries `isPublishedInstrument: false`.

The residual risk is one of user interpretation, not of implementation: a
user who has spent a career saying "LAS" may still read a lung score in a
transplant product as the allocation score.

### Impact

A user who mistook TTLI for LAS or CAS could order a worklist believing it
reflected national allocation priority. It does not, and no ordering derived
from TTLI has any allocation meaning.

### Why it is accepted

The permanent fix — computing a real LAS or CAS — is not available to a
vendor outside UNet, and would in any case reproduce a value the centre
already holds authoritatively. TransTrack stores the centre's real
`patient.las_score` from UNet and does not compute it. The internal instrument
is retained because internal worklist ordering is a genuine operational need
that the national score does not serve.

### Compensating controls

| Control | Where |
| --- | --- |
| Renamed so the output cannot be mistaken for a published score | `las.cjs`; SRC-INTERNAL-TTLI |
| `isPublishedInstrument: false` on every result | `las.cjs` |
| Register entry states the prohibited uses explicitly (allocation, listing, clinical decision) | SRC-INTERNAL-TTLI |
| The real LAS / CAS is stored, not computed, in `patient.las_score` | `electron/database/schema.cjs` |
| README calculator list states the distinction | `README.md` |

### Closure criteria

This risk does not close by engineering change; it is a permanent property of
an internal instrument. It is reviewed annually. It would be **retired** only
by removing the instrument from the product. It is **reduced** by site training
that records the distinction, which is a PQ training deliverable.

---

## RR-08 — Secure delete cannot guarantee erasure on modern storage

| Field | Value |
| --- | --- |
| Affected findings | L-6 |
| Affected components | `electron/services/secureDelete.cjs` |
| Severity if realised | 2 — Major |
| Status | **Open — accepted; mitigated by deployment requirement** |

### Description

`secureDeleteFile()` overwrites a file's contents in place (three passes by
default: random, random, zeros), optionally renames it, and then unlinks it.
This is effective on traditional block storage where a logical block address
maps stably to a physical location.

It is **not** effective on:

* SSDs with wear levelling, where an overwrite is written to a different
  physical page and the original page is merely marked stale;
* copy-on-write filesystems (APFS, Btrfs, ZFS), where an overwrite allocates
  new extents and leaves the originals intact;
* any snapshotted, journaled or replicated volume, where a prior version of
  the file persists outside the application's reach.

The source module documents these limits accurately. The residual risk is that
a deployment reads "multi-pass secure delete" as a guarantee.

### Impact

Plaintext database copies, database temp files, retired backups including WAL
sidecars, PHI exports and the first-launch setup token may leave recoverable
residue on the host after TransTrack believes it has erased them.

### Why it is accepted

No application-level control can defeat storage-layer indirection. Full-disk
encryption is the only reliable defence, and it is a host control the
deploying organisation owns. TransTrack applies the strongest control
available to it and states the limit rather than implying a guarantee.

### Compensating controls

| Control | Where |
| --- | --- |
| Full-disk encryption (BitLocker / FileVault / LUKS) is a mandatory IQ line item | `executed/IQ_TT-IQ-001.md`; `templates/IQ_PROTOCOL_TEMPLATE.md` IQ-02 |
| `PRAGMA secure_delete = ON` for the row-level equivalent inside the database | `electron/database/init.cjs` |
| The limitation is stated in the module header and in the README security section | `secureDelete.cjs`; `README.md` |
| Overwrite behaviour, pass count and rename are covered by 21 assertions | `tests/secureDelete.test.cjs` |
| Media disposal and re-use procedures | [`policies/DATA_RETENTION_AND_DESTRUCTION.md`](policies/DATA_RETENTION_AND_DESTRUCTION.md) |

### Closure criteria

This risk does not close at the application layer. It is **controlled** when
the deploying organisation evidences, per host, that:

1. Full-disk encryption is enabled and centrally attested;
2. Host decommissioning follows cryptographic erase or physical destruction
   per NIST SP 800-88;
3. Volume snapshots containing the application data directory are inventoried
   and are subject to the same retention and destruction schedule as the
   database itself.

---

## RR-09 — No independent security assessment

| Field | Value |
| --- | --- |
| Affected findings | — (raised during validation review) |
| Affected components | Whole product |
| Severity if realised | 2 — Major |
| Status | **Open — accepted** |

### Description

The security posture asserted across the compliance package is
vendor-self-assessed. An internal security assessment has been performed and is
recorded under `docs/security/engagements/`, and this validation exercise is
itself an independent review of the documentation and controls. Neither is a
third-party penetration test, and no SOC 2 Type II or HITRUST attestation
exists.

### Impact

A class of defects that only adversarial testing finds — chained
authorisation bypasses, protocol-level attacks on the MLLP and FHIR surfaces,
Electron-specific escapes — has not been searched for by an independent party.

### Why it is accepted

The product is pre-commercial. Procuring a penetration test is a funded
commercial activity, and the vendor has scoped one rather than claiming one.
No compliance document in the repository asserts that an independent
assessment has occurred.

### Compensating controls

| Control | Where |
| --- | --- |
| Penetration test scope and vendor checklist prepared | `docs/security/PENETRATION_TEST_SCOPE.md`, `docs/security/PENTEST_VENDOR_CHECKLIST.md` |
| Internal security assessment executed and tracked | `docs/security/engagements/2026-06-internal/` |
| Remediation tracker | `docs/security/PENTEST_REMEDIATION_TRACKER.md` |
| Dependency-vulnerability gate with documented, expiring exceptions | `scripts/audit-with-exceptions.mjs`; `tests/auditExceptions.test.mjs` |
| Every compliance document states that attestation is the deploying organisation's responsibility | `docs/compliance/README.md`, `README.md` |

### Closure criteria

1. A third-party penetration test is executed against the scope in
   `docs/security/PENETRATION_TEST_SCOPE.md`.
2. Findings are tracked to closure in the remediation tracker.
3. The summary report is published using
   `docs/security/PENETRATION_TEST_SUMMARY_TEMPLATE.md`.
4. The deploying organisation obtains, or waives in writing, an independent
   attestation appropriate to its own risk appetite.

---

## RR-10 — Release signing credentials are not yet procured

| Field | Value |
| --- | --- |
| Affected findings | — (pre-commercial gap) |
| Affected components | `scripts/sign-win.cjs`, `scripts/notarize.cjs`, release workflow |
| Severity if realised | 2 — Major |
| Status | **Open — accepted; blocks commercial release** |

### Description

The signing and notarization pipeline is implemented and fails closed: a build
designated for public distribution refuses to emit an unsigned artefact and
names the missing credential. The release gate inspects the produced installer
for an embedded Authenticode signature rather than trusting the build
configuration, and rejects a catalog-only signature. What does not exist is a
purchased Windows code-signing certificate or an enrolled Apple Developer
account.

### Impact

No signed installer can be produced today. Until credentials exist, there is no
public release channel, and IQ steps that verify an installer signature cannot
be executed by any site.

### Why it is accepted

The control is built and tested; only the procurement is outstanding. Because
the pipeline fails closed, the failure mode is "no release" rather than "an
unsigned release presented as authentic", which is the correct failure.

### Compensating controls

| Control | Where |
| --- | --- |
| Release builds fail rather than emitting an unsigned artefact | `scripts/sign-win.cjs`, `scripts/notarize.cjs` |
| The gate reads the artefact, not the filename; catalog-only signatures rejected | `scripts/verify-artifact-signature.mjs` |
| Signing behaviour verified by 26 + 12 assertions | `tests/signWin.test.cjs`, `tests/notarize.test.cjs` |
| Artefact signature verification covered by 14 assertions | `tests/artifactSignature.test.mjs` |
| Anti-impersonation notice naming the only authorised download channel | `README.md`, `SECURITY.md` |

### Closure criteria

1. A Windows code-signing certificate (EV or OV with attestation) is procured
   and installed in the CI secret store.
2. Apple Developer enrolment completes and notarization credentials are
   configured.
3. A release build produces a signed installer that
   `scripts/verify-artifact-signature.mjs` accepts on a clean host.
4. IQ step IQ-04 becomes executable and is added to the site IQ as Mandatory.

---

## RR-11 — No disaster recovery drill has been executed for this release

| Field | Value |
| --- | --- |
| Affected findings | I-5 |
| Affected components | Backup / restore, `electron/services/disasterRecovery.cjs` |
| Severity if realised | 2 — Major |
| Status | **Open — accepted; site obligation** |

### Description

[`policies/BUSINESS_CONTINUITY_AND_DR.md`](policies/BUSINESS_CONTINUITY_AND_DR.md)
mandates a quarterly file-restore drill and an annual full-host failure
simulation. **No drill has been executed for TransTrack 1.3.0**, by the vendor
or by any site, and no drill record exists in this repository.

Restore logic is verified in automated tests
(`tests/restoreDatabase.test.cjs`, 7 assertions;
`tests/migrationSafety.test.cjs`, 20 assertions), which is verification of the
code path, not a drill. A drill tests the procedure, the people, the backup
media and the recovery time — none of which a unit test touches.

### Impact

The stated RTO of ≤4 hours and RPO of ≤24 hours are **objectives, not
demonstrated capabilities**. A site declaring them in its own BCP without
having drilled is asserting an untested number.

### Why it is accepted

A drill requires a populated database, a second host and an operator, in the
site's environment. The vendor can supply the procedure and the record format
but cannot execute the drill on the site's behalf.

### Compensating controls

| Control | Where |
| --- | --- |
| Restore path verified by automated test | `tests/restoreDatabase.test.cjs` |
| Pre-migration backup is taken and verified before any migration runs, and migration is refused if it cannot be written | `tests/migrationSafety.test.cjs`; risk register R-013 |
| Backup verification checklist | `docs/DISASTER_RECOVERY.md` §Backup Verification Checklist |
| Drill procedure and record format supplied so the first drill produces controlled evidence | [`RUNBOOK.md`](../../RUNBOOK.md#5-disaster-recovery-drill) §5.1–§5.2 |
| Drill obligation indexed from the operator runbook rather than buried in policy | [`RUNBOOK.md`](../../RUNBOOK.md#3-operating-cadence) §3 |

### Closure criteria

1. A file-restore drill is executed on a non-production host using the
   procedure in `RUNBOOK.md` §5.1 and logged with the template in §5.2.
2. Measured recovery time and recovery point are recorded and compared to the
   objectives in `docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md` §1.
3. Gaps are recorded and either remediated or accepted in writing.
4. The completed record is filed in the site's document control system, and
   the next drill is scheduled per the quarterly cadence.

---

## RR-12 — Optional egress paths exist and are off by default

| Field | Value |
| --- | --- |
| Affected findings | M-17 (documentation conformance) |
| Affected components | `electron/services/logger.cjs`, `electron/services/siemForwarder.cjs`, `electron-updater`, `server/` |
| Severity if realised | 3 — Moderate |
| Status | **Open — accepted; configuration-dependent** |

### Description

TransTrack's desktop core is offline. It is not true that the product has no
external network dependencies. Four egress paths exist:

| Path | Default | Activation | Content |
| --- | --- | --- | --- |
| Remote log sink | Off | `SENTRY_DSN` or `TRANSTRACK_REMOTE_LOG_URL` | Level, ≤256-char message, an allowlist of five meta keys, platform, PID. Redacted at the sink before dispatch. |
| SIEM forwarder | Off | Admin configures a destination | RFC 5424 syslog / CEF events; identifiers and categorical metadata only. |
| Auto-update | Enabled in enterprise builds | `electron-updater` against GitHub Releases | Version metadata and installer download. No PHI. |
| Server tier | Not deployed by default | Site deploys `server/` | Full PHI over TLS between desktop thin client, EHR and server. |

The residual risk is that a deployment enables one of these without treating
it as a disclosure decision.

### Impact

With a remote log sink configured, operational metadata leaves the host to a
destination the vendor does not control. The logger redacts PHI automatically
at the sink (finding H-5) and the remote payload is additionally restricted to
an allowlist, so PHI disclosure is unlikely — but "unlikely by construction"
is not "impossible", and the destination is a business associate relationship
the deploying organisation must paper.

### Why it is accepted

Each path serves a genuine operational need, each is off unless deliberately
enabled, and each is now described accurately in the documentation rather than
denied. The alternative — removing them — would remove SIEM integration, which
is itself a HIPAA audit-control expectation.

### Compensating controls

| Control | Where |
| --- | --- |
| PHI redaction applied at the sink, fail-safe: if redaction throws, content is dropped, not written through | `logger.cjs` `redactForSinks()` |
| Remote payload restricted to an allowlist of five meta keys and a 256-character message | `logger.cjs` `_buildRemotePayload()` |
| Redaction verified adversarially | `tests/loggerRedaction.test.cjs`, `tests/phiLeakage.test.cjs`, `tests/siemRedaction.test.cjs` |
| Crash reporter `submitURL` is empty; minidumps stay local | `logger.cjs` |
| IQ requires default-deny egress with only whitelisted endpoints | `executed/IQ_TT-IQ-001.md` §5 |
| OQ requires a 30-minute packet capture confirming only whitelisted hosts | `templates/OQ_PROTOCOL_TEMPLATE.md` OQ-141 |
| Accurate description of network behaviour | `README.md`, `docs/DUE_DILIGENCE.md` §3.4 |

### Closure criteria

Per deployment:

1. The organisation records which egress paths it has enabled.
2. For each enabled path, a Business Associate Agreement or a documented
   determination of no-PHI is in place.
3. Egress is confirmed by packet capture during OQ (OQ-141).
4. The determination is reviewed at each periodic review.

---

## RR-13 — Electronic signatures are application-level, not §11.200/§11.300 compliant

| Field | Value |
| --- | --- |
| Affected findings | M-17 item 4 |
| Affected components | `electron/services/electronicSignature.cjs` |
| Severity if realised | 3 — Moderate |
| Status | **Open — accepted; roadmap item** |

### Description

`signRecord()` creates a signature record binding the signer's identity, the
declared meaning of the signature, the entity signed, a hash of the payload at
the moment of signing, and an ISO 8601 timestamp, as
`sha256(userId | meaning | entityType | entityId | payloadHash | signedAt)`.
Records are stored in `electronic_signatures` and can be recomputed and
verified by `verifySignature()`.

This is an application-level electronic signature record. It is **not**:

* a PKI digital signature — no asymmetric key, no certificate, no
  non-repudiation against the operator of the database;
* a §11.200(a)(1)(i) two-component signing event — the signing ceremony does
  not itself require the signer to supply two distinct identification
  components at the moment of signing; it relies on the authenticated session.

### Impact

An organisation that treats TransTrack records as Part 11 electronic records
and needs legally binding electronic signatures cannot rely on this mechanism
alone for §11.200 compliance. It satisfies the §11.50 manifestation elements
(printed name, date and time, meaning) and supports §11.70 record linking.

### Why it is accepted

The mechanism is honest about what it is, and it does real work: it makes the
signed payload tamper-evident and binds meaning to identity. Implementing a
full §11.200 signing ceremony is a roadmap item, not a defect in what exists.
The previous position — the mapping asserting no signature capability at all
while `signRecord()` shipped — was the actual defect, and it has been
corrected.

### Compensating controls

| Control | Where |
| --- | --- |
| §11.200 status stated precisely, describing what is implemented and what is not | [`PART_11_CONTROL_MAPPING.md`](PART_11_CONTROL_MAPPING.md) §11.200 |
| Signature records are recomputable and verifiable | `verifySignature()` |
| Signing requires an authenticated session with RBAC enforcement at the IPC boundary | `electron/ipc/` |
| Signature creation is audit-logged in the immutable, hash-chained audit trail | `electron/services/auditChain.cjs` |
| Presence and shape of the mechanism asserted in tests | `tests/compliance.test.cjs` ("electronicSignature module exports signRecord", "electronic_signatures table migration exists") |

### Closure criteria

1. A signing ceremony requiring two distinct identification components at the
   moment of signing (session re-authentication plus TOTP) is implemented for
   signature-bearing operations.
2. Continuous-session signing rules per §11.200(a)(1)(i) are implemented and
   documented.
3. The Part 11 mapping is revised and the affected OQ cases are added and
   executed.
4. The deploying organisation makes the §11.100(c) certification to FDA, which
   remains its own responsibility in every case.

---

## RR-14 — The server tier is early access

| Field | Value |
| --- | --- |
| Affected findings | M-17 item 12 |
| Affected components | `server/` (Fastify, PostgreSQL, FHIR R4, SMART on FHIR v2, CDS Hooks 1.1, MLLP/TLS) |
| Severity if realised | 2 — Major |
| Status | **Open — accepted; scope limitation** |

### Description

The optional server tier is designated **early access**. Until this release
that designation appeared in the README but nowhere in the compliance
documentation, so a reader of the validation package alone would have taken
the server tier to be qualified on the same footing as the desktop
application. It is not.

What is verified: 27 server unit suites, 312 assertions, all passing in this
environment — covering the SMART patient compartment (29 assertions), SMART
scopes and authorisation, HL7 tenancy and de-duplication, MLLP framing, TLS
configuration and fail-closed behaviour, JWT handling, input schemas, CDS
registry and audit, Epic integration, and deployment hardening.

What is not verified: everything requiring a running PostgreSQL instance —
`server/test/integration/api.test.mjs`, `fhir.test.mjs`, `mllp.test.mjs`,
`mirth.test.mjs` — plus live RLS enforcement (RR-04), TLS termination against
a real certificate chain, and any behaviour under production load.

### Impact

A site deploying the server tier is deploying a component whose integration
behaviour has not been executed by the vendor for this release. The desktop
application in fully offline mode is unaffected.

### Why it is accepted

The tier is optional and is labelled early access. Sites requiring a fully
qualified integration surface should run the desktop application offline or
in thin-client mode against a server they have themselves qualified.

### Compensating controls

| Control | Where |
| --- | --- |
| Early-access designation now stated in the compliance package as well as the README | `docs/compliance/README.md`, `VALIDATION_PLAN.md` §2, `executed/OQ_TT-OQ-001.md` §2 |
| 312 unit assertions across 27 suites, executed and recorded | `executed/OQ_TT-OQ-001.md` §6 |
| Patient-compartment isolation enforced at the storage layer with 29 regression assertions (finding C-1) | `server/src/fhir/compartment.js`, `server/test/unit/patientCompartment.test.mjs` |
| FHIR transaction bundles authorise every entry (finding H-4) | `server/src/fhir/` |
| MLLP frame cap, idle timeout, connection cap; listener binds 127.0.0.1 by default (finding H-9) | `server/src/hl7/` |
| Integration suites supplied and runnable by the site | `server/test/integration/` |

### Closure criteria

1. The vendor stands up a PostgreSQL 16 instance in CI and runs the
   integration suites on every release.
2. A server-tier OQ section is added to the OQ protocol with cases traced to
   the integration suites.
3. RR-04 closes.
4. The early-access designation is removed from the README and the compliance
   package simultaneously, in one change.

---

## RR-15 — The security disclosure address is a placeholder

| Field | Value |
| --- | --- |
| Affected findings | L-13 |
| Affected components | `SECURITY.md`, `README.md` |
| Severity if realised | 3 — Moderate |
| Status | **Open — accepted; blocks commercial release** |

### Description

Finding L-13 recorded that the sole security-disclosure and support contact was
a consumer webmail address. Documentation now specifies role-based addresses on
the product domain (`security@transtrack.example`,
`support@transtrack.example`, `privacy@transtrack.example`) with a published
response SLA and a named escalation path.

**These addresses are not yet provisioned.** They are the specification of the
channel, not a working channel. The domain itself is not yet registered under
a legal entity.

### Impact

Until provisioning completes there is no monitored, role-based route for a
researcher to disclose a vulnerability. A disclosure sent to a personal
webmail address has no acknowledgement guarantee, no continuity if the
individual is unavailable, and no audit trail — which is precisely the
weakness L-13 identified.

### Why it is accepted

The channel design, SLA and escalation path are documented and can be
operationalised as soon as the domain exists. Documenting a placeholder that
is visibly a placeholder is preferable to documenting a personal address as if
it were an institutional one.

### Compensating controls

| Control | Where |
| --- | --- |
| Disclosure policy, SLA by severity, and escalation path published | `SECURITY.md` §Reporting a Security Issue |
| The placeholder is explicitly marked as not yet provisioned, with the interim route named | `SECURITY.md` |
| Anti-impersonation notice naming authorised channels | `SECURITY.md`, `README.md` |

### Closure criteria

1. The `transtrack` product domain is registered under the operating legal
   entity.
2. `security@`, `support@` and `privacy@` are provisioned as monitored
   distribution lists with at least two recipients each.
3. A `security.txt` is published at `/.well-known/security.txt` per RFC 9116.
4. `SECURITY.md` and `README.md` are updated to the live addresses and the
   placeholder notice is removed.
5. An acknowledgement test message is sent and answered within the published
   SLA, and the result is recorded.

---

## RR-16 — Reference data goes stale between OPTN publication cycles

| Field | Value |
| --- | --- |
| Affected findings | H-10 |
| Affected components | `electron/services/calculators/reference/*.json`, `referenceData.cjs` |
| Severity if realised | 3 — Moderate |
| Status | **Open — accepted; controlled by staleness gate** |

### Description

The KDPI and EPTS reference tables are derived from OPTN cohorts that are
refreshed annually. Between an OPTN refresh and the corresponding TransTrack
release, the shipped tables diverge from the authoritative ones. Both currently
carry `reviewBy: 2026-12-31`.

Finding H-10's substance was that this divergence was *guaranteed and silent*.
It is no longer silent, but it is still guaranteed: a table cannot be updated
before its successor is published.

### Impact

For the interval between an OPTN publication and a TransTrack release, KDPI
and EPTS percentiles reflect the prior reference cohort.

### Why it is accepted

The divergence is inherent to shipping a snapshot of externally owned annual
data. The control that matters is making it visible and time-bounded, which is
in place: past `reviewBy`, results are flagged `stale` with an overdue day
count, the disclaimer states the divergence risk, the health check degrades,
and the build fails.

### Compensating controls

| Control | Where |
| --- | --- |
| `reviewBy` on every externally owned table | `reference/*.json` |
| Past `reviewBy`: results flagged `stale` with overdue day count | `referenceData.cjs` |
| Past `reviewBy`: health check degrades | `electron/services/healthCheck.cjs`; `tests/healthCheck.test.cjs` |
| Past `reviewBy`: the build fails | `tests/calculatorReferenceVectors.test.cjs` |
| Absent or non-`ACTIVE` table: no score at all | `referenceData.cjs` |
| Change-control procedure for updating a table | [`CLINICAL_SOURCES.md`](CLINICAL_SOURCES.md) §3 |

### Closure criteria

This risk is controlled rather than closed. It is **reviewed** annually and
within 30 days of any OPTN policy notice affecting an entry. It is
**demonstrated controlled** when a `reviewBy` date has been allowed to pass in
a scratch build and the build has been observed to fail — a check the
deploying organisation may repeat as OQ evidence.

---

## 3. Approval

This statement is approved by role. Signature and date fields are completed at
site execution; the vendor does not pre-sign a document a site must adopt.

| Role | Responsibility | Signature | Date |
| --- | --- | --- | --- |
| Quality Assurance Officer | Owns this statement; confirms every entry has a closure criterion | _pending site execution_ | _pending site execution_ |
| Clinical Informatics Lead | Confirms RR-01, RR-02, RR-03, RR-07, RR-16 | _pending site execution_ | _pending site execution_ |
| Engineering Lead | Confirms RR-04, RR-06, RR-14 | _pending site execution_ | _pending site execution_ |
| Information Security Officer | Confirms RR-08, RR-09, RR-11, RR-12, RR-15 | _pending site execution_ | _pending site execution_ |
| Release Manager | Confirms RR-10 | _pending site execution_ | _pending site execution_ |

## 4. Change history

| Version | Date | Change | Author role |
| --- | --- | --- | --- |
| 1.0 | 2026-08-02 | Initial issue. Created in response to validation finding C-2(e); consolidates residual positions previously scattered across the clinical source register, the risk register and the security hardening document. | Quality Assurance Officer |
