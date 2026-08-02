# 21 CFR Part 11 Control Mapping

| Document ID | TT-P11-001 |
| --- | --- |
| Version | 1.1 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Quality Assurance Officer |

Maps each Part 11 requirement to the TransTrack control that implements it.
Applies only when the deploying organization treats TransTrack records as
Part 11 electronic records.

This mapping describes design controls. It is not an assertion that any
organization's use of TransTrack is Part 11 compliant; that determination is
made by the organization, against its own records and its own intended use.

## Subpart B — Electronic Records

### §11.10 Controls for closed systems

| § | Requirement | TransTrack control |
|---|---|---|
| (a) | Validation of systems to ensure accuracy, reliability, consistent intended performance, and the ability to discern invalid or altered records. | `VALIDATION_PLAN.md`; executed vendor IQ and OQ in `executed/`; audit-chain verification at startup. Site IQ/OQ/PQ remain the deploying organization's responsibility — see `VALIDATION_SUMMARY_REPORT.md` and RR-05, RR-06. |
| (b) | The ability to generate accurate and complete copies of records in human-readable and electronic form. | CSV / PDF / Excel export with audit-logged producer; admin audit report. |
| (c) | Protection of records to enable accurate and ready retrieval throughout the records retention period. | SQLCipher with documented backup/restore SOP; retention policy. |
| (d) | Limiting system access to authorized individuals. | RBAC + MFA + lockout. |
| (e) | Use of secure, computer-generated, time-stamped audit trails. | Append-only `audit_logs` with DB-trigger immutability, a single fail-closed hash-chained writer, a monotonic per-org sequence, and chain verification at startup. |
| (f) | Use of operational system checks to enforce permitted sequencing of steps. | State machines (organ offers, AHHQ status, barriers). |
| (g) | Authority checks to ensure only authorized individuals can use the system, electronically sign a record, access the operation. | Role checks at every IPC handler. |
| (h) | Device checks to determine, as appropriate, the validity of the source of data input or operational instruction. | IPC channel + session validation; HL7/FHIR ingestion validated against schema. |
| (i) | Determination that persons who develop, maintain, or use electronic record systems have the education, training, and experience to perform their assigned tasks. | Vendor SDLC documentation; customer training program. |
| (j) | Establishment of, and adherence to, written policies that hold individuals accountable for actions initiated under their electronic signatures. | `policies/ACCESS_CONTROL_POLICY.md`. |
| (k) | Use of appropriate controls over systems documentation. | This `docs/compliance/` directory. |

### §11.30 Controls for open systems

Not applicable — TransTrack is operated as a closed system. If an open-system
deployment is contemplated, additional encryption-in-transit and digital signature
controls apply; see `policies/CHANGE_MANAGEMENT_SOP.md`.

### §11.50 Signature manifestations

| § | Requirement | TransTrack control |
|---|---|---|
| (a) | Signed electronic records shall contain the signer's printed name, the date and time, and the meaning of the signature. | Implemented by `electron/services/electronicSignature.cjs`. Each `electronic_signatures` row stores `user_id`, `user_email`, `user_full_name` (printed name), `signed_at` (ISO 8601 timestamp) and `meaning` (for example `accepted`, `declined`, `status_change:ACTIVE`). A parallel `electronic_signature` entry is written to `audit_logs`. |
| (b) | The above shall be subject to the same controls as for electronic records and shall be included as part of any human readable form. | `electronic_signatures` carries the same BEFORE UPDATE / BEFORE DELETE immutability triggers as `audit_logs` (`electron/database/schema.cjs`, `createAuditLogTriggers`). Signatures are retrievable for display and export through `esig:list`. |

### What the signature actually is

The distinction below is material and is stated here so that no reader mistakes
the implemented control for something stronger than it is.

TransTrack implements an **application-level electronic signature record**. On
signing, `signRecord()` computes:

```
signature_hash = sha256(user_id | meaning | entity_type | entity_id | payload_hash | signed_at)
```

where `payload_hash` is a SHA-256 of the specific values being signed (for an
organ offer transition: offer ID, target status and decline reason; for a
patient waitlist status change: patient ID, from-status and to-status). The
record therefore binds four things together — **signer identity, declared
meaning, a hash of the signed payload, and the signing timestamp** — and
`verifySignature()` detects any later alteration of those fields by recomputing
the hash.

It is **not** a PKI digital signature. There is no signer key pair, no
certificate, no certificate authority and no non-repudiation against the system
operator: any party with write access to the database file and knowledge of the
algorithm could in principle construct a consistent row. Its integrity rests on
the same controls as the audit trail — SQLCipher encryption at rest, the
immutability triggers, and the chained audit writer — not on asymmetric
cryptography. Organizations requiring cryptographic non-repudiation against the
operator must layer an external PKI e-signature provider on top.

| Property | Implemented | Notes |
|---|---|---|
| Signer identity bound to signature | Yes | `user_id`, `user_email`, `user_full_name` |
| Meaning of signature recorded | Yes | Free-text `meaning`, set by the calling handler |
| Signing timestamp | Yes | ISO 8601 `signed_at`, server-clock derived |
| Payload bound by hash | Yes | Caller-supplied SHA-256 of the signed values |
| Tamper-evident | Yes | `verifySignature()` recomputes `signature_hash` |
| Immutable storage | Yes | DB triggers reject UPDATE and DELETE |
| PKI / asymmetric key pair | **No** | Keyed hash of session-authenticated identity only |
| Certificate / CA trust chain | **No** | — |
| Non-repudiation vs. system operator | **No** | See RR-13 in `RESIDUAL_RISK.md` |
| Re-authentication at signing | **No** | Signs under the existing authenticated session; see §11.200 |

### §11.70 Signature/record linking

`electronic_signatures` rows carry `entity_type` + `entity_id` and a
`payload_hash` of the signed values, so a signature cannot be transplanted to a
different record or to a different version of the same record without
`verifySignature()` failing. Rows are additionally FK-linked to `users`. Audit
log rows remain FK-linked to `users` and to entity tables; any export of a
signed record includes the originating `audit_logs.id`.

Known gap: `iota_notifications` declares a `signature_id` column intended to
link an issued IOTA notice to the signature that authorized it, but no current
code path populates it. IOTA notices are therefore linked to their actor
through the audit trail only, not through a signature record.

## Subpart C — Electronic Signatures

### §11.100 General requirements

| § | Requirement | TransTrack control |
|---|---|---|
| (a) | Each electronic signature shall be unique to one individual and shall not be reused by, or reassigned to, anyone else. | Signatures are bound to `user_id`; user accounts are unique on `(org_id, email)` and are disabled rather than reassigned. Organizations must not recycle accounts — stated in `policies/ACCESS_CONTROL_POLICY.md`. |
| (b) | The organization shall verify the identity of the individual before establishing, assigning, or certifying an individual's electronic signature. | Deploying organization's responsibility; TransTrack has no identity-proofing function. |
| (c) | Certification to FDA that electronic signatures are the legally binding equivalent of handwritten signatures. | Deploying organization's responsibility. TransTrack makes no such certification on its behalf. |

### §11.200 Electronic signature components and controls

| § | Requirement | Status | TransTrack control |
|---|---|---|---|
| (a)(1)(i) | Non-biometric signatures shall employ at least two distinct identification components (e.g. ID code and password). | **Partial** | Signing occurs under an authenticated session established with user ID + password, and TOTP MFA where the organization enables it. The two components are supplied at session establishment, not at each signing event. |
| (a)(1)(i), first signing of a session | All signature components executed at the first signing of a continuous session. | **Not met as specified** | TransTrack does not prompt for credentials at the first signing; it relies on the credentials presented at login. |
| (a)(1)(i), subsequent signings | Subsequent signings shall use at least one component executable only by the individual. | **Partial** | Subsequent signings rely on the same session; there is no per-signature re-entry of a private component. |
| (a)(2) | Signatures not executed in a single continuous session shall use all components. | **Partial** | Session expiry and screen lock force re-authentication, which re-collects all components; but this is a session control, not a signature control. |
| (a)(3) | Signatures shall be used only by their genuine owners. | Organizational | Enforced by policy plus session controls (idle timeout, screen lock, lockout). |
| (b) | Biometric signatures shall be designed to ensure they cannot be used by anyone other than their genuine owner. | N/A | No biometric signatures. |

> **Gap statement.** TransTrack does not implement re-authentication at the
> moment of signing, so it does not literally satisfy §11.200(a)(1)(i) for the
> first signing of a session. An organization that requires strict §11.200
> conformance must either (a) configure a short idle timeout so that a signing
> event is in practice preceded by authentication, and document that
> compensating control in its own validation, or (b) layer an external
> e-signature provider that performs its own credential challenge and store the
> resulting evidence in TransTrack as an attached document. This gap is
> recorded as **RR-13** in `RESIDUAL_RISK.md`.

Superseded statement: earlier revisions of this document stated that TransTrack
"does not implement electronic signatures". That was inaccurate from the point
at which `electron/services/electronicSignature.cjs` and the
`electronic_signatures` table were introduced. The corrected position is above:
signature records exist, are immutable and are tamper-evident, but they are
application-level records rather than PKI digital signatures, and re-authentication
at signing is not implemented.

### §11.300 Controls for identification codes/passwords

| § | Requirement | TransTrack control |
|---|---|---|
| (a) | Maintaining the uniqueness of each combined identification code and password. | UNIQUE(org_id, email); password hashing per user. |
| (b) | Periodic checking, recalling, or revising of identification code and password issuances. | Password expiration with configurable interval. |
| (c) | Following loss management procedures to electronically deauthorize lost, stolen, missing, or otherwise potentially compromised tokens. | Admin can disable user; sessions invalidated; MFA backup-code revocation supported. |
| (d) | Use of transaction safeguards to prevent unauthorized use of passwords. | Account lockout after 5 failed attempts; rate limiting middleware. |
| (e) | Initial and periodic testing of devices that bear or generate identification code or password information. | TOTP secret rotation supported. |

## Verification

| Control area | Verifying test | Executed |
|---|---|---|
| Audit trail immutability and chaining (§11.10(e)) | `tests/auditImmutability.test.cjs`, `tests/auditChain.test.cjs` | Yes — see `executed/OQ_TT-OQ-001.md` |
| Electronic signature record structure and triggers (§11.50, §11.70) | `tests/auditImmutability.test.cjs`, `tests/compliance.test.cjs` | Yes — see `executed/OQ_TT-OQ-001.md` |
| Authority checks (§11.10(g)) | `tests/ipc-integration.test.cjs`, `tests/rbacMatrix.test.cjs` | Yes |
| Identification code and password controls (§11.300) | `tests/passwordHistory.test.cjs`, `tests/mfa.test.cjs`, `tests/business-logic.test.cjs` | Yes |
| Interactive signing workflow as used by a clinical user | Site PQ | No — deploying organization, see `executed/PQ_TT-PQ-001.md` |

## Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.0 | 2025-11-04 | Initial mapping. | Quality Assurance Officer |
| 1.1 | 2026-08-02 | Added document control header and the non-assertion statement. Corrected §11.50, §11.70, §11.100 and §11.200 to describe the electronic signature control that is actually implemented (`electron/services/electronicSignature.cjs`), including an explicit statement that it is not a PKI digital signature and that re-authentication at signing is not implemented (RR-13). Updated §11.10(a) and §11.10(e) to reference the executed validation package and the chained audit writer. Added a verification section. Closes finding M-17 item 4. | Quality Assurance Officer |
