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

## Files

| File | Purpose |
|---|---|
| `client.js` | Pure SMART Backend Services client (sign JWT, exchange for token, FHIR GET). |
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
