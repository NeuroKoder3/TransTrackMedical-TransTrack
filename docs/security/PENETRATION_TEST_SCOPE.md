# TransTrack — Penetration Test Statement of Work (SOW)

| Document control | |
|---|---|
| Document ID | TT-SEC-PT-SOW-001 |
| Version | 1.0 |
| Status | Open — pending engagement |
| Owner | TransTrack Engineering Lead |
| Effective date | _to be set on contract execution_ |

> **This document is the scope-of-work issued to the contracted security
> firm.** It is the authoritative description of what they may, must, and
> may not test against TransTrack. The document is finalized through
> negotiation with the chosen vendor (rules of engagement are added as
> Annex A at contract signing).

---

## 1. Engagement objective

Independently verify TransTrack's defense-in-depth security posture against
a competent attacker with realistic time, budget, and credential access.
The objective is **not** a compliance certification — it is an externally
written, vendor-neutral statement of what works and what does not in the
running build.

The deliverables defined in §10 directly satisfy:

- The April-2026 project-evaluation report's mandatory pre-broad-commercial
  release item B4.
- HIPAA Security Rule §164.308(a)(8) "evaluation" requirement (45 CFR).
- 21 CFR Part 11 §11.10(d) "limiting system access to authorized
  individuals" assurance evidence.
- HECVAT 3.0 Lite questions covering recent third-party assessment.

---

## 2. Target system

| Item | Value |
|---|---|
| Product | TransTrack |
| Version under test | _Pinned to a specific tag at contract signing — e.g. `v1.2.0` (commit SHA `____________`)_ |
| Architecture | Electron 39 desktop + optional Fastify + PostgreSQL server tier |
| OS targets | Windows 11 (NSIS installer x64), macOS 14 (DMG arm64) — at least one of the two |
| Server target (optional) | `server/` directory deployed via `docker/docker-compose.yml` (Fastify API, PostgreSQL 16, MLLP/HL7 v2 listener) |

The vendor is provided with:

- Source-code access (read-only) for grey-box testing
- Two seeded admin accounts and two coordinator accounts
- A documented test data set (synthetic patients in `sample-data/`)
- The compliance package under `docs/compliance/`
- The threat model in `docs/THREAT_MODEL.md`
- The IPC handler reference in `docs/API_REFERENCE.md`
- A non-production Epic on FHIR sandbox client id (if EHR scope is selected)

---

## 3. Scope — IN

### 3.1 Desktop application (mandatory)

1. **IPC bridge** (`electron/preload.cjs`, `electron/ipc/`) — every
   `contextBridge`-exposed channel.
2. **Authentication & session management** (`electron/services/mfa.cjs`,
   `electron/services/passwordHistory.cjs`, session binding to WebContents).
3. **Authorization** (RBAC enforcement in `electron/services/accessControl.cjs`,
   organization isolation, break-the-glass justified access).
4. **Encryption at rest** (SQLCipher key wrap with Electron `safeStorage`,
   key rotation, file-key fallback ACLs).
5. **Audit log integrity** (database triggers preventing UPDATE/DELETE on
   `audit_logs`).
6. **Backup / restore pipeline** (`electron/services/disasterRecovery.cjs`).
7. **Input handling** for every PHI-bearing form (PatientForm, DonorForm,
   AHHQForm, ReadinessBarrierForm, LabForm) — XSS, prototype pollution,
   ReDoS, oversized inputs, unicode normalization.
8. **Hardened Electron configuration** — context isolation, CSP,
   navigation/popup blocking, devtools-disabled-in-production.
9. **HL7 v2 ingestion** (`electron/services/hl7Ingest.cjs`) — message
   parsing, MLLP framing, ACK generation.
10. **OPTN-style CSV export** — RFC 4180 escaping, `DO_NOT_SUBMIT`
    watermark integrity.

### 3.2 Server tier (optional — additional fee)

1. Fastify REST API surface (auth, FHIR R4, SMART on FHIR v2, CDS Hooks 1.1,
   FHIR Bulk Data $export, Subscriptions).
2. SAML / OIDC authentication, SMART Backend Services JWT bearer assertion.
3. PostgreSQL row-level security (RLS) for user-keyed tables.
4. MLLP/TLS HL7 v2 listener.
5. Multi-tenant Epic configuration resolver (`server/src/integrations/epic/registry.js`).

### 3.3 Build & supply-chain (advisory)

1. CycloneDX SBOM contents — confirm no unexpected runtime dependencies.
2. `npm audit` baseline at the test commit.
3. Code-signing posture (Authenticode + macOS notarization) — record-only
   if not yet applied at the time of test.

---

## 4. Scope — OUT

The following are explicitly **out of scope** unless added by written
amendment:

1. The customer's host operating system, AV/EDR, identity provider, or
   network — those are validated by the customer's IT under their own SOPs.
2. Physical attacks, social engineering, phishing of TransTrack staff, or
   denial-of-service against production infrastructure (TransTrack does
   not operate production infrastructure for the v1.x distribution).
3. Live UNOS / OPTN systems — TransTrack does not connect to live
   allocation systems and does not perform allocation.
4. Live Epic production environment — only the Epic on FHIR **sandbox** is
   in scope, gated by the project's existing `EPIC_SANDBOX_CLIENT_ID`.
5. Third-party Electron / Node.js / SQLCipher source code — bundled
   versions are listed in the SBOM; CVE assessment is in scope, source
   review of those upstream projects is not.

---

## 5. Methodology

The vendor shall combine:

| Technique | Coverage area |
|---|---|
| **OWASP ASVS 4.0 Level 2** controls | Web/API surfaces of the optional server tier |
| **OWASP MASVS 2.0** equivalents (adapted for Electron) | Desktop renderer + main process |
| **STRIDE-driven threat modeling** | Validates the existing `docs/THREAT_MODEL.md` |
| **Grey-box code review** | IPC handler boundaries, RBAC enforcement, SQL parameterization |
| **Black-box runtime exploit attempts** | Audit-log tampering, cross-org access, session hijacking, key extraction |
| **HIPAA Security Rule §164.308 / .310 / .312 mapping** | Cross-references `docs/compliance/HIPAA_SECURITY_RULE_MAPPING.md` |
| **21 CFR Part 11 §11.10 / §11.30 mapping** | Cross-references `docs/compliance/PART_11_CONTROL_MAPPING.md` |
| **CWE Top 25 (current)** | Catch-all for common implementation defects |

---

## 6. Severity classification

The vendor shall use a 5-level rating consistent with TransTrack's
`SECURITY.md`:

| Severity | Definition | Example |
|---|---|---|
| Critical | Direct, remotely-exploitable PHI exfiltration or audit-log tampering | Path that decrypts the database without the Electron `safeStorage` key |
| High | Privilege escalation, cross-org access, or audit-trail bypass | RBAC bypass on a PHI-write IPC handler |
| Medium | Information disclosure, weak crypto config, or denial-of-service against a single host | Predictable session token, missing rate limit on PHI export |
| Low | Hardening recommendation; minimal exploitability | Verbose error message in stack trace, missing `Content-Security-Policy` directive |
| Informational | Code-quality observation; no security impact | "Consider rotating Electron updater HMAC key annually" |

---

## 7. Rules of engagement (Annex A — finalized at contract)

The signed Annex A shall cover at minimum:

1. **Test windows** — explicit start/end timestamps, no out-of-window activity.
2. **Authorized testing accounts** — separate accounts, never reuse customer accounts.
3. **Data handling** — no real PHI accessed; synthetic data only; vendor-side data destroyed within 30 days of report acceptance.
4. **Communication tree** — engineering lead, security lead, legal lead, and 24/7 incident contact.
5. **Stop-test conditions** — vendor must immediately pause and notify on any indication of real PHI exposure or production-system compromise.
6. **Re-test policy** — one round of re-test included for Critical/High remediations within 30 days of the close-out report.

---

## 8. Constraints and credentials

- The vendor receives a copy of the build artifact (`.exe` and a Docker
  Compose stack) plus source access. They do **not** receive any
  customer-issued certificates, signing keys, or production secrets — none
  exist in the v1.x open-distribution build.
- The vendor receives the `epic-keys/` template paths but must generate
  their own JWKS for any Epic sandbox interaction (per the project's
  existing `server/src/integrations/epic/README.md` flow).

---

## 9. Timeline

| Milestone | Calendar weeks from signature |
|---|---|
| Kick-off + environment provisioning | Week 1 |
| Reconnaissance + tooling setup | Week 1–2 |
| Active testing (desktop) | Week 2–3 |
| Active testing (server tier — if in scope) | Week 3–4 |
| Draft report delivered | Week 5 |
| Triage + remediation tracker populated by TransTrack | Week 5–7 |
| Re-test of Critical/High fixes | Week 8 |
| Final report + executive summary | Week 9 |

Total expected duration: **9 weeks** from contract signature to final
report, assuming no Critical findings requiring extended remediation.

---

## 10. Deliverables

The vendor shall provide:

1. **Final report** (PDF + Markdown) including:
   - Executive summary (1–2 pages, audience: CISO / Compliance Officer)
   - Methodology
   - Findings (one per CWE-categorized issue, with reproduction steps,
     impact, severity, recommended fix, and verification path)
   - Risk register delta — every finding mapped back to a row in
     `docs/compliance/RISK_REGISTER.md`
   - HIPAA / Part 11 mapping delta
   - Re-test results
2. **Public summary** — one-page sanitized version safe to share with
   prospects under NDA, populated into
   `docs/security/PENETRATION_TEST_SUMMARY_TEMPLATE.md`.
3. **Raw evidence** (encrypted archive) — proofs-of-concept, intercepted
   traffic, exploited payloads. Held by the vendor for 90 days, then
   destroyed.

---

## 11. Acceptance criteria

The engagement is accepted by TransTrack when:

1. The final report is delivered, signed by the vendor's engagement lead.
2. All Critical findings have a documented remediation or accepted-risk
   sign-off in `PENTEST_REMEDIATION_TRACKER.md`.
3. The public summary in `PENETRATION_TEST_SUMMARY_TEMPLATE.md` is
   published.
4. The vendor's data-destruction certificate is on file.

---

## 12. Confidentiality

The vendor signs a mutual NDA covering:

- TransTrack source, build artifacts, customer references.
- Findings — embargoed until either remediation completes or 90 days
  elapse, whichever is sooner.
- Customer identities — vendor must not reveal which TransTrack
  customers, if any, requested the engagement.

---

## 13. Pricing structure (vendor proposal)

Vendor proposals shall break down:

- Fixed price for desktop scope (§3.1)
- Fixed price for server-tier scope (§3.2) — separately
- Day rate for any out-of-scope work
- Re-test included (per §7) — confirm no separate fee
- Travel / expenses (typically zero — engagement is remote)

---

## 14. Liability and insurance

- Vendor carries **professional liability** insurance ≥ USD $2 000 000.
- Vendor carries **cyber liability** insurance covering data-handling
  errors during the engagement.
- TransTrack indemnifies the vendor against claims arising from
  TransTrack's failure to disclose in-scope assets.

---

*To request a quote against this SOW, email Trans_Track@outlook.com with
subject `PEN TEST QUOTE — TransTrack v____ — <vendor name>`.*
