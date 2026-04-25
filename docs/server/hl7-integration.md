# HL7 v2 / FHIR R4 Integration Testing

This guide explains how to verify TransTrack's hospital integration
end-to-end using NextGen Mirth Connect as a stand-in for a hospital
interface engine.

## What we're testing

```
┌─────────────────┐         MLLP/TLS          ┌──────────────────────┐
│ Hospital engine │  ─────────────────────▶   │ TransTrack listener  │
│  (Mirth/Rhapsody│  ◀───────────  MSA|AA    │   :2575              │
│   Cloverleaf)   │                          └──────────────────────┘
└─────────────────┘
       │
       │ FHIR R4 (REST/HTTPS)
       ▼
┌──────────────────────┐
│ TransTrack /fhir/... │
└──────────────────────┘
```

Real production deployments wrap MLLP in TLS with mutual cert auth.
For local testing we use plaintext MLLP for simplicity, but the
production code path is the same — just set
`HL7_MLLP_TLS_CERT_FILE` / `HL7_MLLP_TLS_KEY_FILE`.

## Quick test (no Mirth)

The unit tests already cover the framer; the integration tests cover
the full ingest path (TCP → MLLP → parse → DB → ack):

```bash
cd server
docker compose -f ../docker/docker-compose.yml up -d postgres
npm install
npm run migrate
npm run test:integration
```

You should see passes for:
- `mllp ingest > accepts ADT^A04 and returns AA`
- `mllp ingest > accepts ORU^R01 and creates lab rows`
- `FHIR R4 > GET /fhir/metadata returns a CapabilityStatement`
- `FHIR R4 > creates a Patient and reads it back`
- `FHIR R4 > creates an Observation and persists to lab_results`

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

## What real hospital connectors look like

| Vendor       | Engine        | Connector type        | TransTrack target |
| ------------ | ------------- | --------------------- | ----------------- |
| Epic         | Bridges       | MLLP/TLS, FHIR R4     | both              |
| Cerner       | OpenEngine    | MLLP/TLS, FHIR R4     | both              |
| Meditech     | DR (HL7)      | MLLP/TLS              | MLLP              |
| Allscripts   | Sunrise IIE   | MLLP/TLS              | MLLP              |
| Athena       | n/a (FHIR)    | FHIR R4               | FHIR              |
| OPO Donornet | UNOS UNet     | proprietary VPN       | not yet supported |

## Conformance checklist (work-in-progress)

- [x] MLLP framing (RFC-equivalent: MLLP transport spec)
- [x] HL7 v2.5 ADT^A01/A03/A04/A08
- [x] HL7 v2.5 ORU^R01
- [x] MSA acknowledgement (AA / AE / AR)
- [x] FHIR R4 CapabilityStatement
- [x] FHIR R4 Patient / Observation / Encounter / MedicationRequest /
       AllergyIntolerance (read, search, create, update)
- [ ] HL7 v2.5 SIU^S12 (scheduling)
- [ ] HL7 v2.5 MDM^T02 (document)
- [ ] FHIR R4 Bundle transaction
- [ ] FHIR Bulk Data ($export)
- [ ] SMART on FHIR launch context
- [ ] CCD/CCDA import
