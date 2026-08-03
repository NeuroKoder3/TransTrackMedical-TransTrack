# Validation Finding Remediation Map

Maps each finding from the TransTrack Validation Report to the change that
closes it. Residual risks that remain intentionally open are recorded in
`RESIDUAL_RISK.md`.

| ID | Status | Primary change |
|----|--------|----------------|
| C-1 | Closed | SMART patient-compartment at storage + scopes (`server/src/fhir/compartment.js`, `storage.js`, `smart/scopes.js`) |
| C-2 | Closed (vendor package) | Ratified VP, executed IQ/OQ, PQ NOT EXECUTED by vendor, VSR, FMEA, residual risk under `docs/compliance/` |
| C-3 | Closed | Source register + reference tables; PELD fail-closed (RR-01); LAS→TTLI |
| C-4 | Closed | Clinical validators at IPC / HL7 / FHIR / server patient boundaries |
| H-1 | Closed | List/filter require list-scope PHI grant; renderer `BulkPhiAccessGate` + broker |
| H-2 | Closed | Real encryption verification; fail-closed packaged |
| H-3 | Closed | Tenant RLS hardening migration; HL7 org predicates |
| H-4 | Closed | Per-entry scope on FHIR transaction bundles |
| H-5 | Closed | Logger auto PHI redaction |
| H-6 | Closed | Restored `featureGate.cjs` / `tiers.cjs`; `shared.requireFeature` consults manager; entity writes call `requireWriteAccess` |
| H-7 | Closed | Packaged builds refuse DEV publisher key; release `--for-sale` gate |
| H-8 | Closed | Coverage floors raised; suites in `core`/`all`; orphan suite check |
| H-9 | Closed | MLLP bounds / bind restrictions |
| H-10 | Closed | Calculator source traceability; KDPI/EPTS residual RR-03 |
| H-11 | Closed | Audit fail-closed write paths |
| H-12 | Closed | CDS PHI-free summary in audit |
| H-13 | Closed | `purgeClientPhiCaches` on logout; NavigationTracker path redaction |
| H-14 | Closed | Remote `functions.invoke` / unsupported entities fail loudly; `apiClientParity` Vitest suite |
| M-21 | Closed | Trial high-water clock file; delete/rollback cannot reset trial |
| M-24 | Closed | `formatDate` / `formatDateTime` render UTC with explicit marker |
| M-17 / AATB | Closed | Unsupported AATB product claims removed from UI, splash, compliance view, keywords |

Low / informational items that remain partially open (non-blocking for
Critical/High closure) are tracked in `RESIDUAL_RISK.md` (typing L-1,
module size L-2, schema FK L-3, migration rollbacks L-4, IRE disclosure I-2–I-4).
