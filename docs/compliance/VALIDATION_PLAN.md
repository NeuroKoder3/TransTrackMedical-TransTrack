# TransTrack Validation Plan

| Document control | |
|---|---|
| Document ID | TT-VP-001 |
| Version | 2.0 |
| Status | **Approved and in force** |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 (desktop application; server tier early access, see §2) |
| Supersedes | TT-VP-001 v1.0 (status "Template — to be ratified"), and `docs/VALIDATION_ARTIFACTS.md` v1.0.1 in its entirety |
| Author role | Engineering Lead |
| Approver roles | Quality Assurance Officer (owner), Clinical Informatics Lead, Information Security Officer |
| Next periodic review | 2027-08-02, or on the next minor release, whichever is sooner |

> **Read this first.** This plan is ratified and in force. It is **not** a
> statement that TransTrack 1.3.0 is validated for production clinical use.
> Validation completes in two parts, and only the first is finished:
>
> | Part | Owner | Status for 1.3.0 |
> |---|---|---|
> | Vendor software verification — IQ (vendor portion) and OQ | TransTrack Medical Software | **Complete.** See [`executed/IQ_TT-IQ-001.md`](executed/IQ_TT-IQ-001.md) and [`executed/OQ_TT-OQ-001.md`](executed/OQ_TT-OQ-001.md). |
> | Site qualification — IQ (host portion) and PQ | Deploying organization | **Not started.** PQ requires clinical users, site data and site infrastructure, none of which the vendor has. See [`executed/PQ_TT-PQ-001.md`](executed/PQ_TT-PQ-001.md). |
>
> The distinction is restated on the first page of every document in this
> package. A deploying organization that puts TransTrack into production
> without completing the second part has an incomplete validation package.

## 1. Purpose

This Validation Plan describes the activities, roles, deliverables, and
acceptance criteria for validating TransTrack as fit for its intended use.

It covers both parties. §4 states which artifacts the **vendor** produces and
has executed for release 1.3.0, and which the **deploying organization** must
execute within its own quality management system. Ratifying this plan is the
vendor's commitment to the first set; adopting it is the deploying
organization's commitment to the second.

## 2. Scope

### 2.1 In scope for this release

| Component | Qualification status for 1.3.0 |
|---|---|
| TransTrack desktop application (Electron 39) and its embedded SQLCipher database | Vendor OQ executed; site IQ and PQ pending |
| All bundled IPC handlers, services, calculators and migrations | Vendor OQ executed |
| Backup, restore, audit logging, MFA and SIEM forwarding subsystems | Vendor OQ executed; restore **drill** not executed (RR-11) |
| Clinical reference calculators (MELD family, KDPI/KDRI, EPTS, TTLI) | Vendor OQ executed against the controlled source register; PELD unavailable (RR-01) |
| Release pipeline: SBOM, dependency gate, signing and notarization logic | Vendor OQ executed; signing credentials not procured (RR-10) |

### 2.2 Early access — in scope, qualified to a lower standard

The optional **server tier** (`server/`: Fastify, PostgreSQL, FHIR R4, SMART on
FHIR v2, CDS Hooks 1.1, MLLP/TLS HL7 v2) is designated **early access**. Its
unit suites are executed and recorded in the vendor OQ; its integration suites
require a running PostgreSQL instance and were **not** executed in the vendor
verification environment. Row-level security is verified at the DDL and
application-query level only.

Until now that designation appeared in `README.md` but not in this package,
which meant a reader of the validation documents alone would have taken the
server tier to be qualified on the same footing as the desktop application. It
is not. See [`RESIDUAL_RISK.md`](RESIDUAL_RISK.md) entries RR-04 and RR-14.

A site requiring a fully qualified integration surface should run the desktop
application offline, or qualify the server tier itself against its own
PostgreSQL instance using the supplied integration suites.

### 2.3 Out of scope

* The customer's host operating system, identity provider, network, and SIEM —
  validated by the customer's IT department under their own SOPs.
* Clinical decision-making — TransTrack is an operational/coordination system and
  does not perform allocation or diagnosis.
* Any determination of HIPAA compliance, Part 11 compliance, or FDA device
  status. Those are organizational and regulatory determinations, not product
  attributes, and this plan does not make them.

## 3. Regulatory framework

| Framework | Applicability |
|---|---|
| HIPAA Security Rule (45 CFR §164.308 / .310 / .312) | Applies. See `HIPAA_SECURITY_RULE_MAPPING.md`. |
| HIPAA Privacy & Breach Notification Rules (45 CFR §164.500 / 164.400) | Customer responsibility; supported by audit logs and breach-notification policy. |
| 21 CFR Part 11 | Applies if the customer treats TransTrack records as 21 CFR Part 11 electronic records. See `PART_11_CONTROL_MAPPING.md`. |
| 21 CFR §860 / §820 (Quality System Regulation) | Customer-dependent — see `FDA_DEVICE_RATIONALE.md`. |
| OPTN Policies / 42 CFR §121 | Operational; TransTrack does not perform UNet-equivalent allocation. |
| GAMP 5 | TransTrack is treated as **Category 4 (configurable)** software. |
| ISO 14971 | Risk management framework adopted in `RISK_REGISTER.md`, `FMEA.md` and `RESIDUAL_RISK.md`. |
| ISO/IEC 27001 / SOC 2 | Customer-dependent attestation. |

No AATB mapping is claimed. Earlier revisions of the marketing and compliance
documentation asserted alignment with AATB Standards for Tissue Banking; no
control mapping to those standards has ever existed in this package, and the
claim has been removed rather than retrospectively constructed. A deploying
tissue bank requiring AATB alignment must perform that mapping itself.

## 4. Validation lifecycle

We adopt a V-model with explicit traceability between left-leg (specification) and
right-leg (verification) artifacts:

```
URS  ─────────────────────────────────────────────►  PQ
   SRS  ──────────────────────────────────►  OQ
       SDS  ────────────────────►  IQ
```

| Stage | Artifact | Owner | Required? | Status for 1.3.0 |
|---|---|---|---|---|
| User Requirements | `SYSTEM_REQUIREMENTS_SPECIFICATION.md` | Customer + Vendor | Yes | Issued |
| System Requirements | `SYSTEM_REQUIREMENTS_SPECIFICATION.md` | Vendor | Yes | Issued |
| Design | `SOFTWARE_DESIGN_SPECIFICATION.md` | Vendor | Yes | Issued |
| Traceability | `TRACEABILITY_MATRIX.md` | Vendor | Yes | Issued; machine-checked by `scripts/check-compliance-docs.mjs` |
| Clinical source control | `CLINICAL_SOURCES.md` | Vendor (Clinical Informatics Lead) | Yes | Issued |
| Risk Analysis | `RISK_REGISTER.md` | Customer + Vendor | Yes | Issued |
| Failure Mode Analysis | `FMEA.md` | Vendor | Yes | Issued |
| Residual Risk Statement | `RESIDUAL_RISK.md` | Vendor (QA) | Yes | Issued |
| Installation Qualification — vendor portion | `executed/IQ_TT-IQ-001.md` §4 | Vendor | Per release | **Executed 2026-08-02** |
| Installation Qualification — host portion | `executed/IQ_TT-IQ-001.md` §5 | Customer | Per install | **Not executed** — site obligation |
| Operational Qualification — automated | `executed/OQ_TT-OQ-001.md` | Vendor | Per release | **Executed 2026-08-02** |
| Operational Qualification — interactive | `templates/OQ_PROTOCOL_TEMPLATE.md` | Customer | Per major release | **Not executed** — site obligation |
| Performance Qualification | `executed/PQ_TT-PQ-001.md` | Customer | Per major release | **Not executed** — site obligation |
| Vendor Validation Summary | `VALIDATION_SUMMARY_REPORT.md` | Vendor (QA) | Per release | **Issued 2026-08-02** |
| Site Validation Summary | `VALIDATION_SUMMARY_REPORT_TEMPLATE.md` | Customer (QA) | Per major release | **Not executed** — site obligation |
| Periodic Review | _customer SOP_ | Customer (QA) | Annually | Not yet due |

The split between the vendor and customer portions of IQ and OQ is not a
convenience. IQ verifies the installation on a host, and the vendor has no
site host; OQ verifies each requirement against a running build, and a
substantial part of that verification is automated and reproducible while the
remainder requires a human at a screen. Recording which half was executed by
whom, on what, is what makes the package auditable.

## 5. Roles and responsibilities

Roles are named by title throughout this package. No individual is named in
any vendor-issued validation document, and no vendor document is pre-signed on
a site's behalf.

| Role | Party | Responsibility |
|---|---|---|
| Quality Assurance Officer | Vendor | Owns this plan, the Residual Risk Statement and the vendor Validation Summary Report; approves the vendor OQ record. |
| Engineering Lead | Vendor | Maintains SRS, SDS, traceability matrix, FMEA and regression suites; executes the vendor IQ and OQ. |
| Clinical Informatics Lead | Vendor | Owns the controlled clinical source register; approves any change to a clinical constant or reference table. |
| Information Security Officer | Vendor | Owns the security control set, the dependency-vulnerability gate and the disclosure channel. |
| Release Manager | Vendor | Provides release notes, signed installers, SBOM and test summaries. |
| Customer Quality Assurance Officer | Customer | Adopts this plan, signs the site Validation Summary Report, owns periodic review. |
| Customer Transplant Administrator | Customer | Approves URS, executes PQ scenarios, owns site training records. |
| Customer IT / Security | Customer | Executes and approves the host portion of IQ; owns infrastructure (OS, network, SIEM, IdP, PostgreSQL). |

## 6. Acceptance criteria

Two distinct determinations exist, and they must not be conflated.

### 6.1 Vendor release verification — the criteria for shipping a release

A release may be **issued by the vendor** when all of the following are true.
All were true for 1.3.0 on 2026-08-02; the evidence is in
[`VALIDATION_SUMMARY_REPORT.md`](VALIDATION_SUMMARY_REPORT.md).

1. SRS, SDS, Risk Register, FMEA and Traceability Matrix are current, and the
   deltas from the previous release are documented.
2. Every cross-reference in the package resolves — machine-checked by
   `scripts/check-compliance-docs.mjs`, which runs in the standard test group.
3. The vendor portion of IQ is executed and recorded, with every non-executed
   step carrying a reason and a named executing party.
4. The automated OQ is executed with no failing suite, and every OQ case cites
   a test file that exists on disk.
5. Every clinical constant is traceable to an entry in `CLINICAL_SOURCES.md`,
   and no reference table is past its `reviewBy` date.
6. The dependency-vulnerability gate passes, with any accepted finding
   documented and unexpired.
7. Residual risks are stated in `RESIDUAL_RISK.md`, each with a closure
   criterion and a closure owner.

### 6.2 Site validation — the criteria for production clinical use

A release is **validated for production use at a site** when all of the
following are true. **None of these can be satisfied by the vendor**, and none
were satisfied for 1.3.0 at the time of issue.

1. §6.1 is satisfied for the release under consideration.
2. The host portion of IQ has been executed on each target machine and 100% of
   Mandatory checks pass.
3. The interactive portion of OQ has been executed and 100% of test cases
   marked **Mandatory** pass.
4. PQ has been executed against the customer's representative workflow with no
   unresolved Severity 1 or Severity 2 defects (per `RISK_REGISTER.md`).
5. Every residual risk in `RESIDUAL_RISK.md` whose closure owner is the
   deploying organization has been closed, or has been accepted in writing by
   the Customer Quality Assurance Officer.
6. A restore drill has been executed and recorded
   (`templates/DR_DRILL_LOG_TEMPLATE.md`), and measured recovery time and
   recovery point are within the objectives in `docs/DISASTER_RECOVERY.md`.
7. The site Validation Summary Report is signed by the Customer Quality
   Assurance Officer.
8. The signed report and supporting evidence are stored in the customer's
   document control system for the retention period defined in
   `policies/DATA_RETENTION_AND_DESTRUCTION.md`.

## 7. Change control during validation

Any change to the system after IQ but before VSR sign-off invokes the change-control
SOP (`policies/CHANGE_MANAGEMENT_SOP.md`). Patches that fix non-validated
functionality may proceed under "delta validation" (re-run only impacted OQ/PQ
sections).

## 8. Periodic review

The Quality Assurance Officer shall conduct a documented periodic review at least
annually covering:
* Audit log integrity sample
* Backup restore drill (per BCDR policy)
* Access review (RBAC + MFA enrollment)
* Open risks vs. mitigations
* CVE / security advisories impacting bundled components (Node.js, Electron,
  SQLCipher, etc.)

## 9. Supporting standards

* GAMP 5 (ISPE, 2nd ed.)
* ISO 14971:2019 — Risk management for medical devices
* IEC 62304 — Software lifecycle for medical device software (informational; not
  invoked unless customer treats TransTrack as a medical device)
* NIST SP 800-66 Rev. 2 — Implementing the HIPAA Security Rule
* NIST SP 800-88 Rev. 1 — Media sanitization (invoked by FMEA action A-01)

## 10. Approval

Approved by role. Signature and date fields for the customer roles are
completed on adoption; the vendor does not pre-sign on a site's behalf.

| Role | Party | Approves | Signature | Date |
|---|---|---|---|---|
| Quality Assurance Officer | Vendor | This plan; §6.1 satisfied for 1.3.0 | _pending site execution_ | _pending site execution_ |
| Engineering Lead | Vendor | §4 artifacts and their execution status | _pending site execution_ | _pending site execution_ |
| Clinical Informatics Lead | Vendor | §2.1 calculator scope and the clinical source register | _pending site execution_ | _pending site execution_ |
| Information Security Officer | Vendor | §3 security framework applicability | _pending site execution_ | _pending site execution_ |
| Customer Quality Assurance Officer | Customer | Adoption of this plan into the site QMS | _pending site execution_ | _pending site execution_ |

## 11. Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.0 | — | Initial issue as a template pending ratification. | Engineering |
| 2.0 | 2026-08-02 | **Ratified.** Status moved from "Template — to be ratified" to Approved and in force, with an effective date and named approver roles. Scope bound to release 1.3.0. Server tier explicitly designated early access within the compliance package (previously only in the README). Acceptance criteria split into vendor release verification (§6.1, satisfied) and site validation (§6.2, not satisfied). FMEA, Residual Risk Statement and the executed IQ/OQ/PQ records added to §4. AATB claim removed. Issued in response to validation finding C-2(a). | Engineering Lead |
