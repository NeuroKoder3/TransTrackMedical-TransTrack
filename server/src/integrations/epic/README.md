# Epic on FHIR Integration

This module connects TransTrack to **Epic on FHIR** using **SMART on FHIR
Backend Services** (`client_credentials` + JWT-bearer assertion). It is the
production-shape pull path: Epic → TransTrack.

It has been **verified end-to-end against the Epic Developer Sandbox**
([https://fhir.epic.com](https://fhir.epic.com)) using the test patient
*Camila Maria Lopez* (Patient ID `erXuFYUfucBZaryVksYEcMg3`). The granted
scope set is:

```
system/AllergyIntolerance.read system/Condition.read system/Encounter.read
system/Immunization.read       system/MedicationRequest.read
system/Observation.read        system/Organization.read
system/Patient.read            system/Procedure.read
```

A successful round-trip pulls demographics, lab observations, problem-list
conditions, medication requests, and allergies in a single call.

## Write-back (DocumentReference)

`client.createDocumentReference()` files a document into a patient's chart.
It is **not** part of the default configuration and requires deliberate
enablement on both sides.

**Why it is off by default.** `DOCUMENT_WRITE_SCOPE`
(`system/DocumentReference.write`) is excluded from `DEFAULT_SCOPES`. Asking
for write access an application does not use fails customer security review,
and it changes what a customer's Epic administrator is being asked to approve.
A caller that intends to file documents opts in explicitly:

```js
createEpicClient({
  ...,
  scope: `${DEFAULT_SCOPES} ${DOCUMENT_WRITE_SCOPE}`,
});
```

**`fhirPost` does not retry.** `fhirGet` replays 5xx and 429 responses, which
is safe for an idempotent read. A create is different: Epic may have persisted
the resource before the response failed, so a replay can file a second copy of
a clinical document into a patient's chart. Callers needing at-most-once
semantics supply their own guard — TransTrack's IOTA pipeline uses the
notification idempotency key, which is carried into
`DocumentReference.identifier` so a site can reconcile what was filed.

### What a pilot site must do

Scope grant alone is not sufficient. Epic gates `DocumentReference.Create`
per customer, so sandbox success does not imply production capability.

1. **Register the app** in the customer's Epic environment and add the write
   scope to the request.
2. **Ask their Epic/interface team to enable `DocumentReference.Create`** for
   the app. This is a per-organisation configuration change on their side.
3. **Agree the document type mapping.** There is no correct default. The
   desktop module suggests LOINC `74213-0` (*Transplant summary note*) purely
   as a starting point; the operative coding is whatever their team maps, and
   guessing produces documents that land in the wrong part of the chart.
4. **Confirm the patient identity mapping** between the TransTrack record and
   the Epic FHIR patient id.

Until all four are done, the desktop application can still demonstrate
readiness: `electron/services/chartFiling.cjs` builds and validates the exact
`DocumentReference` that would be sent and transmits nothing (`dry_run`), and
a site filing notices by another route records that as a `manual` filing so
the obligation is not left looking unmet.

**An alternative that avoids write scopes entirely:** many centres prefer to
route the document through their existing interface engine as an HL7
`MDM^T02`. The schema supports this (`chart_write_channel = 'hl7_mdm_t02'`),
and for a site with an established engine it is often the faster path to
production than a new Epic write approval.

## Files

| File | Purpose |
|---|---|
| `client.js` | Pure SMART Backend Services client (sign JWT, exchange for token, FHIR GET/POST). |
| `importPatient.js` | Persist an Epic bundle into the native `patients` table + `fhir_resources` + audit log. |
| `index.js` | Re-exports for `require('./integrations/epic')`. |

## HTTP route

`POST /integrations/epic/import` (registered by `routes/integrations.js`).

Two body shapes are accepted:

```jsonc
// Server-fetch mode (server uses configured Epic creds)
{ "epicPatientId": "erXuFYUfucBZaryVksYEcMg3" }

// Bundle mode (caller supplies the FHIR data, server persists)
{ "bundle": {
    "patient":              { "resourceType": "Patient", ... },
    "observations":         [ ... ],
    "conditions":           [ ... ],
    "medicationRequests":   [ ... ],
    "allergies":            [ ... ],
    "scopeGranted":         "system/Patient.read ..."
} }
```

Response shape:

```json
{
  "patient": { "id": "...", "mrn": "...", "first_name": "...", "last_name": "..." },
  "created": true,
  "stored": {
    "observations": 6,
    "conditions": 1,
    "medicationRequests": 1,
    "allergies": 1
  },
  "scopeGranted": "system/Patient.read ..."
}
```

## Server config

Set the following in `server/.env` to enable server-fetch mode:

```bash
EPIC_SANDBOX_CLIENT_ID=<your Epic non-production client id>
EPIC_PRIVATE_KEY_FILE=epic-keys/transtrack-epic-private.pem
EPIC_TOKEN_URL=https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token
EPIC_FHIR_BASE=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
EPIC_KID=transtrack-epic-1
EPIC_SCOPE="system/AllergyIntolerance.read system/Condition.read ..."
```

If `EPIC_SANDBOX_CLIENT_ID` is unset, the route still accepts **bundle mode**
calls (e.g. from a SMART app that already holds the data).

## Smoke test

`scripts/smoke-test.mjs` exercises the round-trip behind an env-var gate:

```bash
$env:EPIC_SANDBOX_CLIENT_ID = "<your-client-id>"
node scripts/smoke-test.mjs
```

When the gate is unset the smoke test prints
`Epic round-trip: SKIPPED (set EPIC_SANDBOX_CLIENT_ID to enable)` and
continues with the rest of the suite.

## Standalone CLI

`scripts/epic-sandbox-test.mjs` is a thin shell over this module that prints a
human-readable summary of the test patient.
