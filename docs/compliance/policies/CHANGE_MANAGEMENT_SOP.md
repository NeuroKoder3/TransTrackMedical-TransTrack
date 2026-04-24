# Change Management SOP (Template)

| Document control | |
|---|---|
| Document ID | TT-POL-CM-001 |
| Version | 1.0 |

## 1. Scope

Applies to all changes to TransTrack software, configuration, and supporting
infrastructure (host OS, network, SIEM destinations, IdP).

## 2. Change classes

| Class | Description | Approver | Validation |
|---|---|---|---|
| Standard | Pre-approved routine task. | None per change. | None per change. |
| Normal | Non-emergency change. | Change Advisory Board. | Delta validation if affects validated function. |
| Emergency | Required to address active incident. | ISO + on-call admin. | Post-implementation review + delta validation within 14 days. |
| Major release | New TransTrack major version. | CAB + QA Officer. | Full IQ + OQ + PQ. |

## 3. Change request lifecycle

1. Submit Change Request in customer ITSM with:
   * Description and justification
   * Affected validated functions
   * Risk assessment (link to Risk Register)
   * Backout plan
   * Test evidence
2. CAB review (or ISO for Emergency).
3. Schedule and communicate.
4. Execute in maintenance window.
5. Post-implementation verification (smoke test from PQ).
6. Update documentation (release notes, validation summary if affected).
7. Close Change Request.

## 4. Vendor releases

* TransTrack vendor publishes signed release notes and a hash manifest.
* Customer verifies installer signature and manifest before installing.
* Major version installs trigger full IQ/OQ/PQ.
* Patch version installs trigger delta OQ on impacted requirement IDs.

## 5. Configuration change examples

| Change | Class |
|---|---|
| Add a new user | Standard |
| Modify password rotation interval | Normal |
| Add SIEM destination | Normal |
| Rotate encryption key | Normal (audited admin action) |
| Restore from backup | Emergency or Normal depending on cause |
| Upgrade from vX.Y to vX.(Y+1) | Normal + delta validation |
| Upgrade from vX to v(X+1) | Major release |

| Role | Signature | Date |
|---|---|---|
| ISO | | |
| QA Officer | | |
| CAB Chair | | |
