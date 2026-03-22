# HIPAA Business Associate Agreement (BAA) Requirements

## Legal Requirements

TransTrack processes Protected Health Information (PHI) as a **Business Associate** under HIPAA. Any Covered Entity deploying this system **MUST** have a signed BAA with TransTrack Medical Software before processing PHI in production.

## Who Needs a BAA?

| Party | Role | BAA Required? |
|-------|------|---------------|
| Hospital / Transplant Center | Covered Entity | N/A (they are the CE) |
| TransTrack Medical Software | Business Associate | **YES** - must sign BAA with CE |
| Cloud hosting provider (if any) | Subcontractor | YES - must sign BAA with TransTrack |
| EHR vendor (FHIR integration) | Business Associate | YES - must sign BAA with CE |

## BAA Minimum Provisions (45 CFR 164.504(e))

A compliant BAA with TransTrack must include:

1. **Permitted Uses**: TransTrack may only use PHI for the purpose of providing transplant waitlist management services
2. **Safeguards**: TransTrack implements administrative, physical, and technical safeguards including:
   - AES-256-CBC database encryption (SQLCipher)
   - Role-based access control
   - Immutable audit logging
   - Session management with expiration
3. **Breach Notification**: TransTrack will notify the Covered Entity within 24 hours of discovering a breach
4. **Subcontractors**: TransTrack will ensure any subcontractors agree to the same restrictions
5. **Access to PHI**: TransTrack will make PHI available to individuals as required by the HIPAA Privacy Rule
6. **Amendment**: TransTrack will incorporate amendments to PHI as directed by the CE
7. **Accounting of Disclosures**: TransTrack will provide an accounting of disclosures as required
8. **Termination**: Upon termination, TransTrack will return or destroy all PHI

## TransTrack's Technical Safeguards (for BAA Reference)

| HIPAA Requirement | TransTrack Implementation |
|-------------------|---------------------------|
| 164.312(a)(1) Access Control | Role-based access, session management, license enforcement |
| 164.312(a)(2)(iv) Encryption | AES-256-CBC via SQLCipher, PBKDF2-HMAC-SHA512 key derivation |
| 164.312(b) Audit Controls | Immutable audit logs with DB triggers, structured logging |
| 164.312(c)(1) Integrity | Input validation, medical score range checking, record hashing |
| 164.312(d) Authentication | Password hashing (bcrypt, 12 rounds), account lockout |
| 164.312(e)(1) Transmission | Local-only architecture, CSP headers, no external PHI transmission |

## Deployment Without BAA

- **Evaluation/Demo**: May be used with synthetic/test data only (no real PHI)
- **Production**: **MUST NOT** process real PHI without a signed BAA

## Contact

To request a BAA or discuss compliance requirements:
- Email: Trans_Track@outlook.com
- Subject: "BAA Request - [Organization Name]"

---

*This document does not constitute legal advice. Consult your compliance officer and legal counsel for BAA review.*
