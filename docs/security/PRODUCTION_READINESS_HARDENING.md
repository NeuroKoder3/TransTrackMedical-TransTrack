# Production Readiness — Security, Audit & Test Hardening

**Scope of this document:** the hardening pass applied to the offline Electron
desktop application (`electron/`, `src/`, `tests/`). It records what was added,
what was deliberately *not* changed to protect the Epic Connection Hub, the new
tests and how to run them, new setup/key-management requirements, and the
residual risks that remain.

This complements the existing control mappings rather than replacing them:

- [`docs/compliance/HIPAA_SECURITY_RULE_MAPPING.md`](../compliance/HIPAA_SECURITY_RULE_MAPPING.md)
- [`docs/compliance/PART_11_CONTROL_MAPPING.md`](../compliance/PART_11_CONTROL_MAPPING.md)
- [`docs/ENCRYPTION_KEY_MANAGEMENT.md`](../ENCRYPTION_KEY_MANAGEMENT.md)
- [`docs/THREAT_MODEL.md`](../THREAT_MODEL.md)

---

## 1. Epic Connection Hub — impact statement

**No Epic, FHIR, HL7, SMART-on-FHIR, or server-tier integration module was
modified, renamed, or refactored.** The following were untouched:

- `electron/services/` FHIR/HL7 modules and mappings
- `server/` in its entirety (Epic client credentials, JWT-bearer RS384, JWKS)
- `epic-keys/`, `EPIC_PRIVATE_KEY_FILE`, and all Epic scopes/client IDs
- every `fhir:*`, `hl7:*`, and `entity:*` IPC channel contract

Five changes touch shared infrastructure that Epic traffic passes through. Each
was made additive and is covered by a test that asserts Epic payloads still flow:

| Change | Epic exposure | How the risk was removed |
| --- | --- | --- |
| IPC argument validation (`electron/ipc/argValidation.cjs`) | Every channel, including `fhir:validate` and `hl7:ingest` | FHIR/HL7 channels are deliberately given **no per-channel schema**. They receive only universal structural guards (prototype-pollution keys, depth, size, circular refs) with an 8 MB budget sized for HL7 batches. Asserted by `tests/ipcArgValidation.test.cjs` (a real Epic FHIR bundle and a large HL7 batch must pass unchanged) and by `tests/e2e/hardening.spec.cjs`. |
| `sandbox: true` on the main window | The preload exposes the FHIR/HL7/EHR bridges and resolves the remote API base URL that selects Epic/remote mode | The preload no longer `require()`s local modules (impossible under sandbox); config arrives via `webPreferences.additionalArguments`. `tests/e2e/hardening.spec.cjs` launches the real app and asserts the FHIR, HL7, and four EHR entity bridges are present and callable, and that `transtrackConfig.apiBaseUrl` still reports the configured remote origin. |
| IPC sender validation (`electron/ipc/senderValidation.cjs`) | Every channel | Validates the *sender*, not the payload: only the registered main-window top frame with an allowlisted origin (`file://`, plus `localhost` in dev) may call IPC. Epic traffic originates in the main/server tier, not a sub-frame, so it is unaffected. |
| Screen-lock session locking (`electron/services/screenLock.cjs`) | Ends the session, so an in-flight Epic sync would fail authorization like any other request after a lock | Purely additive: a new `powerMonitor` listener plus one new `session:locked` push channel. No existing channel, handler, or bridge was altered, and the session semantics are the ones `validateSession()` already enforced on idle timeout. An interrupted sync fails closed and is retried after re-authentication — the same behaviour as an idle timeout mid-sync today. `tests/e2e/hardening.spec.cjs` asserts the FHIR/HL7/EHR bridges are unchanged and that the new channel delivers through the sandboxed bridge. |
| Secure deletion wiring (`electron/database/init.cjs`, `disasterRecovery.cjs`) | Backup and restore operate on the database Epic-synced records live in | Only the *deletion* of already-doomed files changed; no read, write, copy, or rename path was altered, and the service treats a missing file as success so no new failure mode is introduced. The pre-existing critical-path E2E test (login → patient → audit → **backup → restore**) passes unchanged. |

### Deliberately not changed — flagged gap

**`connect-src` in the static `<meta>` CSP was left wide (`http: https: ws: wss:`).**

Remote/Epic mode points the renderer at whatever origin `TRANSTRACK_API_URL`
names. A static HTML file cannot know that origin, so narrowing the meta policy
would break the Epic Connection Hub for any deployment whose API is not on
`localhost`. The main-process CSP response header already narrows `connect-src`
to `'self'` plus the exact configured API origin when not in dev, and because
multiple CSPs are AND-ed, **the header is the binding policy for a packaged
build**. The meta policy is the permissive one of the pair.

Residual effect: if the response header ever stopped being applied, the renderer
would fall back to the wide meta policy. `tests/e2e/hardening.spec.cjs`
(“the main-process CSP header reaches the renderer”) detects that regression by
reading `originalPolicy` from a real `securitypolicyviolation` event.

---

## 2. Pre-existing defects found and fixed

These were latent bugs in compliance-critical paths, not regressions introduced
by this work.

### 2.1 Audit chain verification reported false tampering (high)

`electron/ipc/shared.cjs` (the writer) and `electron/services/auditChain.cjs`
(the verifier behind the “verify audit chain” IPC) disagreed on two things:

- **Canonical payload:** the verifier included `user_id`; the writer did not.
- **Row ordering:** the verifier used `ORDER BY id ASC` over **UUID** primary
  keys — effectively random order — while the writer chained rows in
  `created_at ASC, rowid ASC` order.

Either alone guarantees a verification failure on real data, so the audit trail
would have been reported as tampered on any genuine database.

**Fix:** `electron/services/auditCanonical.cjs` is now the single source of truth
for the canonical payload, the signed string, and the chain ordering. Both the
writer and verifier import it. `tests/auditChain.test.cjs` gained a regression
test that writes rows through `shared.logAudit` and verifies them through
`auditChain.verifyAuditChain`, which is the contract that was previously untested.

### 2.2 `hasPermission()` threw on inherited property names (medium)

`ROLES[userRole]` used a bare index, so `hasPermission('constructor', …)` and
`hasPermission('toString', …)` resolved to `Object.prototype` members, returned
truthy, and then threw `TypeError: Cannot read properties of undefined` on
`.permissions.includes`. A thrown exception inside an authorization check is a
fail-open hazard depending on the caller's error handling.

**Fix:** `resolveRole()` performs an own-property lookup and validates shape, so
unknown, inherited, and malformed roles all fail closed to `false`. Pinned by
`tests/rbacMatrix.test.cjs`.

### 2.3 Deleting a user could abort or launder Part 11 records (medium)

`electronic_signatures.user_id` is `ON DELETE CASCADE`. Adding the Part 11
immutability trigger meant a hard user delete would abort; without the trigger,
it would have silently destroyed signature records.

**Fix:** `auth:deleteUser` now counts attribution records
(`electronic_signatures`, `access_justification_logs`, `audit_logs`). Users with
any such record are **deactivated** (`is_active = 0`), preserving attribution and
the existing API contract; only users with no recorded activity are hard-deleted.
Both paths are audited. Verified by `tests/auditImmutability.test.cjs`.

### 2.4 The audit key upgrade path was unreachable (medium)

Found by `tests/auditKeyGating.test.cjs` while gating the test-key override.

When an audit key existed as a legacy unprotected file and a keyring later became
available, `safeStorage.decryptString()` threw on the plaintext content and the
loader returned `null` immediately — never reaching the code that adopts and
re-seals such a key. Effect: a developer machine that gained a keyring (or a
deployment where `safeStorage` became available after first run) would
**permanently lose the audit HMAC key**, leaving every existing audit row
HMAC-unverifiable while also failing to mint a replacement.

**Fix:** a decrypt failure now falls through to the legacy-key check instead of
returning, so the key is adopted and immediately re-sealed. A genuinely corrupt
sealed key is still reported distinctly as `key_decrypt_failed` rather than being
confused with a missing keyring.

### 2.5 Backup rotation orphaned database sidecars (medium)

`disasterRecovery.cjs` copies the `-wal` and `-shm` sidecars alongside a backup
when they exist, but `cleanupOldBackups()` removed only the backup file and its
metadata. Two consequences: rotated-out backups left sidecar files behind
indefinitely, and those sidecars contain database pages — so data the operator
believed had aged out of the retention window was still on disk.

**Fix:** rotation now removes the sidecars with the backup, and does so through
the secure-deletion service. Pinned by `tests/secureDelete.test.cjs`.

### 2.6 Audit key file handling was open to a TOCTOU race (high)

Found by CodeQL (`js/file-system-race`, CWE-367) on the PR for this work — three
alerts, all in the new key loader.

The loader branched on `fs.existsSync(keyPath)` and then read or wrote that
*path*. Between the check and the operation the path could be swapped for a
symlink or an attacker-chosen key file. For an audit HMAC key that is the whole
ballgame: substituting the key lets an attacker re-HMAC a forged chain.

**Fix:** all key file I/O now goes through descriptors. The read opens `'r'` and
treats `ENOENT` as the "no key yet" signal instead of checking first; creation
uses `'wx'` (`O_CREAT|O_EXCL`) with the mode applied by the open, so it cannot
clobber a key another process just wrote and needs no separate `chmod`. A
concurrent creation losing the `O_EXCL` race adopts the winner's key rather than
overwriting it, which would have orphaned the rows that process had already
written.

Two further defects surfaced while fixing this:

- The first attempt re-sealed the legacy key by truncating in place. A crash
  between the truncate and the write would have left an empty file and **lost
  the audit key permanently**, making every existing row HMAC-unverifiable. The
  re-seal now writes a temp file and `rename()`s it over the target, which is
  atomic.
- The re-seal also had to happen *after* the read descriptor is closed: Windows
  refuses to rename over a file with an open handle, so the upgrade would have
  silently failed on the primary deployment platform.

### 2.7 Plaintext database wipe missed its WAL sidecar (medium)

The encryption migration overwrote the **unencrypted** database with zeros
before unlinking it, but only the main file. WAL frames hold copies of recently
written pages, so `*.db-wal` could retain plaintext PHI after a migration that
appeared to have wiped it.

**Fix:** the migration now wipes the main file and both sidecars through the
secure-deletion service (multi-pass, rename before unlink), replacing the inline
single-pass zeroing. Pinned by `tests/secureDelete.test.cjs`.

---

## 3. Controls added

### 3.1 Electron process hardening

`electron/main.cjs`, `electron/preload.cjs`

- `nodeIntegration: false`, `contextIsolation: true`, **`sandbox: true`** on the
  main window *and* the splash window (splash previously set neither `sandbox`
  nor `webSecurity` explicitly).
- `webSecurity: true`, `allowRunningInsecureContent: false`,
  `experimentalFeatures: false`, `enableRemoteModule: false`,
  `nodeIntegrationInSubFrames: false`.
- **Permission denial:** `setPermissionRequestHandler`,
  `setPermissionCheckHandler`, `setDevicePermissionHandler`, and
  `setBluetoothPairingHandler` all deny and log. Previously absent entirely, so
  camera, microphone, geolocation, and USB/HID/serial requests were left to
  Electron defaults.
- **Webview blocking** on `will-attach-webview`, plus a global
  `app.on('web-contents-created')` handler that blocks webviews and popups on
  *any* future `WebContents` (not just the main window).
- `hardenSession()` applies the above to `session.defaultSession` at
  `whenReady()`, so the splash window is covered too.
- CSP: `object-src 'none'`, `frame-src 'none'`, `worker-src 'self' blob:` added
  to both `index.html` and `src/index.html`. `script-src` is `'self'` with no
  inline allowance outside dev/test (see §1 for the `connect-src` exception).

Because a sandboxed preload cannot `require()` local modules, session-policy
values now travel from `electron/config/securityPolicy.cjs` (still the single
source of truth) through `webPreferences.additionalArguments`. The remote API
base URL is forwarded the same way as a defensive fallback; `process.env`
remains the primary source and takes precedence.

### 3.2 IPC trust boundary

`electron/ipc/senderValidation.cjs`, `electron/ipc/argValidation.cjs`,
wired into the existing `ipcMain.handle` wrapper in `electron/ipc/handlers.cjs`.

Order of enforcement, applied to **every** channel before any handler runs:

1. **Sender validation** — the registered main-window WebContents id, top frame
   only, origin allowlisted. Rejects sub-frames even from the trusted
   WebContents, and treats an unreadable `senderFrame` (destroyed frame in
   recent Electron) as untrusted.
2. **Argument validation** — universal structural guards for all channels:
   `__proto__`/`constructor`/`prototype` keys rejected at any depth, max depth
   64, 8 MB serialized budget, circular references, functions, symbols, and
   bigints rejected. Per-channel schemas apply only to a small set of sensitive
   channels (auth, entity, file, e-signature, license, settings).
3. Session restrictions, then rate limiting (both pre-existing).

### 3.3 Audit trail tamper-evidence

`electron/services/auditCanonical.cjs`, `auditHmacKey.cjs`, `auditChain.cjs`,
migration 16.

The pre-existing SHA-256 hash chain is **unkeyed**, so an attacker with write
access to the database file could edit a row and recompute every subsequent
`record_hash` to produce a chain that verifies cleanly. A keyed HMAC-SHA256 over
the same canonical bytes closes that hole; forging now also requires extracting
the key from the OS keystore under the installing user's account.

`tests/auditHmac.test.cjs` demonstrates precisely this: a full re-chaining attack
passes the hash chain and is caught by the HMAC.

Backward compatibility is explicit — rows written before migration 16 have no
HMAC and are reported as **unverifiable**, never as tampered, and a database
without the `record_hmac` column still verifies.

### 3.4 Audit record immutability (database-enforced)

`electron/database/schema.cjs`

`BEFORE UPDATE` / `BEFORE DELETE` `RAISE(ABORT)` triggers now cover:

| Table | Basis | Status before |
| --- | --- | --- |
| `audit_logs` | HIPAA 164.312(b) | already protected |
| `access_justification_logs` | HIPAA minimum necessary | documented as immutable, **enforced only in application code** |
| `electronic_signatures` | 21 CFR Part 11 | unprotected |

Trigger creation for the latter two is guarded in `try/catch` because the tables
do not exist on databases predating their migrations.

### 3.5 Inspection-ready audit export

`electron/services/auditExport.cjs`, `electron/ipc/auditReportHandler.cjs`

21 CFR 11.10(b) requires accurate and complete copies in **human-readable and
electronic** form. JSON alone did not satisfy the human-readable half. Added CSV
and self-contained HTML (no scripts, no remote assets) alongside JSON via
`compliance:export-audit-report`, with:

- **Before/after rendering** — modifications display as `field: "old" -> "new"`
  so prior values are not obscured (11.10(e)), instead of raw JSON.
- **CSV formula-injection neutralisation** — values beginning `=`, `+`, `-`, `@`
  are prefixed, so audit content cannot execute when opened in a spreadsheet.
- **HTML escaping** of all audit content.
- **Optional de-identification** — patient identifiers can be withheld.
- **Embedded integrity statement** — the chain/HMAC verdict is carried into the
  export, and a failed verification renders a prominent warning.

Access is restricted to `admin` and `regulator`, and each export is itself
audited.

### 3.6 Secure deletion

`electron/services/secureDelete.cjs`, `electron/database/init.cjs`,
`electron/services/disasterRecovery.cjs`, `electron/ipc/handlers/auth.cjs`

- `PRAGMA secure_delete = ON` — previously unset, so deleted PHI remained
  readable in freed database pages. Accepted write-amplification cost.
- Reusable file/directory wiping (multi-pass overwrite, rename before unlink,
  `fsync`), plus `withSecureTempFile()` which wipes even when the callback
  throws. The service never throws and treats an already-missing file as
  success, so it is a drop-in replacement at best-effort call sites.

The service is wired into every deletion site that touches a database file or a
credential:

| Call site | Artefact | Why it matters |
| --- | --- | --- |
| `init.cjs` — encryption migration | the **plaintext** database, plus its `-wal`/`-shm` sidecars | Holds unencrypted PHI. Previously a single-pass zero of the main file only; the WAL sidecar's copies of recently written pages were left intact. |
| `init.cjs` — migration failure | partially written `*.new` encrypted database | Contains PHI pages. |
| `init.cjs` — `backupDatabase` | an existing file at the backup target | A previous database copy. |
| `init.cjs` — restore failure | `*.restore-tmp` | A full database copy. |
| `disasterRecovery.cjs` — `createBackup` | an existing backup file | A previous database copy. |
| `disasterRecovery.cjs` — rotation | rotated-out backup, **its `-wal`/`-shm` sidecars**, metadata | The sidecars were copied on backup but never removed on rotation, so they accumulated as orphans holding database pages. |
| `auth.cjs` — `purgeSetupTokenFile` | `INITIAL_ADMIN_PASSWORD.txt` | The first-launch bootstrap credential. |

Log rotation in `errorLogger.cjs` is deliberately **not** covered: those files
are non-PHI by design, enforced by the pre-existing `tests/phiLeakage.test.cjs`
and `tests/siemRedaction.test.cjs`, so wiping them would add write
amplification for no confidentiality gain.

`tests/secureDelete.test.cjs` asserts each of these call sites structurally, so
reverting one to a bare `fs.unlinkSync` fails the build rather than silently
disarming the control.

### 3.7 OS screen-lock and suspend session locking

`electron/services/screenLock.cjs`, `electron/main.cjs`,
`electron/preload.cjs`, `src/components/session/IdleTimeoutManager.jsx`

Both the renderer's `IdleTimeoutManager` and the main-process check in
`ipc/shared.cjs` key off **inactivity**. Neither fired when a clinician locked
the workstation deliberately (Win+L), closed the lid, or the machine suspended:
the session stayed open for the remainder of the idle window, and PHI stayed
rendered — visible to whoever unlocked the workstation next.

An OS lock or suspend is now treated as an immediate end of session:

1. the `sessions` row is deleted, so the session cannot be resumed;
2. in-memory session state is cleared, so every later IPC call fails closed
   through the existing `validateSession()` path;
3. the event is written to the audit trail as `session.lock`, attributed to the
   user, naming the originating OS event, and carrying no PHI;
4. the renderer is notified on `session:locked` and returns to the login view,
   so PHI leaves the screen.

Step 2 is the enforcement; step 4 is presentation, and the control still holds
if the renderer ignores it. `resume` and `unlock-screen` are deliberately not
handled — re-authentication after an unlock is the required behaviour.

Subscribed events are `lock-screen` and `suspend`. Some Linux desktops do not
deliver `lock-screen`; the module degrades to whatever the platform reports
rather than failing. Every step is best-effort and the handler never throws, so
an OS transition can neither be blocked nor crash the app.

Relevant to HIPAA §164.312(a)(2)(iii) (automatic logoff) and §164.310(b)/(c)
(workstation use and security).

### 3.8 Local tampering detection

`electron/services/integrityMonitor.cjs`, `electron/services/healthCheck.cjs`

SHA-256 manifest over security-critical main-process files, sealed with an
HMAC key held in OS secure storage. Verified at startup and surfaced through the
health snapshot as a new `integrity` component (plus a new `auditTrail`
component reporting trigger presence and HMAC key availability).

It **reports** drift rather than blocking launch: bricking a clinical
application at the bedside over a failed self-check is the more dangerous
failure mode. A legitimate version change re-baselines instead of alarming.
`tests/integrityMonitor.test.cjs` confirms that editing a digest inside the
manifest invalidates the seal.

---

## 4. New tests and how to run them

262 new plain-Node assertions across 11 suites, plus 25 Playwright assertions
against the running application.

```bash
npm test               # all 37 Node suites (security + hardening + functional)
npm run test:security  # compliance-critical suites only
npm run test:hardening # the 11 new hardening suites
npm run test:list      # show every group and its suites
npm run test:e2e       # Playwright, includes tests/e2e/hardening.spec.cjs
```

Suites are declared in `scripts/run-test-suites.cjs`, which replaced a
34-command `&&` chain in `package.json`. It reports a per-suite pass/fail summary
instead of stopping at the first failure, and **fails the build if a listed suite
is missing from disk**, so a renamed test file cannot silently stop protecting
its control. Use `--bail` for the old fail-fast behaviour.

| Suite | Assertions | Covers |
| --- | --- | --- |
| `tests/electronHardening.test.cjs` | 28 | webPreferences on every window, preload requires nothing local, CSP directives (production and meta), IPC middleware ordering, SQLCipher + `secure_delete`, screen-lock registration |
| `tests/ipcSenderValidation.test.cjs` | 17 | trusted WebContents binding, sub-frame rejection, origin allowlist, dev-only localhost, unreadable `senderFrame` |
| `tests/ipcArgValidation.test.cjs` | 27 | prototype pollution, depth/size limits, non-serializable types, **and that Epic FHIR bundles / HL7 batches pass unchanged** |
| `tests/rbacMatrix.test.cjs` | 30 | the exact role × permission matrix (privilege-creep tripwire), admin-only permissions, read-only roles, separation of duties, fail-closed unknown roles, justification rules |
| `tests/auditHmac.test.cjs` | 14 | key management, full re-chaining attack caught by HMAC, forged HMAC rejected, pre-migration backward compatibility |
| `tests/auditKeyGating.test.cjs` | 39 | the test-key override is refused outside `NODE_ENV=test` and in packaged builds, warnings are emitted, unprotected key files are refused where the keyring is required, unrecognised `NODE_ENV` fails closed, the keyring path still mints/reloads/upgrades correctly, and key file I/O is race-safe (no `existsSync` branch, atomic `O_EXCL` create, no temp left after a re-seal) |
| `tests/auditImmutability.test.cjs` | 19 | database-enforced immutability of all three tables, append-only inserts still work, cascade-delete laundering blocked, transaction rollback |
| `tests/auditExport.test.cjs` | 27 | completeness, before/after rendering, CSV injection, HTML escaping, de-identification, integrity statement |
| `tests/secureDelete.test.cjs` | 21 | content overwritten before unlink, rename before unlink, temp wipe on throw, directory recursion, **and that every sensitive call site actually calls the service** rather than a bare unlink |
| `tests/integrityMonitor.test.cjs` | 19 | baseline creation, tamper detection, manifest forging, version re-baseline, never throws |
| `tests/screenLock.test.cjs` | 21 | session row deleted, in-memory state cleared so IPC fails closed, attributed audit entry with no PHI, renderer notified, both OS events wired, idempotent registration, partial platform support, and every failure mode survivable |
| `tests/e2e/hardening.spec.cjs` | 25 | **runtime** verification: sandbox/isolation on the live app, Node and Electron internals unreachable, frozen bridge, config transfer, **Epic FHIR/HL7/EHR bridge surface**, CSP enforcement via violation events, popup/webview denial, fail-closed IPC authorization, screen-lock delivery through the sandboxed bridge |

CI (`.github/workflows/ci.yml`) runs the security and hardening groups as their
own named step before `npm test`, so a compliance failure is distinguishable from
a functional regression in the log.

### Verification performed

- 37/37 Node suites pass, plus `test:services` (39) and `test:ipc` (26).
- 39/39 Playwright assertions pass against the launched application, of which
  **14 are pre-existing** and cover login, patient creation, audit log,
  encrypted backup, restore, and health — the strongest evidence that no core
  workflow regressed. The backup and restore steps exercise the paths where
  secure deletion was newly wired in.
- `npm run lint` and `npx tsc -p jsconfig.json --noEmit` are clean.

---

## 5. New configuration and key management

No new *required* environment variables. Nothing must be configured for the
hardening to take effect.

| Name | Purpose | Notes |
| --- | --- | --- |
| `TRANSTRACK_AUDIT_HMAC_KEY` | 64 hex chars (256-bit) audit HMAC key override | **Test/CI only, enforced in code.** Honoured only when `NODE_ENV=test` in an unpackaged build; ignored with a warning everywhere else. |
| `TRANSTRACK_ALLOW_TEST_KEYS` | Optional second opt-in for the above | If present it must be exactly `true`; any other value vetoes the override even under `NODE_ENV=test`. |

### The test-key gate

The override is a potential bypass — if honoured on a real installation, anyone
able to set an environment variable could choose the audit key and forge the
whole trail. It is therefore gated in code, not by convention. All three
conditions must hold: **unpackaged build**, `NODE_ENV` exactly `test`, and
`TRANSTRACK_ALLOW_TEST_KEYS` either absent or exactly `true`.

Anywhere else (production, staging, `qa`, an unset or misspelled `NODE_ENV`, any
packaged build) the variable is ignored, a warning naming it is logged, and
`system:getHealth` reports `auditTrail.testOverrideRejected` so the
misconfiguration surfaces in monitoring rather than only in the log.

Key sources, in order, with no production-reachable bypass of the keyring:

| Situation | Behaviour |
| --- | --- |
| Keyring available | Minted/loaded and stored `safeStorage`-encrypted. The only production path. |
| No keyring; `NODE_ENV` ∈ {`test`, `development`, unset}; unpackaged | A `0600` hex key file is permitted so contributors are not blocked, and is re-sealed automatically once a keyring appears. |
| No keyring; any other `NODE_ENV`; or packaged | **No key created, no file written.** Fails closed (`safe_storage_unavailable`). |
| An unprotected key file found where the keyring is required | **Refused** (`unprotected_key_file_refused`) — a planted plaintext key cannot become the audit key. |

`NODE_ENV` is matched against an **allowlist**, so an unrecognised value
(`prod`, `Production`, `dev`, `ci`) fails closed onto `safeStorage` rather than
being treated as a development environment.

### Keys created automatically

| Artefact | Location | Protection |
| --- | --- | --- |
| Audit HMAC key | `userData/.transtrack-audit-hmac` | `safeStorage` (DPAPI / Keychain / libsecret). A `0600` plaintext file is permitted **only** in unpackaged dev/test with no keyring, and is re-sealed as soon as one appears. |
| Integrity manifest seal key | OS secure storage | falls back to an unkeyed SHA-256 seal when no keyring exists |
| Integrity baseline | `userData/integrity-baseline.json` | HMAC-sealed |

**Operational requirements:**

1. **Back up the audit HMAC key with the database.** A restored database whose
   HMAC key is lost verifies its hash chain but reports every row as
   HMAC-unverifiable. The hash chain still protects those rows; the keyed layer
   cannot be reconstructed.
2. **A keyring is required on production hosts.** If `safeStorage` is
   unavailable outside dev/test, **no audit key is created at all** — nothing is
   written in plaintext. HMAC protection is skipped (the hash chain still
   applies) and the degradation is reported via the `auditTrail` health
   component. Headless Linux deployments need `libsecret` and an unlocked
   keyring.
3. **Do not set `TRANSTRACK_AUDIT_HMAC_KEY` outside CI.** It is refused in code
   anywhere but an unpackaged `NODE_ENV=test` build, and a host that has it set
   will report `auditTrail.testOverrideRejected` in the health snapshot.
4. **Re-baseline integrity after each upgrade.** Handled automatically on
   version change; a drift report on an unchanged version warrants
   investigation.
5. **Migration 16** (`record_hmac` on `audit_logs`) is forward-only and additive.
   Rows written before it remain valid and verifiable.

---

## 6. Residual risk and limitations

Honest accounting of what these changes do **not** achieve.

### Cryptographic and key-management limits

- **The audit HMAC key is readable by the account that runs the app.** OS secure
  storage protects against other users and offline file copying, not against
  malware executing as the logged-in clinician. A determined attacker with code
  execution as that user can call `safeStorage` themselves, extract the key, and
  forge the chain. Gating the test-key override and refusing unprotected key
  files raises the bar for an attacker who can only *write files* (they can no
  longer plant a key of their choosing), but it does not stop one who can
  *execute code* as that user. Genuine non-repudiation needs an append-only
  external sink — the existing SIEM forwarder is the mitigation, and forwarding
  should be enabled for any deployment where insider tampering is in scope.
- **Planting a key is detectable, not prevented.** If an attacker does replace
  the key, previously written rows fail HMAC verification, which
  `compliance:verify-audit-chain` reports. Detection depends on someone actually
  running that verification — it is not automatic.
- **The integrity monitor is self-referential.** An attacker who can modify
  application files can usually also modify the monitor. It detects opportunistic
  and accidental drift; it is not a substitute for OS-level code integrity
  (code signing plus Windows/macOS enforcement).
- **`PRAGMA secure_delete` does not defeat storage-level remanence.** On SSDs
  with wear levelling, and for WAL/journal files and OS-level snapshots, prior
  content may survive. Full-disk encryption remains the primary control for
  media disposal.
- **Multi-pass file overwriting has the same limitation** and is best-effort on
  copy-on-write and network filesystems. Wiping is also confined to the call
  sites listed in §3.6: a sensitive file deleted by some *future* code path gets
  no protection unless it is routed through the service.

### Scope limits

- **`connect-src` in the meta CSP remains wide** to preserve Epic remote mode
  (§1). The narrow policy is the response header.
- **`script-src 'unsafe-inline'` remains in the meta CSP** because the Vite dev
  server injects an inline preamble. The production build emits no inline
  script and the header sends `script-src 'self'`; the meta allowance is
  therefore inert in a packaged app but would matter if the header were lost.
- **Sender validation trusts the main window's origin, not its content.** It
  stops a rogue frame from reaching IPC; it does not stop XSS *inside* the
  trusted renderer from calling any bridge the logged-in user is authorized for.
  CSP and the absence of inline script are the mitigations.
- **Per-channel argument schemas are intentionally partial.** FHIR/HL7 channels
  have none, so a malformed-but-structurally-valid clinical payload is the
  handler's responsibility, exactly as before. This is a deliberate trade to
  protect the Epic integration.
- **Code signing is supported but not proven here.** `electron-builder` and
  notarization are configured; verification requires real credentials and a
  packaged build.
- **Immutability is enforced by SQLite triggers.** Anyone who can replace the
  database file, or open it with a client that recreates the schema without
  triggers, bypasses them. Detection then rests on the hash chain, the HMAC, and
  SIEM forwarding.
- **Screen-lock locking depends on the OS reporting the event.** `powerMonitor`
  does not deliver `lock-screen` on every Linux desktop (it needs a session bus
  the app can observe); those installs fall back to `suspend` plus the existing
  idle timeout. The control is therefore a *reduction* in the exposure window,
  not a guarantee that no session outlives a workstation lock. It also does not
  cover a user who simply walks away without locking — that remains the idle
  timeout's job.
- **The idle timeout is still refreshed by renderer activity.** Screen-lock
  locking closes the deliberate-lock gap but does not change the fact that
  `IdleTimeoutManager` drives the renderer-side countdown; the authoritative
  check in `ipc/shared.cjs` is what enforces it. A renderer that generates
  synthetic activity could extend its own session up to the absolute cap.

### Requires human process or external validation

- **Formal CSV validation** (IQ/OQ/PQ execution against the templates in
  `docs/compliance/templates/`) — these tests are engineering verification, not
  executed validation protocols.
- **Independent penetration testing** — scope is defined in
  `docs/security/PENETRATION_TEST_SCOPE.md`. Nothing here substitutes for it.
- **Audit log review, access recertification, and separation-of-duties
  enforcement** are procedural. The RBAC matrix makes least privilege
  *expressible* and pins it against drift; it cannot decide who should hold
  which role.
- **Retention** is designed for (append-only, immutable, exportable) but the
  retention *period* and archival destination are site policy — see
  `docs/compliance/policies/DATA_RETENTION_AND_DESTRUCTION.md`.
- **Performance under large datasets** is covered by `npm run test:load`; the
  `secure_delete` write-amplification cost has not been profiled against a
  multi-year production dataset.
