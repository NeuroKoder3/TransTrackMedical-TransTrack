# 21 CFR Part 11 Control Mapping

Maps each Part 11 requirement to the TransTrack control that implements it.
Applies only when the deploying organization treats TransTrack records as
Part 11 electronic records.

## Subpart B — Electronic Records

### §11.10 Controls for closed systems

| § | Requirement | TransTrack control |
|---|---|---|
| (a) | Validation of systems to ensure accuracy, reliability, consistent intended performance, and the ability to discern invalid or altered records. | Validation Plan + IQ/OQ/PQ; integrity check at startup. |
| (b) | The ability to generate accurate and complete copies of records in human-readable and electronic form. | CSV / PDF / Excel export with audit-logged producer; admin audit report. |
| (c) | Protection of records to enable accurate and ready retrieval throughout the records retention period. | SQLCipher with documented backup/restore SOP; retention policy. |
| (d) | Limiting system access to authorized individuals. | RBAC + MFA + lockout. |
| (e) | Use of secure, computer-generated, time-stamped audit trails. | Append-only `audit_logs` with DB-trigger immutability. |
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
| (a) | Signed electronic records shall contain the signer's printed name, the date and time, and the meaning of the signature. | Audit log entries record actor email, timestamp, action, entity. The application does not currently implement legally-binding electronic signatures (`§11.200`); customers requiring this must adopt an external e-signature flow before considering records "signed". |
| (b) | The above shall be subject to the same controls as for electronic records and shall be included as part of any human readable form. | Audit reports embed actor + timestamp. |

### §11.70 Signature/record linking

Audit log rows are FK-linked to `users` and to entity tables. Any export of a signed
record includes the originating `audit_logs.id`.

## Subpart C — Electronic Signatures

### §11.100 General requirements

* (a) Each signature is unique to one individual.
* (b) Identity is verified by the customer organization before issuing credentials.
* (c) Customer must certify to FDA in writing that electronic signatures are
  intended to be the legally binding equivalent of handwritten signatures.

### §11.200 Electronic signature components and controls

> **Status:** TransTrack v1.0 does **not** implement non-biometric electronic
> signatures requiring two distinct identification components per signing event
> as described in §11.200(a)(1)(i). The platform records authenticated actions
> with the user's identity, timestamp, and meaning, which satisfies the audit
> requirements of §11.10(e) but is not a substitute for §11.200 e-signature.
> Customers needing legally-binding e-signatures should integrate an external
> e-signature provider and store the signature evidence in TransTrack as an
> attached document.

### §11.300 Controls for identification codes/passwords

| § | Requirement | TransTrack control |
|---|---|---|
| (a) | Maintaining the uniqueness of each combined identification code and password. | UNIQUE(org_id, email); password hashing per user. |
| (b) | Periodic checking, recalling, or revising of identification code and password issuances. | Password expiration with configurable interval. |
| (c) | Following loss management procedures to electronically deauthorize lost, stolen, missing, or otherwise potentially compromised tokens. | Admin can disable user; sessions invalidated; MFA backup-code revocation supported. |
| (d) | Use of transaction safeguards to prevent unauthorized use of passwords. | Account lockout after 5 failed attempts; rate limiting middleware. |
| (e) | Initial and periodic testing of devices that bear or generate identification code or password information. | TOTP secret rotation supported. |
