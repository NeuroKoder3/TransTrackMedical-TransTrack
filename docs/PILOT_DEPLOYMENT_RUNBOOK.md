# Pilot Deployment Runbook

This runbook walks a customer-facing deployment lead through standing
up TransTrack at a single transplant centre for a 60-90 day pilot.
It assumes the program decision-makers have already reviewed
`docs/STRATEGIC_FIT.md`, the BAA template at
`docs/compliance/policies/BAA_TEMPLATE.md`, and the HECVAT pre-fill at
`docs/compliance/HECVAT_PREFILL.md`.

---

## Phase 0 — Before you sign anything

| Item | Owner | Status gate |
|------|-------|-------------|
| Customer InfoSec questionnaire (HECVAT or equivalent) returned | Vendor | Customer InfoSec sign-off |
| Business Associate Agreement executed | Both, via legal counsel | Signed PDF on file |
| Cyber-liability insurance certificate of evidence | Vendor | Provided to customer |
| Independent third-party penetration test report | Vendor | Provided to customer (or a documented gap-closure plan) |
| Pilot scope of work signed | Both | Signed SOW on file |

If any of the above is "in flight" rather than "complete" at signing
time, the SOW must include a milestone deadline for closure. **Do not
deploy on a customer's production network without a signed BAA.**

---

## Phase 1 — Pre-flight (vendor)

1. **Cut a signed release.**

   ```powershell
   $env:TRANSTRACK_SIGN_MODE = "ssl_esigner"
   # ...other ESIGNER_* / APPLE_* env vars per docs/CODE_SIGNING.md...
   npm ci
   npm run release:check:strict
   npm run build:win
   ```

   Confirm the artifact in `release/enterprise/` carries a valid
   Authenticode signature:

   ```powershell
   Get-AuthenticodeSignature .\release\enterprise\TransTrack-Enterprise-*-x64.exe
   ```

   Status must be `Valid`.

2. **Bundle the customer artefact set.**

   - Signed `.exe` installer
   - SHA-256 digest of the installer (provided to customer's IT for
     out-of-band verification)
   - `RELEASE_NOTES.md`
   - Vendor-side support contacts and SLA reminder
   - Reference to the executed BAA

3. **Open a customer-specific runbook channel.**

   A shared, encrypted-at-rest channel (Slack Connect, secure email
   with TLS, or customer's preferred mechanism) for go-live coordination.

---

## Phase 2 — Pilot site setup (customer IT, vendor support)

### 2.1 Workstations

For each pilot workstation:

1. Customer IT installs the signed `.exe`.
2. First-launch creates the encrypted SQLite database in the user's
   AppData folder. The customer chooses the master encryption
   passphrase per workstation (single-user mode) or per organisation
   (single-instance, shared workstation mode).
3. Vendor representative confirms the org_id record was created and
   the first admin user can log in.
4. Vendor representative runs the in-app health check
   (`Settings → System → Diagnostics`) and screenshots the result for
   the customer's records.

### 2.2 Roles and users

Customer admin creates initial users via `Admin → Users`:

- 1 admin (transplant programme manager)
- 2-4 coordinators
- 1 regulator (read-only access; for compliance staff)

MFA should be enabled at the org level via
`Admin → Security → Require MFA for new logins`.

### 2.3 Optional integrations

The pilot **does not require** Epic / FHIR / HL7 integration to deliver
operational value — the inactivation prevention engine works on
manually-entered or CSV-imported patient data. If the customer wants
integration, schedule it as a Phase 3 add-on (see below).

---

## Phase 3 — First 14 days

### 3.1 Data load

- Either bulk import via `File → Import → Patient CSV` (sample
  template at `assets/sample-imports/patient-roster-template.csv`),
  or manual entry by the coordinator team.
- Vendor representative reviews the inactivation risk distribution
  (`Risk → Center Overview`) and confirms it matches the centre's
  intuition. Any obvious anomalies are documented and either
  attributed to data quality or fed back into the engine roadmap.

### 3.2 Baseline action queue

- On Day 1 of going live, a coordinator generates the first
  `actionQueue:build` report. This is the *baseline*: top-N at-risk
  patients with one concrete recommended intervention each, before
  the centre has executed any TransTrack-driven action.
- Save (or print) the baseline. It is the comparison point for the
  pilot retrospective.

### 3.3 Daily rhythm

| Time | Who | Action |
|------|-----|--------|
| 08:00 | Coordinator | Open the action queue. Pick the top 5 entries; either accept the recommended intervention or override with a written justification. |
| End of action | Coordinator | Use the patient page → "Record intervention" → log what was done. The system snapshots the engine score *at the moment of action*. |
| Weekly | Coordinator | "Re-assess" each patient with a recorded intervention; system records the measured "after" score and computes the delta. |
| Monthly | Programme manager | Open `Manager → Prevention Digest` and review center-level metrics, intervention effectiveness, and coordinator load. |

---

## Phase 4 — Days 15-60

- Vendor support meets the programme manager weekly to review the
  Prevention Digest and any incidents.
- Vendor monitors `Health → System` health-check output (provided
  by the customer's IT contact) for any unexpected component status.
- Any defect is logged as a GitHub issue against the customer's
  pilot issue label (e.g., `pilot:hospital-x`). Severity SLAs per the
  signed SOW.

---

## Phase 5 — Pilot retrospective (Day 60-90)

The pilot retrospective is a single deliverable: a side-by-side
comparison of:

1. **Baseline action queue** (Day 1)
2. **Final action queue** (Day 60-90)
3. **Recorded interventions** and their measured effectiveness
4. **Inactivations the centre would have expected** (from `projectCenterImpact`)
   versus inactivations the centre actually saw during the pilot
5. **Coordinator-load and overload metrics**

The success criterion is documented in the SOW. A typical pilot
target: a measurable reduction in expected inactivations, OR a
documented improvement in time-to-intervention for high-risk patients.

If the success criterion is met, the customer signs an annual
subscription. If not, vendor and customer review the gap and either
agree to an extended pilot or terminate cleanly per the SOW.

---

## Optional: Phase 3 add-on — Epic / FHIR integration

Pre-requisites:

1. Customer's Epic Connection Hub team has registered the TransTrack
   application as a Backend Systems app and provided a Production
   Client ID for the customer's instance.
2. Customer has installed the optional server tier (Docker, see
   `RUNBOOK.md`) and customer IT has provided a TLS endpoint that
   Epic Production can reach (this is the only piece that is *not*
   offline-first).
3. Vendor has populated the multi-tenant Epic registry with the
   customer's `clientId`, `tokenUrl`, `fhirBase`, and `privateKeyFile`
   per `docs/ENVIRONMENT_VARIABLES.md`.

Smoke verification: vendor invokes `epic.createEpicClientForCustomer({
orgId: '<customer>', environment: 'sandbox' })` and confirms a token
exchange + a single `Patient` GET succeed against the customer's
Epic non-production environment before flipping to `prod`.

---

## Escalation matrix

| Severity | Definition | Vendor response |
|----------|------------|-----------------|
| S1 | Data loss, encryption failure, audit log corruption, or any inability to log in | 1 hour acknowledgement, 4 hour mitigation |
| S2 | Risk engine produces clearly incorrect output, or a feature blocking the daily coordinator workflow is unusable | 4 hour ack, 24 hour fix or workaround |
| S3 | Defect with workaround, or a UX issue | 1 business day ack, fixed in next release |
| S4 | Enhancement request | 1 business week ack, prioritised per roadmap |
