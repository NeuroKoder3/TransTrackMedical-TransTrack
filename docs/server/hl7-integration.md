# Hospital Integration Guide (HL7 v2 + FHIR R4 + SMART + CDS Hooks)

This guide explains how to verify TransTrack's hospital integration
end-to-end and how to wire it into the major US EHRs (Epic, Cerner/Oracle
Health, Meditech, Allscripts/Veradigm, athenahealth, NextGen, eClinicalWorks).

## What we're testing

```
┌─────────────────┐         MLLP/TLS          ┌──────────────────────┐
│ Hospital engine │  ─────────────────────▶   │ TransTrack listener  │
│  (Mirth/Rhapsody│  ◀───────────  MSA|AA     │   :2575              │
│   Cloverleaf)   │                           └──────────────────────┘
└─────────────────┘
       │                                       ┌──────────────────────┐
       │ FHIR R4 (REST/HTTPS)                  │ TransTrack /fhir/... │
       └──────────────────────────────────────▶│ /oauth2/...          │
                                               │ /cds-services/...    │
                                               └──────────────────────┘
```

Real production deployments wrap MLLP in TLS with mutual cert auth.
For local testing we use plaintext MLLP for simplicity, but the
production code path is the same — just set
`HL7_MLLP_TLS_CERT_FILE` / `HL7_MLLP_TLS_KEY_FILE`.

## Capability matrix (production-ready)

| Capability                                 | Spec / version            | Status |
| ------------------------------------------ | ------------------------- | ------ |
| MLLP framing                               | HL7 MLLP transport        | ✓      |
| MLLP over TLS (mutual auth optional)       | RFC 5246+                 | ✓      |
| HL7 v2.5 ADT (A01, A03, A04, A08, A11,    |                           |        |
| A13, A28, A31, A40 merge, A60)             | HL7 v2.5                  | ✓      |
| HL7 v2.5 ORU^R01, ORU^R30                  | HL7 v2.5                  | ✓      |
| HL7 v2.5 ORM^O01, OMP^O09                  | HL7 v2.5                  | ✓      |
| HL7 v2.5 RDE^O11, RDS^O13                  | HL7 v2.5                  | ✓      |
| HL7 v2.5 MDM^T01, MDM^T02                  | HL7 v2.5                  | ✓      |
| HL7 v2.5 SIU^S12 / S13 / S14 / S15 / S26   | HL7 v2.5                  | ✓      |
| HL7 v2.5 BAR^P01-P05, DFT^P03 / P11        | HL7 v2.5                  | ✓      |
| HL7 v2.5 MFN^M02 / M05 / M06               | HL7 v2.5                  | ✓      |
| Z-segment extensibility (Epic, Cerner,     |                           |        |
| Meditech baked in; per-org config for the  |                           |        |
| rest)                                      | n/a                       | ✓      |
| MSA acknowledgement (AA / AE / AR)         | HL7 v2.5                  | ✓      |
| FHIR R4 CapabilityStatement                | FHIR R4                   | ✓      |
| FHIR R4 USCDI v3 resources (Patient,       |                           |        |
| Encounter, Condition, Observation,         |                           |        |
| MedicationRequest, MedicationStatement,    |                           |        |
| AllergyIntolerance, DocumentReference,     |                           |        |
| DiagnosticReport, Immunization,            |                           |        |
| Procedure, CarePlan, CareTeam, Goal,       |                           |        |
| Coverage, Organization, Practitioner,      |                           |        |
| PractitionerRole, Location, Device,        |                           |        |
| Provenance, Subscription)                  | USCDI v3                  | ✓      |
| FHIR R4 Bundle transaction                 | FHIR R4                   | ✓      |
| FHIR Bulk Data Access ($export NDJSON)     | FHIR Bulk Data 1.0        | ✓      |
| FHIR R4 Subscription (REST-hook delivery)  | FHIR R4                   | ✓      |
| SMART on FHIR v2 (authorize, token,        |                           |        |
| introspect, revoke, dynamic registration,  |                           |        |
| PKCE, refresh, launch context)             | SMART App Launch v2       | ✓      |
| SMART Backend Services (client_credentials |                           |        |
| + JWT bearer assertion)                    | SMART Backend Services    | ✓      |
| CDS Hooks 1.1 (discovery + invocation +    |                           |        |
| feedback)                                  | CDS Hooks 1.1             | ✓      |
| CCD / CCDA import                          | CCDA R2.1                 | TODO   |
| OPO DonorNet (UNOS UNet) connector         | proprietary               | TODO   |

## Quick test (no Mirth)

The unit tests cover the framer + parsers. The integration tests cover
the full ingest path (TCP → MLLP → parse → DB → ack) and the FHIR
surface:

```bash
cd server
docker compose -f ../docker/docker-compose.yml up -d postgres
npm install
npm run migrate
npm run test:integration
```

The end-to-end smoke test exercises every integration surface in one
shot (HL7 + FHIR + SMART + CDS Hooks + Bulk Data):

```bash
npm run smoke   # from repo root, brings up postgres+api, runs the suite
```

## Endpoint reference

### MLLP (HL7 v2)

```
TCP  :2575                 # plaintext (dev)
TCP  :2576                 # TLS (set HL7_MLLP_TLS_*)
```

### FHIR R4 REST

```
GET    /fhir/metadata
GET    /fhir/{Type}                  # search
GET    /fhir/{Type}/{id}             # read
GET    /fhir/{Type}/{id}/_history    # history
POST   /fhir/{Type}                  # create
PUT    /fhir/{Type}/{id}             # update
DELETE /fhir/{Type}/{id}             # soft delete
POST   /fhir                         # transaction Bundle
POST   /fhir/$export                 # Bulk Data system export
POST   /fhir/Patient/$export         # Bulk Data patient compartment
POST   /fhir/Group/{id}/$export      # Bulk Data group export
GET    /fhir/$export-status/{jobId}  # poll Bulk Data
GET    /fhir/$export-file/{fileId}   # NDJSON file
DELETE /fhir/$export-status/{jobId}  # cancel
```

### SMART on FHIR v2

```
GET   /.well-known/smart-configuration
GET   /fhir/.well-known/smart-configuration
GET   /oauth2/authorize
POST  /oauth2/authorize
POST  /oauth2/token
POST  /oauth2/register     # RFC 7591 dynamic client registration
GET   /oauth2/clients      # admin
POST  /oauth2/introspect   # RFC 7662
POST  /oauth2/revoke       # RFC 7009
```

Supported grants: `authorization_code` (+ PKCE), `refresh_token`,
`client_credentials`, `urn:ietf:params:oauth:grant-type:jwt-bearer`.
Scopes are fully v1 (`patient/Patient.read`) and v2 (`patient/Patient.rs`)
syntax-aware and enforced on every FHIR call.

### CDS Hooks 1.1

```
GET   /cds-services
POST  /cds-services/{id}
POST  /cds-services/{id}/feedback
```

Built-in services (more can be registered via
`require('./cds/registry').register(...)`):

- `transplant-candidate-summary` — patient-view banner with active
  candidacy status, blood type, last creatinine.
- `nephrotoxic-medication-advisory` — order-select alert when an EHR
  user prescribes an NSAID/aminoglycoside/etc. to a kidney candidate.
- `hla-screening-reminder` — order-sign reminder if HLA antibody
  screening is overdue (>30 days for active candidates).

## Vendor-specific notes

### Epic (App Orchard / Vendor Services)

1. Register the deployment's FHIR base + `/.well-known/smart-configuration`
   in App Orchard. Use SMART v2 scopes.
2. For backend services (population health pulls, scheduled exports)
   register a JWKS URL pointing at your public keys; TransTrack accepts
   the `jwt-bearer` grant.
3. HL7: Epic Bridges sends Z-segments `ZPD`, `ZPV`, `ZID`, `ZTX` by
   default. The Epic vendor profile (`/hl7/vendor-profiles/seed-defaults`)
   maps these to candidate flags, encounter context, identifiers, and
   transplant text fields.
4. Bulk Data: Epic supports `_typeFilter` and `_since`; both are honored.

### Cerner / Oracle Health

1. Same SMART app registration model. Cerner supports both v1 and v2
   scope syntax — TransTrack accepts either.
2. HL7: Cerner OpenEngine emits `ZPI`, `ZPV`, and ORU `ZRX` for med
   reconciliation; the Cerner profile resolves them.
3. Cerner's Bulk Data implementation only supports `Patient` and
   `Group` exports, which mirrors TransTrack's surface.

### Meditech

1. SMART on FHIR launched apps are supported via Meditech Greenfield.
   Set the `aud` claim to your TransTrack FHIR base.
2. HL7: Meditech DR sends `ZFS` financial segments and `ZTX`
   freetext; resolved by the Meditech vendor profile.

### Allscripts / Veradigm Sunrise

1. Sunrise IIE relays MLLP over TLS — point it at TransTrack:2576.
2. Vendor profile `allscripts` covers `ZAL` allergies + `ZIN` insurance.

### athenahealth

1. FHIR-only (no inbound HL7 in their Cloud product).
2. SMART app registration via `marketplace.athenahealth.com`.
3. CDS Hooks: register the discovery URL in MDP.

### NextGen / eClinicalWorks

1. Both ship with Mirth Connect — use the channels in `docker/mirth/`
   as a starting template.
2. Both vendor profiles handle their `Z*` extensions.

## Vendor profile API (admin)

```
POST /hl7/vendor-profiles/seed-defaults
GET  /hl7/vendor-profiles
POST /hl7/vendor-profiles
PUT  /hl7/vendor-profiles/:id
DELETE /hl7/vendor-profiles/:id
GET  /hl7/supported-types
GET  /hl7/messages?limit=...
```

Each profile is JSON; schema:

```jsonc
{
  "name": "epic-ce",
  "vendor": "epic",
  "sending_application": "EPIC",
  "z_segments": {
    "ZPD": { "fields": [
      "ssn", "race", "ethnicity", "preferred_language",
      "religion", "transplant_candidate_flag"
    ] }
  },
  "field_overrides": { "PID-19": "social_security_number" }
}
```

## Full test against Mirth Connect

```bash
# 1. Start everything
cd docker
docker compose up -d postgres api mirth

# 2. Apply DB migrations
docker compose exec api node src/db/migrate.js up

# 3. Open the Mirth Administrator
open https://localhost:8443
# default credentials: admin / admin (change after first login)

# 4. Import the channels in docker/mirth/channels/
#    Mirth → Channels → Import Channel → select transtrack-relay.xml
#                                       and transtrack-file-in.xml
#    Deploy both.

# 5. Drop a sample HL7 file into the file-watch directory
cat > docker/mirth/inbox/sample-adt.hl7 <<'EOF'
MSH|^~\&|EPIC|HOSP|TT|TT|20260101120000||ADT^A04|MIRTH-001|P|2.5
EVN|A04|20260101120000
PID|1||MIRTH-MRN-1^^^HOSP^MR||DOE^JANE||19800101|F
EOF

# 6. Within ~5 seconds Mirth picks up the file and forwards it.
#    Verify on the TransTrack side:
curl -H "Authorization: Bearer <token>" \
  http://localhost:8080/hl7/messages?limit=10 | jq

# 7. Optional: run the harness test that automates steps 5-6
INTEGRATION_MIRTH=1 npm --prefix server run test:mirth
```

## SMART quick-test

```bash
# Discovery
curl http://localhost:8080/.well-known/smart-configuration | jq

# Register a backend client (admin token required)
curl -XPOST http://localhost:8080/oauth2/register \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "PopHealth",
    "grant_types": ["client_credentials"],
    "scope": "system/Patient.rs system/Observation.rs"
  }' | jq

# Get an access token
curl -XPOST http://localhost:8080/oauth2/token \
  -d "grant_type=client_credentials" \
  -d "client_id=$ID" \
  -d "client_secret=$SECRET" \
  -d "scope=system/Patient.rs"

# Use the token
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/fhir/Patient
```

## Bulk Data quick-test

```bash
# Kick off
curl -XPOST http://localhost:8080/fhir/Patient/\$export \
  -H "Authorization: Bearer $TOKEN" \
  -H "Prefer: respond-async" \
  -H "Accept: application/fhir+json" -i

# Poll the Content-Location URL until 200
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/fhir/\$export-status/$JOB_ID

# Download NDJSON files from the manifest
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/fhir/\$export-file/$FILE_ID
```

## CDS Hooks quick-test

```bash
# Discovery
curl http://localhost:8080/cds-services | jq

# Invoke
curl -XPOST http://localhost:8080/cds-services/transplant-candidate-summary \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hookInstance": "abc",
    "hook": "patient-view",
    "context": { "patientId": "Patient/123", "userId": "Practitioner/9" }
  }' | jq
```
