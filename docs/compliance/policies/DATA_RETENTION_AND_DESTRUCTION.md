# Data Retention and Destruction Policy (Template)

| Document control | |
|---|---|
| Document ID | TT-POL-DR-001 |
| Version | 1.0 |

## 1. Purpose

Define how long different categories of data managed by TransTrack are retained
and how they are destroyed at end of life.

## 2. Retention windows

| Category | Minimum retention | Notes |
|---|---|---|
| Patient records (active) | Indefinite while patient is on waitlist | |
| Patient records (post-removal) | 10 years from removal | OPTN policy guidance; check state law |
| Audit logs (HIPAA Security Rule §164.316(b)(2)(i)) | 6 years from creation | |
| Backups | Per BCDR retention schedule | |
| Authentication logs | 1 year minimum | |
| Sessions | Active session duration only | |
| MFA secrets | Account lifetime | Destroyed on user deletion |
| MFA backup codes | Until used or replaced | Hashed, not recoverable |
| HIPAA policies and procedures | 6 years from creation or last effective date | §164.316(b) |
| Compliance documentation (validation reports, IQ/OQ/PQ) | 6 years from supersession | |

## 3. Destruction methods

| Medium | Method |
|---|---|
| SQLCipher database file | Cryptographic destruction by destroying the encryption key + secure delete the file |
| Backup files | As above |
| Paper output (printed audit reports) | Cross-cut shred; burned for high-sensitivity material |
| Decommissioned hosts | NIST SP 800-88 Rev. 1 compliant disk wipe; physical destruction for SSDs that fail crypto-erase |

## 4. Documentation of destruction

Every destruction event records:

* Date / time
* Asset identifier
* Method used
* Operator
* Witness (for high-sensitivity material)

Records retained 6 years per HIPAA documentation rule.

| Role | Signature | Date |
|---|---|---|
| ISO | | |
| Records Manager | | |
