# Business Continuity & Disaster Recovery Plan (Template)

| Document control | |
|---|---|
| Document ID | TT-POL-BCDR-001 |
| Version | 1.0 |

## 1. Recovery objectives

| Objective | Target |
|---|---|
| RTO (Recovery Time Objective) | ≤4 hours for full operational restore. |
| RPO (Recovery Point Objective) | ≤24 hours of data loss in the worst case. |
| Backup frequency | Nightly automated backup; on-demand admin backup. |
| Backup retention | Daily for 30 days; weekly for 12 weeks; monthly for 12 months. |
| Backup encryption | AES-256 at-rest; same key custody as primary database. |
| Backup verification | Weekly automated integrity check; monthly test restore. |

## 2. Backup architecture

* Source: encrypted SQLCipher database file.
* Mechanism: TransTrack admin Backup function — uses SQLCipher native backup
  API; produces encrypted backup file.
* Destination: customer-controlled storage (NAS, S3-compatible bucket, or
  external drive). Storage must be encrypted at rest.
* Offsite copy: at least one weekly copy must reside in a geographically
  separate facility.

## 3. Restore procedure

1. Provision a host meeting the IQ specification.
2. Install TransTrack vX.Y.Z (matching the version that produced the backup;
   version skew across major releases requires a documented migration plan).
3. Place the backup file at the application data directory.
4. Run TransTrack admin Restore.
5. Verify integrity check passes.
6. Verify migration status: `pending: 0`.
7. Verify a known sample of patients is present and unmodified.
8. Re-enable user access; communicate restoration.

## 4. Drill schedule

* Quarterly: file-restore drill on a non-production host.
* Annually: full-host failure simulation including network restoration and
  user notification.
* Document outcomes and gaps; update plan.

## 5. Roles

| Role | Responsibility |
|---|---|
| ISO | Owns plan; approves drills. |
| System Admin | Executes restore; runs drills. |
| Vendor (TransTrack engineering) | Available for major-version migration assistance. |
| Communications Lead | Internal user notification. |

| Role | Signature | Date |
|---|---|---|
| ISO | | |
| Operations Director | | |
