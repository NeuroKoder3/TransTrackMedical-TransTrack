# Critical Actions Required Before Commercial Sale

**Owner:** TransTrack founder
**Last updated:** 2026-05-14
**Status:** items in this file CANNOT be closed in source code. They
require contracts, money, or a third-party signature.

Each item below has a concrete vendor list, indicative pricing, and a
copy-pasteable initial outreach email. Work through them in the order
shown — that's the order in which they block revenue.

---

## C-2 — Incorporate a legal entity and own a vendor domain

### Why this blocks sale

Hospitals buy from corporations, not individuals. Before you can sign a
BAA, accept ACH or a wire, or invoice a customer, you need:

- a registered business entity that can own the IP and sign contracts
- an EIN (US) or equivalent tax ID
- a business bank account
- a vendor domain with TLS-secured email (e.g.
  `sales@transtrack.health`, not `Trans_Track@outlook.com`)
- a `.well-known/security.txt` and a public privacy policy URL

### Concrete plan (US-based; equivalent in your jurisdiction)

| Step                                  | Vendor                                          | Cost                            | Time      |
| ------------------------------------- | ----------------------------------------------- | ------------------------------- | --------- |
| LLC or Delaware C-Corp formation      | Stripe Atlas / Clerky / Firstbase / a real lawyer | $500–$1,500 one-time           | 1–3 weeks |
| EIN                                   | IRS (free) — Stripe Atlas / Firstbase will file | free                            | 1–4 weeks |
| Registered agent                      | Bundled with the formation vendor               | $100–$300/yr                    | included  |
| Business bank account                 | Mercury / Brex / a regional bank                | free                            | 1–3 days  |
| Domain — `transtrack.health`          | Cloudflare Registrar / Namecheap                | $40–$200/yr                     | 1 hour    |
| Email — Google Workspace              | Google                                          | $6–$18 / user / month           | 1 hour    |
| Privacy Policy + Terms of Service     | Termly / iubenda + lawyer review                | $300–$2,000                     | 1 week    |
| BAA template (you already have one)   | docs/compliance/policies/BAA_TEMPLATE.md        | $0 — already in repo            | 0         |
| Business cyber + GL insurance         | see C-11                                        | see C-11                        | see C-11  |

### Outreach template

> Subject: New software company — formation + tax filings
>
> Hi [Atlas/Firstbase team],
>
> I'm forming a Delaware C-Corp for a healthcare software product that
> sells to US transplant centers. Please proceed with formation, EIN
> registration, and a Mercury bank account opening. Founder: [Name];
> primary state of operation: [State]. The company will collect protected
> health information from customers and will execute Business Associate
> Agreements; please flag any structural recommendations specific to
> HIPAA-covered SaaS.
>
> Target funding source: bootstrapped initially; expecting first revenue
> within 90 days. Please send the standard template package.
>
> Thanks,
> [Name]

---

## C-3 — Code-signing certificates (already wired in code; only the cert is missing)

### Status

The release pipeline (`.github/workflows/release.yml`) and the
release-readiness gate (`npm run release:check:for-sale`) already
**enforce** signed installers. They only run when you push a `v*.*.*`
tag. The remaining work is to purchase the actual certificates and add
the four required GitHub Actions secrets.

### Vendor list

| Cert                                      | Vendor                                     | Cost            | Mode                   |
| ----------------------------------------- | ------------------------------------------ | --------------- | ---------------------- |
| Windows EV Code Signing (Authenticode)    | SSL.com eSigner (cloud HSM)                | ~$300/yr        | `TRANSTRACK_SIGN_MODE=ssl_esigner` |
| Windows EV Code Signing (USB token)       | DigiCert / Sectigo / SSL.com (hardware token) | ~$300–$700/yr | `TRANSTRACK_SIGN_MODE=pfx` |
| Apple Developer Program                   | Apple                                      | $99/yr          | `APPLE_*` secrets       |

**Recommendation:** SSL.com eSigner. It's cloud-HSM-backed, eliminates
the lost-USB-token nightmare, and works out of the box with the existing
CI workflow.

### GitHub Actions secrets to set (settings → secrets and variables → actions)

```
ESIGNER_USERNAME
ESIGNER_PASSWORD
ESIGNER_CREDENTIAL_ID
ESIGNER_TOTP_SECRET

APPLE_ID
APPLE_APP_PASSWORD       (app-specific password from appleid.apple.com)
APPLE_TEAM_ID
APPLE_CERT_BASE64        (base64 of your Developer ID Application .p12)
APPLE_CERT_PASSWORD
```

### Smoke-test the pipeline

```bash
git tag v1.3.0-rc1
git push origin v1.3.0-rc1
```

If credentials are missing, the `preflight` job will fail with a clear
error message. If credentials are present, you'll get signed installers
in the GitHub Releases artifact set within ~25 minutes.

---

## C-4 — Independent penetration test

### Why this blocks sale

Every hospital security questionnaire (HECVAT, SIG, your customer's
custom 200-question Word doc) asks "have you had a third-party
penetration test in the last 12 months." Saying "no" is an automatic
red flag and often a contractual disqualifier.

### Scope already documented

`docs/security/PENETRATION_TEST_SCOPE.md` and
`docs/security/PENTEST_VENDOR_CHECKLIST.md` are already in the repo.
The vendor only needs the scope doc + this README + access to a
non-PHI test environment.

### Concrete vendors

| Vendor                      | Strengths                                          | Indicative price (1-week eng.) |
| --------------------------- | -------------------------------------------------- | ------------------------------ |
| Bishop Fox                  | Tier-1 reputation, strong for healthcare            | $30–60k                        |
| Trail of Bits               | Strong on cryptography and binaries                 | $30–80k                        |
| NCC Group                   | Healthcare-savvy, large team                        | $25–60k                        |
| Independent Security Evaluators (ISE) | Healthcare + medical-device focused        | $20–50k                        |
| Cobalt.io (PtaaS)           | Cheaper, decent quality, gives you a tester crew    | $8–25k                         |
| Synack (PtaaS)              | Same idea — continuous, crowd-style                 | $15–40k                        |

**Recommendation if cash-constrained:** Cobalt.io. You can scope a
focused 2-week engagement that covers the desktop app + API server for
under $15k and walk away with a redacted report you can attach to every
RFP. Step up to Bishop Fox once you have enterprise customers paying
≥$100k/yr.

### Outreach template

> Subject: Penetration test scoping for healthcare desktop application
>
> Hi [vendor],
>
> I'm the founder of TransTrack, a HIPAA-aligned desktop application
> used by US organ transplant centers. We're commercializing the
> product and need an external pen-test report we can share under NDA
> with prospective hospital customers and (later) with SOC 2 auditors.
>
> Scope:
>   - Electron desktop client (Windows + macOS), ~50 KLOC JS
>   - Fastify-based API server with FHIR R4 + HL7 v2 MLLP listener
>   - Postgres 16 backend with row-level security
>   - SAML 2.0, OIDC, SMART on FHIR v2 integrations
>
> Our published threat model and scope-of-engagement document is at
> [share docs/security/PENETRATION_TEST_SCOPE.md].
>
> Timeline: ideally a 1-week engagement starting in the next 6 weeks.
> Deliverable: a redacted executive summary that can be attached to
> security questionnaires, plus a detailed technical report kept under NDA.
>
> Budget: please quote both a "focused" (web + binary surface only) and
> "comprehensive" (incl. crypto + supply chain) option.
>
> Thanks,
> [Name]

---

## C-5 — Executed validation package (IQ/OQ/PQ)

### Why this blocks sale

Joint Commission-accredited transplant programs are required to validate
any clinical system that affects allocation. They will ask for either:

- **Vendor-executed validation** (your name in the "performed by" box), or
- **Vendor-supplied protocols** that they execute locally and you
  countersign

You currently have the **templates** (`docs/compliance/`) and
**worked examples** (`docs/compliance/pilot-site-example/`) but not a
signed, executed copy.

### The two ways to close this

#### Option A (cheap, slow) — first pilot site executes it

In the first pilot contract, add the language:

> *"As part of the pilot, [Hospital] will execute the IQ, OQ, and PQ
> protocols supplied by TransTrack in good faith, and provide the
> completed forms to TransTrack within 90 days of go-live. TransTrack
> retains the right to use the redacted (de-identified) completed
> protocols as a reference validation package for future sales,
> provided no patient data is disclosed."*

Cost: $0 (you trade discounted pricing for the executed forms).
Timeline: 90 days from pilot go-live.

#### Option B (fast, expensive) — third-party validation consultant

| Vendor                   | Notes                                      | Cost           |
| ------------------------ | ------------------------------------------ | -------------- |
| Compliance Architects     | Boutique, transplant-experienced            | $30–60k        |
| Veeva (Vault Validation) | Heavyweight, enterprise-pharma background  | $50–100k       |
| Independent QA contractor | Find via Healthbox / LinkedIn / referrals  | $15–40k        |

The consultant signs and dates each step of the protocols against a
clean test environment you provision. The result is paper that says
"TransTrack v1.x.y has been Installation/Operational/Performance
qualified by [firm] for transplant-waitlist management" — and that
paper goes into every RFP response.

### Bare-minimum DIY route

If you genuinely cannot afford Option B and don't yet have a pilot:

1. Spin up a clean Windows VM and a clean macOS VM.
2. Install TransTrack from the signed installer (post-C-3).
3. Walk through each step in
   `docs/compliance/pilot-site-example/IQ_PROTOCOL_EXAMPLE.md`,
   `OQ_PROTOCOL_EXAMPLE.md`, `PQ_PROTOCOL_EXAMPLE.md`.
4. Record screen captures, timestamps, and your initials at each step.
5. Save the executed PDFs to `docs/compliance/executed/`.
6. Have a clinical advisor (transplant coordinator / surgeon) sign as
   the "user representative."

This is not as strong as a third-party countersignature but is
materially better than "we have templates."

---

## C-11 — E&O + cyber liability insurance

### Why this blocks sale

Most hospital procurement contracts include a hard insurance minimum,
typically:

- **Cyber liability:** $1M aggregate
- **Errors & Omissions (Tech E&O):** $1M aggregate
- **General liability:** $1M / occurrence, $2M aggregate

Without these, your contract goes to legal and dies on the redline pass.

### Concrete vendors

| Vendor      | Strengths                                       | Indicative annual premium (early-stage SaaS) |
| ----------- | ----------------------------------------------- | -------------------------------------------- |
| Vouch       | Startup-friendly, fast online quotes            | $2–6k                                        |
| Embroker    | Specialty in tech E&O + cyber                    | $3–8k                                        |
| Coalition   | Strong cyber risk underwriting + free scanning   | $2–7k                                        |
| Cowbell     | Direct, online, simple                           | $2–5k                                        |
| Aon / Marsh | Brokerage; better for >$10M revenue              | varies                                       |

**Recommendation:** Coalition for cyber + Vouch for E&O. Coalition's
underwriting includes free attack-surface monitoring which is a
genuinely useful by-product.

### What underwriters will ask

- Annual revenue (zero is fine if you're pre-revenue — they'll quote
  off projected revenue)
- Whether you store / process PHI (yes)
- Whether you encrypt at rest and in transit (yes — point them to
  `SECURITY.md`)
- Whether you have MFA on admin accounts (yes — point them to
  `docs/SSO_DESKTOP.md` and `docs/compliance/HIPAA_SECURITY_RULE_MAPPING.md`)
- Whether you've had a pen-test in the last 12 months (close C-4 first
  so you can answer "yes")
- Whether you have a written incident response plan (you do —
  `docs/compliance/INCIDENT_RESPONSE_PLAN.md` ... if it's missing, add
  it before quoting)

### Outreach template

> Subject: Tech E&O + cyber liability quote — healthcare SaaS
>
> Hi [Vouch / Coalition],
>
> I'm the founder of TransTrack, a HIPAA-aligned desktop application
> sold to US organ transplant centers. We're approaching first revenue
> and need:
>
>   - Cyber liability: $1M / $1M
>   - Tech E&O: $1M / $1M
>   - General liability: $1M / $2M
>
> Quick facts:
>   - Annual revenue (projected, year 1): [your number]
>   - PHI processing: yes
>   - Encryption at rest + in transit: yes
>   - Admin MFA: yes
>   - Independent pen-test: [yes after C-4; no before]
>   - Founders / employees: 1
>   - Domicile: [state]
>
> Please send a quote and your underwriting questionnaire.
>
> Thanks,
> [Name]

---

## Done-by checklist

A buyer evaluating TransTrack should be able to flip through this and
mark every line:

- [ ] **C-2-a** Legal entity formed; certificate of incorporation on file
- [ ] **C-2-b** EIN issued (US) or equivalent
- [ ] **C-2-c** Business bank account opened
- [ ] **C-2-d** Vendor domain owned (e.g., transtrack.health)
- [ ] **C-2-e** Workspace email live for sales@, support@, security@
- [ ] **C-2-f** Privacy Policy + ToS published at the vendor domain
- [ ] **C-3-a** EV Code Signing certificate purchased and provisioned
- [ ] **C-3-b** Apple Developer Program enrolled, notarization creds in env
- [ ] **C-3-c** GitHub Actions secrets set for both platforms
- [ ] **C-3-d** Test release tag (`v1.3.0-rc1`) successfully signed in CI
- [ ] **C-4-a** Pen-test vendor selected, SOW signed
- [ ] **C-4-b** Pen-test executed
- [ ] **C-4-c** Redacted summary report available for diligence
- [ ] **C-4-d** All Critical/High findings remediated; report countersigned
- [ ] **C-5-a** IQ executed and signed (DIY or consultant)
- [ ] **C-5-b** OQ executed and signed
- [ ] **C-5-c** PQ executed and signed
- [ ] **C-5-d** Validation Summary Report (VSR) issued
- [ ] **C-11-a** Cyber liability $1M aggregate bound, COI on file
- [ ] **C-11-b** Tech E&O $1M aggregate bound, COI on file
- [ ] **C-11-c** General liability $1M / $2M bound, COI on file
- [ ] **C-11-d** Master COI added to `docs/legal/insurance/` for buyer review

Once every line above is checked, you can ship a customer-ready contract
package and answer every standard hospital security questionnaire with
real artifacts instead of "we plan to."
