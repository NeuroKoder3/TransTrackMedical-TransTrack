# Business Continuity & Disaster Recovery Plan

| Document control | |
|---|---|
| Document ID | TT-POL-BCDR-001 |
| Version | 1.1 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Information Security Officer |
| Procedural companion | [`../../DISASTER_RECOVERY.md`](../../DISASTER_RECOVERY.md) (TT-DR-001) |

> **This document is normative.** It sets the recovery objectives, retention
> rules and drill schedule for TransTrack deployments. The scenario-by-scenario
> execution steps live in TT-DR-001, which reproduces the objectives below for
> convenience and defers to this document where the two differ. A deploying
> organization adopting this plan should record its adoption, its named role
> holders and any site-specific tightening in its own quality system.

## 1. Recovery objectives

| Objective | Target | Basis |
|---|---|---|
| RTO (Recovery Time Objective) | ≤4 hours for full operational restore. | Time to provision a replacement host, install, restore and verify. |
| RPO (Recovery Point Objective) | **≤24 hours** of data loss in the worst case. | The application's built-in scheduler runs an automated backup every 24 hours (`electron/services/disasterRecovery.cjs`, `autoBackupIntervalHours: 24`). Worst case is the loss of one backup interval. |
| Backup frequency | Automated every 24 hours; on-demand admin backup at any time. | As above. |
| Backup retention | Daily for 30 days; weekly for 12 weeks; monthly for 12 months. | The application retains 30 automatic backups (`maxAutoBackups: 30`); longer retention requires the site to copy backups to its own retained storage. |
| Backup encryption | AES-256 at-rest; same key custody as primary database. | SQLCipher native backup API. |
| Backup verification | Weekly automated integrity check; monthly test restore. | `backup:create-and-verify`. |

**Single authoritative RPO.** Until 2026-08-02 this policy stated ≤24 hours
while TT-DR-001 stated 1 hour. The reconciled objective is **≤24 hours**, which
is what the product delivers without site engineering. A site requiring a
tighter RPO must achieve it through its own scheduling or storage snapshots and
must record the tighter objective, and the mechanism delivering it, in its own
business continuity plan. Doing so does not change the vendor objective stated
here.

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

Record every drill in the disaster recovery drill log in
[`../../../RUNBOOK.md`](../../../RUNBOOK.md#53-drill-log) §5.3. A drill
that is executed but not logged does not satisfy this clause: the evidence is
the record, not the activity.

> **Compliance status for release 1.3.0: no drill executed.** No quarterly
> restore drill has been performed against 1.3.0 by the vendor or by any site,
> so the RTO in §1 is a design target that has not been demonstrated. This is a
> known open item, recorded as residual risk **RR-11** in
> [`../RESIDUAL_RISK.md`](../RESIDUAL_RISK.md), and it is a precondition of
> Performance Qualification in
> [`../executed/PQ_TT-PQ-001.md`](../executed/PQ_TT-PQ-001.md).

## 5. Roles

| Role | Responsibility |
|---|---|
| ISO | Owns plan; approves drills. |
| System Admin | Executes restore; runs drills. |
| Vendor (TransTrack engineering) | Available for major-version migration assistance. |
| Communications Lead | Internal user notification. |

## 6. Approval

| Role | Signature | Date |
|---|---|---|
| Information Security Officer | _pending site execution_ | _pending site execution_ |
| Operations Director | _pending site execution_ | _pending site execution_ |

Signature blocks are completed by the deploying organization on adoption. The
vendor issues this document as a controlled policy; it becomes binding on a site
when that site's role holders sign it.

## Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.0 | — | Initial issue as a template. | Information Security Officer |
| 1.1 | 2026-08-02 | Declared normative for recovery objectives and reconciled the RPO with TT-DR-001, which stated a conflicting 1-hour objective (finding M-17 item 7). Recorded the basis of each objective against the implementation. Corrected backup frequency from "nightly" to the 24-hour scheduler interval the product actually uses. Added the drill-log requirement and the honest statement that no drill has been executed for 1.3.0 (RR-11). Added document control header and role titles to the approval block. | Information Security Officer |
