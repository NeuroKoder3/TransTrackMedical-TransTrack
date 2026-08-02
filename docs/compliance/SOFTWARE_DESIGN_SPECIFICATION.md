# TransTrack Software Design Specification (SDS)

| Document control | |
|---|---|
| Document ID | TT-SDS-001 |
| Version | 1.1 |
| Status | Baseline |
| Applies to software version | 1.2.1 |

## Revision history

| Ver | Change | Rationale |
|---|---|---|
| 1.0 | Baseline. | Initial issue. |
| 1.1 | Added §11 migration safety, §12 diagnostics and PHI redaction, §13 IOTA notification pipeline, §14 chart filing, §15 dependency vulnerability exceptions, §16 renderer bridge integrity. Extended §4 with the new tables. | Design record for the functionality added in software version 1.2.1. Sections are appended rather than interleaved so that existing §-references in the traceability matrix remain valid. |

## 1. Architecture overview

TransTrack is an Electron desktop application:

```
┌────────────────────────────────────────────────────────────────┐
│ Renderer (React + React Router + Tanstack Query)              │
│   - src/pages, src/components, src/api/localClient.js          │
└──────────────────────────────┬─────────────────────────────────┘
                               │ context-isolated IPC bridge
                               │ exposed via electron/preload.cjs
┌──────────────────────────────▼─────────────────────────────────┐
│ Main process (Node.js)                                         │
│   - electron/main.cjs (lifecycle, BrowserWindow, security)    │
│   - electron/ipc/handlers.cjs (handler registration)          │
│   - electron/ipc/handlers/*.cjs (per-domain handlers)         │
│   - electron/services/*.cjs (business logic)                  │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│ SQLCipher-encrypted SQLite (better-sqlite3-multiple-ciphers)   │
│   - electron/database/schema.cjs                               │
│   - electron/database/migrations.cjs                           │
└────────────────────────────────────────────────────────────────┘
```

## 2. Security boundaries

| Boundary | Mechanism |
|---|---|
| Renderer ↔ Main | `contextIsolation: true`, `nodeIntegration: false`, narrow API surface in preload. |
| Main ↔ Disk | All PHI tables live in the encrypted SQLCipher database; non-PHI artifacts (logs, crash dumps) are filtered. |
| Main ↔ Network | No outbound traffic by default. EHR sync, SIEM forward, FHIR validation, and update checks are explicit opt-in. |
| User ↔ Application | TOTP MFA + RBAC + idle timeout + DB-trigger audit immutability. |

## 3. Trust model

* The host OS account is trusted to be the user's account. Multi-user shared
  workstations require either separate OS accounts or session-based logout.
* The customer's IdP (when SSO is enabled) is trusted for primary authentication.
  The TOTP factor remains a TransTrack-issued secondary factor.
* The customer's SIEM is trusted to be reachable from the host. TransTrack only
  emits events; it does not query.

## 4. Data model summary

See `electron/database/schema.cjs` for the authoritative DDL. Core entities:

* `organizations`, `users`, `sessions`, `login_attempts`
* `patients` (waitlisted)
* `donor_organs`
* `matches`
* `organ_offers` (state machine — see TT-R066)
* `transplant_events`, `rejection_episodes`, `biopsies`,
  `immunosuppression_regimens`, `post_tx_readmissions` (post-transplant)
* `living_donors`, `living_donor_evaluations`, `living_donor_followups`
* `lab_results` (opaque), `required_lab_types`
* `readiness_barriers`, `adult_health_history_questionnaires`
* `audit_logs` (immutable), `access_justification_logs`
* `user_mfa`, `user_password_history`, `siem_destinations`
* `inactivation_predictions`, `outcomes_snapshots`, `srtr_metrics`, `tasks`
* `waitlist_status_transitions` (append-only), `iota_notifications` (see §13)

All PHI tables are scoped by `org_id`. Indexes enforce the lookup pattern.

## 5. Calculator services

`electron/services/calculators/*.cjs` contains pure-function clinical scoring
implementations:

| Module | Score |
|---|---|
| `meld.cjs` | MELD (original), MELD-Na, MELD 3.0, PELD |
| `las.cjs` | LAS (Lung Allocation Score, 2005 formula). |
| `kdpi.cjs` | KDPI / KDRI |
| `epts.cjs` | EPTS (Estimated Post-Transplant Survival) |

Each module exports `{ calculate, version, requiredFields, citation }`. They are
**deterministic, side-effect-free, and unit-tested**. The UI must show "Insufficient
data" when `requiredFields` are missing rather than substituting defaults.

## 6. Organ offer state machine

```
         ┌────────────┐
         │  PENDING   │── timer expires ──► EXPIRED
         └─────┬──────┘
   accept     │     decline / rescind
        ┌─────▼─────┐         ┌─────────────┐
        │ ACCEPTED  │         │  DECLINED   │
        └───────────┘         └─────────────┘
                              ┌─────────────┐
                              │  RESCINDED  │
                              └─────────────┘
```

* Decline reason codes are required when transitioning to `DECLINED`.
* Acceptance can be `PROVISIONAL` or `FINAL`. PROVISIONAL is recorded, FINAL freezes
  the offer.
* All transitions are audited.

## 7. Audit log immutability

`audit_logs` carries DB triggers that `RAISE(ABORT, 'HIPAA Compliance: Audit logs
are immutable')` on `UPDATE` or `DELETE`. The application layer additionally
proxies `db.prepare` to refuse those statements pre-emptively (see
`electron/ipc/shared.cjs`).

## 8. SIEM forwarding

`electron/services/siemForwarder.cjs` implements a write-only forwarder. Events
are queued in memory and written to the destination(s) via UDP, TCP, or TLS sockets
in RFC 5424 syslog format with a CEF (Common Event Format) payload. Backpressure
is handled by capping the queue at 10 000 events; oldest are dropped with a
warning record.

## 9. MFA

`electron/services/mfa.cjs` implements TOTP per RFC 6238 (HMAC-SHA1, 30-second
period, 6-digit codes) with ±1 step skew. Secrets are stored encrypted in the
SQLCipher database. Backup codes are 10 single-use, hash-stored codes per user.
Enrollment QR codes use the `otpauth://` URI format consumed by Google
Authenticator, Authy, and 1Password.

## 10. Coding standards

* Node modules in `.cjs` (CommonJS) for the Electron main process.
* React components in `.jsx` (ESM).
* All side-effecting handlers route through `shared.validateSession()` first.
* Migrations are forward-only and idempotent.

## 11. Schema migration safety

`electron/database/migrationSafety.cjs` wraps `runMigrations()` so that an
upgrade always has a restore point.

```
init.cjs
   └─ runMigrationsSafely(db, { dbPath, backupDir, logger })
         ├─ ensureMigrationsTable(db)          // fresh installs have no table yet
         ├─ getPendingMigrations(db)
         │     └─ none pending ──────────────► run nothing, take no copy
         ├─ createPreMigrationBackup()         // SQLCipher backup API, then verify
         │     └─ copy or verification fails ─► ABORT, database untouched
         ├─ runMigrations(db)
         │     └─ throws ────────────────────► rethrow with { reachedVersion, backupPath }
         └─ pruneOldBackups()                  // keep 5, secure-delete the rest
```

Design decisions:

* **The copy is conditional.** Taking it only when migrations are pending keeps
  ordinary startup fast and avoids accumulating identical copies of the database
  on every launch.
* **Failure to back up is failure to migrate.** `createPreMigrationBackup()`
  verifies the written file before migrations are allowed to proceed. A migration
  that cannot be undone is a worse outcome than a deferred upgrade, so the
  design fails closed (TT-R085).
* **The error carries the remedy.** A migration failure rethrows with the schema
  version actually reached and the absolute path of the copy, so the operator is
  not left to guess which of several backups predates the failure (TT-R086).
* **Retention is bounded and erasure is secure.** `MAX_PRE_MIGRATION_BACKUPS = 5`,
  files named `transtrack-premigration-*`, older ones removed through
  `secureDelete.cjs` because they are full copies of PHI (TT-R087).

## 12. Diagnostics: PHI redaction and support bundles

Two modules cooperate. `electron/services/phiRedaction.cjs` is the single source
of truth for scrubbing; `electron/services/logger.cjs` delegates to it so that a
log file and a support bundle cannot drift apart in what they consider sensitive.

| Concern | Mechanism |
|---|---|
| Structured PHI | `redactValue()` walks objects to arbitrary depth and replaces values whose key matches `PHI_KEYS`. |
| Patterned PHI in text | `redactText()` matches SSN, MRN, e-mail, phone, and date-of-birth shapes. |
| Free text | Withheld entirely — see below. |

**Free text is withheld, not filtered.** A patient name embedded in prose ("call
Zephyrina about her labs") cannot be reliably detected by pattern or key, and a
redactor that mostly works is worse than none because it invites the reader to
trust the output. `supportBundle.cjs` therefore replaces free-text values —
log `message` bodies, notes, descriptions — with `[FREE_TEXT_OMITTED]` plus a
character count, so support can see that content existed and how much
(TT-R126). `includeFreeText: true` overrides this, and the bundle then records
that choice in its own `redactionPolicy` and is labelled as requiring PHI
handling; the bundle never claims to be PHI-free when it is not (TT-R127).

`PHI_KEYS` deliberately excludes the bare key `name`. Over-redaction has its own
failure mode: a bundle that has scrubbed migration names, component names and
version strings is useless for diagnosis, and useless diagnostics stop being
collected. Specific identifiers (`first_name`, `last_name`, `patient_name`)
remain redacted.

`collectBundle()` gathers each section behind its own error boundary, so a
failing subsystem yields a bundle with one section marked in error rather than no
bundle at all — the case where diagnostics matter most is precisely when
something is broken. `readLogTail()` opens the log once and measures the
descriptor with `fstat` rather than stat-ing the path and then opening it,
because `logger.cjs` rotates those same files and a check-then-open sequence can
lose that race.

Export is admin-only and audit-logged, including whether free text was included
(TT-R128). `src/pages/SystemHealth.jsx` presents component health, schema
version, and the export control.

## 13. CMS IOTA notification pipeline

Implements the patient-notification duty in CMS IOTA Model § 512.442(d). The
design separates an immutable record of *what happened* from a mutable record of
*what we did about it*.

```
waitlist status change
   └─ iotaNoticeService.recordTransition()
        ├─ INSERT waitlist_status_transitions   (append-only; DB triggers)
        └─ offer-eligibility impact blocks offers?
              └─ yes ─► create notification obligation in the same operation
                          └─ iotaNoticeGenerator.generateNotice()  (pure)
                                └─ INSERT iota_notifications
```

**Layering.** `iotaNoticeGenerator.cjs` is a pure function: it takes a
transition, a patient, a centre and a template, and returns rendered content plus
derived metadata. It performs no I/O, which is what makes determinism testable
(TT-R079). `iotaNoticeService.cjs` owns persistence, delivery state and
reporting.

**Templates are the hospital's, not the vendor's.** The transplant hospital
supplies the notice language; `EXAMPLE_TEMPLATE` is a starting point that is
never applied implicitly (TT-R077). `validateTemplate()` rejects a template
missing any of the five statutory content elements or referencing an unknown
placeholder, and it does so at configuration time rather than when a patient's
notice is due (TT-R131). The statement that organ offers cannot be received
while inactive is system-supplied via `OFFER_ELIGIBILITY_STATEMENT` and cannot be
edited through template configuration, because it is the one sentence the rule
prescribes in substance.

**Deadlines derive from the record, not the clock.** `NOTICE_DUE_DAYS = 10` and
`ANNUAL_DUE_DAYS = 365` are applied to the transition's effective timestamp, so
regenerating a notice later cannot move a deadline.

**Idempotency identifies the obligation, not the document.** The key is
`transitionId:noticeKind:r{revision}` and deliberately excludes both
`generatedAt` and the content hash. Keying on content would let a retry whose
letterhead date has rolled over hash differently and file a *second* copy of the
same notice into the patient's chart — the exact outcome the
`UNIQUE(org_id, idempotency_key)` constraint exists to prevent. Superseding a
filed notice is therefore an explicit act: increment `options.revision`
(TT-R075).

**The transition survives a configuration gap.** If no usable template exists,
the transition is still recorded and the obligation is reported as unmet. The
transition establishes when the statutory clock started, so discarding it
because a notice could not be produced would destroy the only evidence of the
deadline (TT-R130).

**Partial discharge is visible.** A notice delivered to the patient but not
copied to a required dialysis facility, or delivered but not filed to the chart,
is reported as incompletely addressed rather than done. `decorate()` sets
`secondaryRecipientUnknown` where the duty exists but no recipient is on record
(TT-R134).

Immutability is enforced at the database: `iota_notifications` permits lifecycle
columns (delivery, secondary notification, chart filing) to change while a
trigger rejects any change to the transition reference, notice kind, content
hash, generator version, due date, generation timestamp, or idempotency key
(TT-R074). Migration 18 added `content` and `template_sha256` so a filed notice
can be reproduced and verified against its frozen hash (TT-R135).

## 14. Chart filing (FHIR R4 DocumentReference)

`electron/services/chartFiling.cjs` turns a generated notice into a FHIR R4
`DocumentReference` for the patient's chart. Three modes:

| Mode | Behaviour |
|---|---|
| `dry_run` | Build and validate the resource; transmit nothing; return it for inspection. |
| `fhir_documentreference` | Build, validate, and submit through a caller-supplied transport. |
| `manual` | Record that the copy was filed by another route (interface engine, HL7 `MDM^T02`, or by hand). |

**The transport is injected, never resolved internally.** `fileNotice()` takes a
`submit` function as an argument. There is no configuration value that turns on
outbound transmission by itself (TT-R153). This keeps the offline-first claim
verifiable by inspection: a reviewer reading `chartFiling.cjs` can see that the
module cannot reach the network on its own, and the sole caller that supplies a
real transport is visible in the IPC layer.

**Filing refuses to proceed on a content mismatch.** `buildDocumentReference()`
re-hashes the stored notice body and compares it to the recorded hash, so a
tampered or truncated notice is never filed (TT-R151).

`dry_run` exists because a site's Epic organisation must complete four
enablement steps before `DocumentReference.Create` will succeed. Dry run lets a
pilot demonstrate the whole path — generation, validation, resource shape —
before that work lands, rather than blocking pilot readiness on a third party
(TT-R152). `manual` covers sites that will never get FHIR write access and file
through an interface engine instead (TT-R155).

Failures are recorded with their cause and remain retryable; a notice already
filed is not filed again (TT-R154). The document type defaults to LOINC
`74213-0` (`SUGGESTED_TYPE_CODING`) and is overridable per site, because document
type catalogues are configured per Epic organisation.

Client-side write support (`fhirPost`, `createDocumentReference`) lives in
`server/src/integrations/epic/client.js`. `fhirPost` does not retry:
re-POSTing a document whose response was lost risks duplicating it in the chart,
so retry is a decision for the caller with the idempotency key in hand, not a
default of the transport. `system/DocumentReference.write` is excluded from the
default scope set and must be added deliberately.

## 15. Dependency vulnerability exceptions

`scripts/audit-with-exceptions.mjs` runs `npm audit` and reconciles its findings
against `security/vulnerability-exceptions.json`, which follows the CycloneDX VEX
vocabulary. The gate fails when a finding is undocumented, when an exception has
passed its `reviewBy` date, when a finding's severity has risen above what the
exception assessed, or when an exception no longer matches any real finding.

The last two conditions matter as much as the first. An exception that has gone
stale is a claim nobody has checked, and an expiry date that does not fail the
build is not an expiry date. The mechanism is designed to make "we assessed this
and it does not affect us" an auditable, decaying statement rather than a
permanent suppression.

## 16. Renderer bridge integrity

The renderer↔main seam is the one place where a mistake compiles cleanly, passes
unit tests, and fails only in a packaged build — a call to `api.x.y()` that no
preload method backs is a runtime error the developer never sees in `dev` mode.
`tests/rendererBridgeCoverage.test.mjs` statically collects every
`api.<namespace>.<method>()` in the renderer and checks it against the *real*
surface of `electron/preload.cjs`, loaded by injecting a fake `electron` module.
Verifying against the genuine preload rather than a hand-maintained list is the
point: a stub would drift and re-open the gap it exists to close.

`tests/buildEntryIntegrity.test.mjs` asserts that the source `index.html` still
loads `/src/main.jsx` and carries no hashed build-output references, guarding
against a build artifact overwriting the source entry point.

## 17. Release artifact authenticity

A receiving site's only means of confirming that an installer came from the
vendor and arrived unmodified is its code signature. Two controls protect that
property.

**Signing modes.** `scripts/sign-win.cjs` supports Azure Artifact Signing
(`azure`), a cloud HSM holding a CA-issued certificate (`ssl_esigner`), a
PKCS#12 file (`pfx`), and an explicit unsigned developer build (`skip`). The
first two keep the private key off the build machine entirely: the signature is
produced by the service, and the build host holds only a credential authorising
it to request one. This is the property that matters for a vendor of regulated
software, because it bounds what an attacker gains by compromising a build
machine — they can request signatures while their access lasts, but they cannot
take the key.

Azure Artifact Signing certificates are valid for three days, so the signature
outlives the certificate only by virtue of a trusted timestamp. The signer
always timestamps, and the timestamp authority is not left to a default that
could drift, because an untimestamped artifact verifies for three days and then
begins failing at receiving sites with nothing about it having changed.

**Fail closed on a designated release.** `scripts/sign-win.cjs` and
`scripts/notarize.cjs` both distinguish a developer build, where a missing
certificate is a warning, from a distribution build, where it is a build
failure. The distinction is drawn from `TRANSTRACK_RELEASE_CHANNEL=public` or
the explicit `TRANSTRACK_REQUIRE_SIGNING` / `TRANSTRACK_REQUIRE_NOTARIZATION`
flags; `.github/workflows/release.yml` sets the former on both build jobs. A
mode named explicitly whose credentials are incomplete is also an error rather
than a fall-through to `skip`, and the error names the missing variable.

The previous fail-open behaviour was the more dangerous configuration precisely
because it was quiet: the build went green, and the operator's belief that the
artifact was signed was never contradicted until a customer's machine refused
it.

**Verify the artifact, not the intent.** `scripts/verify-artifact-signature.mjs`
inspects the produced installer. On Windows it takes the operating system's
verdict via `Get-AuthenticodeSignature` and requires `Valid`. On other platforms
— the release gate runs on Linux — it parses the PE Attribute Certificate Table
directly, which establishes that a signature is embedded but not that it chains
to a trusted root; the result records that reduced assurance explicitly rather
than overstating what was checked.

A catalog-only signature is rejected even when Windows reports it valid. Catalog
signatures reside in a system-wide store rather than in the file, so they do not
travel with a downloaded installer and cannot serve as evidence of authenticity
at the receiving site. Because the deciding fact is read from the file, this
rejection holds even where the operating system cannot be consulted.

The absence of an operating system verdict is distinguished from a negative one.
Not every host can evaluate a trust chain — a build machine without network
cannot complete a revocation check, and one hosted runner returns no verdict at
all — and treating that silence as "not signed" would reject a correctly signed
artifact for a reason having nothing to do with the artifact. Where no verdict
is obtainable, the result is the same reduced assurance a non-Windows host
reports, with the cause stated. Windows' own `UnknownError` is treated the same
way, since it means the same thing. Statuses that are conclusions — `NotSigned`,
`HashMismatch`, `NotTrusted` — remain rejections.

This means the strongest available evidence depends on where the check runs, so
OQ-147 has the receiving site verify the installer on its own hardware. That is
the only execution of this check that does not depend on the vendor's build
environment being able to answer.

`scripts/release-readiness-check.mjs` calls the verifier, so the gate's
"code-signed installer present" item now reflects the artifact's actual contents
rather than its filename.
