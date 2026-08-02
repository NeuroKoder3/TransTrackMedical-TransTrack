# TransTrack — Operator Runbook

| Document ID | TT-RB-001 |
| --- | --- |
| Version | 2.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Information Security Officer |
| Audience | Site system administrator, IT operations, on-call operator |

This is the operational entry point for a TransTrack deployment. It is written
for a regulated environment: procedures that produce a compliance obligation
(backup, restore, key rotation, breach notification, drills) say what record
must be kept, not only what buttons to press.

**This document is an index and a set of routines. It is not the authority for
any of them.** Each procedure below names the controlling document. Where this
runbook and a controlling document differ, the controlling document governs.

> **Revision note.** Version 1 of this file was a Docker smoke-test procedure
> for the server tier and nothing else. The desktop procedures that a regulated
> deployment actually depends on — backup, restore, key rotation, breach
> notification, DR drills — existed elsewhere and were not reachable from here
> (finding I-5). The smoke test is retained in §7; everything else is new.

---

## 1. Which deployment are you operating?

| Deployment | What runs | Which sections apply |
|---|---|---|
| **Desktop only** (the normal case) | Electron app, local SQLCipher database on each workstation | §2–§6, §8–§10 |
| **Desktop + server tier** (early access) | The above, plus Fastify + PostgreSQL for FHIR / SMART / CDS Hooks / HL7 | All sections |

The server tier is **early access**. It is not covered by the vendor
Operational Qualification beyond unit-level verification, and a site deploying
it must extend its own qualification to cover it. See
[`docs/compliance/README.md`](docs/compliance/README.md#scope-and-product-maturity)
and residual risks RR-04 and RR-14 in
[`docs/compliance/RESIDUAL_RISK.md`](docs/compliance/RESIDUAL_RISK.md).

## 2. Procedure index

Every operational procedure a TransTrack site needs, and where it lives.

### Routine operations

| Procedure | Controlling document | Cadence |
|---|---|---|
| Daily application use, patient and donor workflows | [`docs/OPERATIONS_MANUAL.md`](docs/OPERATIONS_MANUAL.md) | Continuous |
| Administrative tasks (user creation, role changes, deprovisioning) | [`docs/OPERATIONS_MANUAL.md`](docs/OPERATIONS_MANUAL.md#administrative-tasks), [`docs/compliance/policies/ACCESS_CONTROL_POLICY.md`](docs/compliance/policies/ACCESS_CONTROL_POLICY.md) | As needed |
| Access review | [`docs/compliance/policies/ACCESS_CONTROL_POLICY.md`](docs/compliance/policies/ACCESS_CONTROL_POLICY.md) | Quarterly |
| Audit log review | [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) | Monthly |
| Data export and reporting | [`docs/OPERATIONS_MANUAL.md`](docs/OPERATIONS_MANUAL.md#data-export) | As needed |
| Desktop SSO (OIDC) configuration | [`docs/SSO_DESKTOP.md`](docs/SSO_DESKTOP.md) | At setup |

### Data protection

| Procedure | Controlling document | Cadence |
|---|---|---|
| Backup — objectives, retention, offsite copy | [`docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md`](docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md) (**normative**) | Automated every 24 h |
| Backup — how to run and verify | [`docs/DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md#backup-procedures) | Weekly verification |
| Restore — step by step | [`docs/DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md#recovery-procedures), [`docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md`](docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md) §3 | On demand |
| Restore failure triage | [`docs/runbooks/OPERATOR_TRIAGE.md`](docs/runbooks/OPERATOR_TRIAGE.md) §4 | On demand |
| Encryption key generation, storage, backup | [`docs/ENCRYPTION_KEY_MANAGEMENT.md`](docs/ENCRYPTION_KEY_MANAGEMENT.md) | At setup |
| Encryption key rotation | [`docs/ENCRYPTION_KEY_MANAGEMENT.md`](docs/ENCRYPTION_KEY_MANAGEMENT.md#key-rotation) | Per site policy, and after any suspected exposure |
| Key loss recovery | [`docs/ENCRYPTION_KEY_MANAGEMENT.md`](docs/ENCRYPTION_KEY_MANAGEMENT.md#key-loss-recovery) | On demand |
| Data retention and destruction | [`docs/compliance/policies/DATA_RETENTION_AND_DESTRUCTION.md`](docs/compliance/policies/DATA_RETENTION_AND_DESTRUCTION.md) | Per schedule |

### Incident and continuity

| Procedure | Controlling document | Cadence |
|---|---|---|
| Incident response — classification and handling | [`docs/compliance/policies/INCIDENT_RESPONSE_PLAN.md`](docs/compliance/policies/INCIDENT_RESPONSE_PLAN.md) (**normative**), [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md) (procedural) | On demand |
| Breach notification | [`docs/compliance/policies/BREACH_NOTIFICATION_POLICY.md`](docs/compliance/policies/BREACH_NOTIFICATION_POLICY.md) (**normative**), [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md#data-breach-notification) | On demand |
| Disaster recovery scenarios | [`docs/DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md#disaster-scenarios) | On demand |
| **DR restore drill** | §5 of this document | **Quarterly** |
| Reporting a vulnerability to the vendor | [`SECURITY.md`](SECURITY.md#reporting-a-security-issue) | On demand |

### Change and validation

| Procedure | Controlling document | Cadence |
|---|---|---|
| Applying an upgrade | [`docs/compliance/policies/CHANGE_MANAGEMENT_SOP.md`](docs/compliance/policies/CHANGE_MANAGEMENT_SOP.md), [`docs/DEPLOYMENT_CHECKLIST.md`](docs/DEPLOYMENT_CHECKLIST.md) | Per release |
| Site Installation Qualification | [`docs/compliance/templates/IQ_PROTOCOL_TEMPLATE.md`](docs/compliance/templates/IQ_PROTOCOL_TEMPLATE.md) | Per install |
| Site Operational Qualification | [`docs/compliance/templates/OQ_PROTOCOL_TEMPLATE.md`](docs/compliance/templates/OQ_PROTOCOL_TEMPLATE.md) | Per release |
| Site Performance Qualification | [`docs/compliance/executed/PQ_TT-PQ-001.md`](docs/compliance/executed/PQ_TT-PQ-001.md) | Before go-live |
| What the vendor has and has not qualified | [`docs/compliance/VALIDATION_SUMMARY_REPORT.md`](docs/compliance/VALIDATION_SUMMARY_REPORT.md) | Read before deploying |
| Pilot deployment sequencing | [`docs/PILOT_DEPLOYMENT_RUNBOOK.md`](docs/PILOT_DEPLOYMENT_RUNBOOK.md) | Once |

### Integration operations (server tier)

| Procedure | Controlling document |
|---|---|
| Failed FHIR subscription delivery | [`docs/runbooks/OPERATOR_TRIAGE.md`](docs/runbooks/OPERATOR_TRIAGE.md) §1 |
| Stuck bulk export | [`docs/runbooks/OPERATOR_TRIAGE.md`](docs/runbooks/OPERATOR_TRIAGE.md) §2 |
| EHR downtime (HL7 / FHIR source unavailable) | [`docs/runbooks/OPERATOR_TRIAGE.md`](docs/runbooks/OPERATOR_TRIAGE.md) §3 |
| Server database migration failure | [`docs/runbooks/OPERATOR_TRIAGE.md`](docs/runbooks/OPERATOR_TRIAGE.md) §5 |
| HL7 v2 / MLLP configuration | [`docs/server/hl7-integration.md`](docs/server/hl7-integration.md) |

## 3. Operating cadence

The recurring obligations, consolidated. Each row states the evidence a
surveyor will ask for — the activity without the record does not satisfy the
control.

| Cadence | Task | Evidence to retain | Owner role |
|---|---|---|---|
| Daily | Confirm the automated backup ran and is not overdue | Backup listing showing a backup within the last 24 h | System Administrator |
| Weekly | Verify backup integrity (`backup:create-and-verify`) | Verification output with SHA-256 digest | System Administrator |
| Weekly | Confirm at least one backup copy exists offsite | Offsite storage listing | System Administrator |
| Monthly | Audit log review — failed logins, break-glass PHI access, privilege changes | Signed review note naming the reviewer and period | Information Security Officer |
| Monthly | Test restore of a backup to a non-production host | Entry in the DR drill log (§5) | System Administrator |
| Quarterly | Access review — every account, role and enablement state | Signed access review record | Information Security Officer |
| Quarterly | **DR restore drill** | Entry in the DR drill log (§5) | System Administrator, approved by ISO |
| Quarterly | Review open residual risks for changes in status | Annotated copy of [`RESIDUAL_RISK.md`](docs/compliance/RESIDUAL_RISK.md) | Quality Assurance Officer |
| Per release | Change control record, site OQ re-execution for affected functions | Change record and executed OQ | Quality Assurance Officer |
| Annually | Full-host failure simulation | Entry in the DR drill log (§5) | System Administrator |
| Annually | Review and re-approve this runbook and its controlling documents | Approval signatures | Information Security Officer |

## 4. Startup and health checks

### 4.1 Desktop

On launch the application performs these checks before accepting a login.
A failure in any of them is a stop condition, not a warning.

| Check | Behaviour on failure |
|---|---|
| Database encryption verification | Fails closed in packaged builds — the application refuses to open an unverified database |
| Audit hash-chain verification | Chain break is surfaced; unhashed rows are flagged rather than skipped |
| Migration status | Application reports pending migrations; `pending: 0` is the expected steady state |
| License validity | Fail-closed with clock-skew protection |

Operator action on any failure: do not attempt to work around it. Stop, capture
the message, and follow [`docs/runbooks/OPERATOR_TRIAGE.md`](docs/runbooks/OPERATOR_TRIAGE.md).
A chain-verification failure is a potential integrity incident and is handled
under [`docs/compliance/policies/INCIDENT_RESPONSE_PLAN.md`](docs/compliance/policies/INCIDENT_RESPONSE_PLAN.md),
not as a routine fault.

### 4.2 First launch

The seeded administrator account `admin@transtrack.local` receives a one-time
setup token written to `userData/INITIAL_ADMIN_PASSWORD.txt` (mode `0600` on
POSIX) and to the application log. Rotate the password on first sign-in and
delete the token file. Confirm the deletion — the file is overwritten before
unlinking, but see the secure-delete limitation in
[`README.md`](README.md#security-architecture) and residual risk RR-08.

### 4.3 Server tier

```bash
curl http://localhost:8080/health
curl http://localhost:8080/.well-known/smart-configuration
curl http://localhost:8080/cds-services
```

All three return HTTP 200 with JSON when the tier is healthy.

## 5. Disaster recovery drill

Required quarterly by
[`docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md`](docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md) §4.
The objectives being tested are RTO ≤ 4 hours and RPO ≤ 24 hours.

### 5.1 Drill procedure

1. **Select the backup.** Choose the most recent automated backup. Record its
   filename, timestamp and SHA-256 digest before touching it. Do not use a
   backup created specially for the drill — a drill against a hand-made backup
   tests nothing about the routine backup path.
2. **Provision a clean host** meeting the IQ specification. It must not be the
   production workstation and must not have a TransTrack database already
   present.
3. **Start the clock.** Record the wall-clock time. This is the start of the
   RTO measurement.
4. **Install TransTrack** at the same version that produced the backup. A
   version mismatch across a major release requires a documented migration plan
   and turns the drill into a migration test — note it if so.
5. **Restore** the backup and supply the encryption key from key backup, not
   from the production host. Recovering the key is part of the drill: a restore
   that only works because the operator had the key in hand has not tested key
   custody.
6. **Verify:**
   - Integrity check passes.
   - Migration status reports `pending: 0`.
   - Audit chain verification passes on the restored database.
   - A pre-agreed sample of patient records is present and unmodified. Agree
     the sample and the expected values *before* the drill.
   - Record counts match the source within the expected RPO window.
7. **Stop the clock.** The elapsed time is the measured RTO.
8. **Compute the measured RPO:** the interval between the backup timestamp and
   the simulated failure time.
9. **Destroy the drill data.** The restored database contains production PHI.
   Wipe the drill host per
   [`docs/compliance/policies/DATA_RETENTION_AND_DESTRUCTION.md`](docs/compliance/policies/DATA_RETENTION_AND_DESTRUCTION.md).
   Record the destruction.
10. **Log the drill** in §5.3 and file any gap as a corrective action.

### 5.2 Drill log template

Copy this block into §5.3 for each drill. Do not delete previous entries;
the log is the evidence trail.

```
Drill ID:               DR-DRILL-YYYY-NNN
Date executed:          YYYY-MM-DD
Type:                   [Quarterly file-restore | Annual full-host failure]
TransTrack version:     
Executed by (role):     
Witnessed by (role):    
Approved by (role):     

Backup used
  Filename:             
  Created:              YYYY-MM-DD HH:MM
  SHA-256:              

Measurements
  Simulated failure at: YYYY-MM-DD HH:MM
  Restore started:      YYYY-MM-DD HH:MM
  Restore completed:    YYYY-MM-DD HH:MM
  Measured RTO:         __ h __ min      (objective: <= 4 h)   [MET | NOT MET]
  Measured RPO:         __ h __ min      (objective: <= 24 h)  [MET | NOT MET]

Verification
  Integrity check:              [PASS | FAIL]
  Migrations pending = 0:       [PASS | FAIL]
  Audit chain verification:     [PASS | FAIL]
  Sample records present:       [PASS | FAIL]  (n = ____ )
  Record counts within RPO:     [PASS | FAIL]
  Key recovered from backup
  custody, not production host: [PASS | FAIL]

Deviations and observations


Corrective actions raised
  ID | Description | Owner role | Due date


Drill data destruction
  Method:               
  Date:                 
  Confirmed by (role):  

Overall result:         [PASS | PASS WITH DEVIATIONS | FAIL]
```

### 5.3 Drill log

> **No disaster recovery drill has been executed for release 1.3.0.**
>
> This log is empty. Neither the vendor nor any deploying site has performed
> the quarterly restore drill against this release, so there is no evidence
> that a restore completes within the stated RTO, and the RTO in
> [`docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md`](docs/compliance/policies/BUSINESS_CONTINUITY_AND_DR.md)
> §1 is a design target rather than a demonstrated capability.
>
> The vendor cannot close this on a site's behalf: the drill requires the
> site's hardware, the site's key custody arrangements and the site's data.
> Executing a first drill is a precondition of Performance Qualification —
> see [`docs/compliance/executed/PQ_TT-PQ-001.md`](docs/compliance/executed/PQ_TT-PQ-001.md).
>
> Tracked as residual risk **RR-11** in
> [`docs/compliance/RESIDUAL_RISK.md`](docs/compliance/RESIDUAL_RISK.md).

| Drill ID | Date | Type | RTO measured | RPO measured | Result | Record |
|---|---|---|---|---|---|---|
| _none executed for 1.3.0_ | — | — | — | — | — | — |

## 6. Escalation

| Situation | First action | Escalate to |
|---|---|---|
| Application will not start; encryption verification fails | Stop; do not delete or replace the database file | Site System Administrator, then vendor `support@transtrack.example` |
| Audit chain verification fails | Treat as a potential integrity incident; preserve the database | Information Security Officer, per the Incident Response Plan |
| Suspected unauthorised PHI access | Do not investigate by browsing records; that generates further access events | Privacy Officer and Information Security Officer, per the Breach Notification Policy |
| Restore fails | [`docs/runbooks/OPERATOR_TRIAGE.md`](docs/runbooks/OPERATOR_TRIAGE.md) §4 | System Administrator, then vendor support |
| Suspected product vulnerability | [`SECURITY.md`](SECURITY.md#reporting-a-security-issue) | Vendor `security@transtrack.example` |
| Impersonation or unofficial download source | [`SECURITY.md`](SECURITY.md#trusted-distribution-and-impersonation-alerts) | Vendor `security@transtrack.example` |

Vendor addresses are role-based placeholders that are not yet provisioned; see
residual risk **RR-15**. Site escalation contacts are recorded by the site in
[`docs/DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md#contact-information).

## 7. Server tier — local bring-up and smoke test

Retained from version 1 of this runbook. This is a **development and
evaluation** procedure for the early-access server tier. It is not a production
deployment procedure, and Docker Compose is not a supported production topology.

### 7.1 Prerequisites

- Windows, macOS or Linux with **Docker Desktop** running.
- **Node.js 20.x or later** on the host — the smoke test runs from the host, not
  from a container.
- A clone of this repository.

### 7.2 First-time setup (or after `git pull`)

```bash
docker compose -f docker/docker-compose.yml build api
docker compose -f docker/docker-compose.yml up -d postgres api
docker exec transtrack-api node src/db/migrate.js up
```

| Step | Purpose |
|---|---|
| `build api` | Builds the API image from the current source. Rerun whenever server code changes — the container is **not** source-mounted in this compose file. |
| `up -d postgres api` | Starts PostgreSQL 16 and the Fastify API plus MLLP listener. Postgres is healthchecked; the API depends on it. |
| `migrate.js up` | Applies pending SQL migrations against the running database. |

Endpoints once up:

- REST → `http://localhost:8080`
- FHIR R4 → `http://localhost:8080/fhir`
- SMART OAuth → `http://localhost:8080/oauth2/*` and `.well-known/smart-configuration`
- CDS Hooks → `http://localhost:8080/cds-services`
- MLLP / HL7 v2 → `tcp://localhost:2575`

### 7.3 Run the end-to-end smoke test

```bash
node scripts/smoke-test.mjs
```

The script provisions a fresh organization and administrator, logs in, and
walks the integration surface. Expected runtime is about 5–10 seconds; success
prints `SMOKE TEST PASSED`.

A passing smoke test is not qualification evidence. It exercises reachability,
not correctness against requirements. Site OQ is the qualification instrument.

### 7.4 Epic on FHIR sandbox round-trip (optional)

Gated behind an environment variable so CI does not need access to Epic's
sandbox:

```bash
export EPIC_SANDBOX_CLIENT_ID="<your Epic non-production client id>"
node scripts/smoke-test.mjs
```

Requires `epic-keys/transtrack-epic-private.pem`, which is gitignored and must
be generated per environment. See
`server/src/integrations/epic/README.md` for the JWKS publishing pattern and
the matching Epic app configuration.

When enabled the smoke test additionally pulls a patient bundle from
`fhir.epic.com` using SMART Backend Services, POSTs it to
`/integrations/epic/import`, and re-queries the imported Patient through
TransTrack's own FHIR API. All records involved are Epic sandbox synthetic
records — see [`docs/TEST_DATA_PROVENANCE.md`](docs/TEST_DATA_PROVENANCE.md).

### 7.5 Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` from the smoke test | Postgres container is not running | `docker compose -f docker/docker-compose.yml up -d postgres` |
| `relation "smart_clients" does not exist` (or `fhir_resources`, etc.) | Migrations not applied | `docker exec transtrack-api node src/db/migrate.js up` |
| `/.well-known/smart-configuration` or `/cds-services` returns 401 | Stale API image, built before the SMART/CDS routes were added | `docker compose -f docker/docker-compose.yml build api && docker compose -f docker/docker-compose.yml up -d api` |
| `Body cannot be empty when content-type is set to 'application/json'` | A JSON content-type sent with no body | Drop `Content-Type: application/json` on body-less POSTs |
| Epic sandbox returns `invalid_client` / `unauthorized_client` | The Epic app is still in Draft, the JWKS URL is not in the **Non-Production** field, or Epic has not refetched the JWKS | Open the app at `fhir.epic.com`, confirm the Non-Production JWK Set URL, click **Save & Ready for Sandbox**, wait about 60 seconds, retry |

### 7.6 Tearing down

```bash
docker compose -f docker/docker-compose.yml down
```

Add `-v` to drop the Postgres volume as well. That wipes all data including
applied migrations, so §7.2 must be rerun.

## 8. Deeper references

- [`server/README.md`](server/README.md) — backend service architecture
- `server/src/integrations/epic/README.md` — Epic on FHIR module
- [`docs/server/hl7-integration.md`](docs/server/hl7-integration.md) — HL7 v2 / MLLP details
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — threat model
- [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) — configuration reference

## 9. Known operational limitations

These are stated here so an operator meets them in the runbook rather than in
an incident. Each links to a formal residual-risk entry in
[`docs/compliance/RESIDUAL_RISK.md`](docs/compliance/RESIDUAL_RISK.md).

| Limitation | Operational consequence | Risk ID |
|---|---|---|
| No DR drill has been executed for this release | The RTO is unproven. Execute a drill before go-live. | RR-11 |
| Secure delete does not guarantee erasure on SSD, copy-on-write or snapshotted volumes | Rely on full-disk encryption and cryptographic erase at decommissioning, not on the application's overwrite. | RR-08 |
| PELD is not computed | Pediatric liver candidates have no PELD reference score. Use the OPTN calculator. | RR-01 |
| The lung score is the internal TTLI, not the OPTN LAS | Do not report it as an LAS. Obtain a real LAS or CAS from UNet. | RR-07 |
| KDPI and EPTS percentiles are approximations | Treat the percentile as indicative; the raw index is the reliable output. | RR-03 |
| Inactivation risk probabilities are not fitted to observed outcomes | Recalibrate against your own cohort during PQ before acting on the probabilities. | RR-02 |
| Installers may be unsigned | Verify the published SHA-256 digest before installing. | RR-10 |
| Server-tier RLS is not verified against a live PostgreSQL instance | A site deploying the server tier should verify cross-tenant isolation itself. | RR-04 |
| No independent penetration test or SOC 2 attestation exists | Factor this into your own vendor risk assessment. | RR-09 |

## 10. Approval

| Role | Signature | Date |
|---|---|---|
| Information Security Officer | _pending site execution_ | _pending site execution_ |
| Quality Assurance Officer | _pending site execution_ | _pending site execution_ |
| Operations Director | _pending site execution_ | _pending site execution_ |

Signature fields are completed by the deploying organization on adoption. The
vendor issues this runbook as a controlled document; it becomes binding on a
site when that site's role holders sign it.

## Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.0 | — | Docker Compose bring-up and smoke-test procedure for the server tier. | Engineering Lead |
| 2.0 | 2026-08-02 | Rewritten as an operational runbook for a regulated deployment in response to finding I-5. Added a procedure index covering desktop backup, restore, key rotation, incident response and breach notification, which previously were not reachable from this file; an operating cadence with the evidence each control requires; startup health checks and their stop conditions; a disaster recovery drill procedure and log template with an explicit statement that no drill has been executed for this release (RR-11); an escalation table; and a known-limitations table linked to the residual risk register. The original Docker smoke test is retained as §7 and marked as an evaluation rather than production procedure. | Information Security Officer |
