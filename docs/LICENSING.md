# TransTrack Licensing — Operator's Guide

This document explains how the TransTrack license system works, how to
issue licenses to customers, how to rotate the publisher keypair, and
what to do when a license verification fails.

## At a glance

- **Trust anchor:** an Ed25519 publisher keypair. The *public* key is
  baked into every shipping build at
  `electron/license/publisherPublicKey.cjs`. The *private* key lives in
  `keys/license/license-private.pem` and **must never be committed**.
- **License file:** a single-line string with the prefix `LIC1.` —
  base64url payload, dot, base64url signature.
- **Per-customer:** every customer gets a unique signed license that
  encodes their org, tier, expiry, user/patient/install limits, feature
  flags, and (optionally) the SHA-256 of the machines they're bound to.
- **Trial mode:** with no license file present, the app runs for 30 days
  in full-feature trial mode, then locks creation paths until a license
  is activated.

## State machine

```text
                          launch
                            │
                            ▼
              ┌─────────────────────────┐
              │  license file present?  │
              └──────┬───────────────┬──┘
                yes  │               │  no
                     ▼               ▼
            ┌─────────────┐   ┌──────────────────┐
            │  verify()   │   │  trial expired?  │
            └─┬───────────┘   └──┬───────────┬───┘
       valid  │   invalid       no│           │yes
              ▼      ▼            ▼           ▼
           active  invalid     trial      trial_expired
          (or in_grace)
```

| Mode             | Reads | Writes | UI banner       |
| ---------------- | ----- | ------ | --------------- |
| `active`         | ✓     | ✓      | none            |
| `in_grace`       | ✓     | ✓      | amber renewal   |
| `trial`          | ✓     | ✓      | blue countdown  |
| `trial_expired`  | ✓     | ✗      | red, blocks UX  |
| `invalid`        | ✓     | ✗      | red, blocks UX  |

## Day-one setup (publisher)

1. Generate the **publisher keypair**:

   ```bash
   npm run license:keypair
   ```

2. Copy the printed `PUBLIC_KEY_BASE64` value into
   `electron/license/publisherPublicKey.cjs` (replace the development
   key).

3. Copy `keys/license/license-private.pem` to an **offline** location:
   - YubiKey / hardware security module (preferred), OR
   - encrypted USB drive in a fire safe (acceptable), OR
   - password-manager vault with TOTP-protected access (minimum).

4. **Never** commit `keys/license/` — it is already in `.gitignore`.

## Issuing a license to a customer

```bash
npm run license:issue -- \
  --private-key keys/license/license-private.pem \
  --customer-name "Cleveland Clinic" \
  --customer-email "it.admin@ccf.org" \
  --org-id "ccf-2026" \
  --tier enterprise \
  --expires 2027-12-31 \
  --max-patients 5000 \
  --max-users 100 \
  --max-installations 5 \
  --features all \
  --machines a1b2c3...,d4e5f6... \
  --out licenses/ccf-2027.lic
```

| Flag                  | Required | Notes                                                                 |
| --------------------- | -------- | --------------------------------------------------------------------- |
| `--private-key`       | yes      | path to the Ed25519 private PEM                                       |
| `--customer-name`     | yes      | human-readable customer name                                          |
| `--customer-email`    | yes      | billing / contact email                                               |
| `--org-id`            | yes      | stable, customer-unique slug; appears in every audit row              |
| `--tier`              | yes      | `evaluation` / `starter` / `professional` / `enterprise`              |
| `--expires`           | yes      | ISO date or `YYYY-MM-DD`                                              |
| `--maintenance-expires` | no      | defaults to `--expires`; set later for support-only renewals          |
| `--max-patients`      | yes      | use `-1` for unlimited                                                |
| `--max-users`         | yes      | use `-1` for unlimited                                                |
| `--max-installations` | yes      | informational unless `--machines` is set                              |
| `--features`          | no       | `all` (default) or comma-separated `FEATURES` flags                   |
| `--machines`          | no       | comma-separated *raw* machine IDs; omit for site licenses             |
| `--out`               | yes      | output path                                                           |

The customer activates by pasting the file's contents into
**Settings → License → Activate**, or running:

```bash
# In the renderer console (Dev menu):
await window.electronAPI.license.activate(LIC1_STRING)
```

## Verifying a license out-of-band

```bash
node -e "
const { verifyLicense } = require('./electron/license/issuance.cjs');
const { PUBLIC_KEY_BASE64 } = require('./electron/license/publisherPublicKey.cjs');
const fs = require('fs');
const wire = fs.readFileSync(process.argv[1], 'utf8').trim();
console.log(verifyLicense(wire, PUBLIC_KEY_BASE64));
" path/to/customer.lic
```

## Diagnosing a failed activation

When the desktop app reports activation failed, the manager returns a
`code` field with one of:

| Code                   | Meaning                                                                 | Fix                                                          |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `BAD_SIGNATURE`        | The signature did not verify against this build's publisher pubkey.     | The license was signed under a different key OR the file is corrupt. Re-issue. |
| `PROTOCOL_MISMATCH`    | License `protocolVersion` ≠ this build's `LICENSE_PROTOCOL_VERSION`.    | Customer needs to update their build OR you re-issue against the old protocol. |
| `EXPIRED`              | License is past `expiresAt` + grace window.                             | Renew via `license:issue`.                                    |
| `NOT_BOUND_TO_MACHINE` | This machine's fingerprint is not in `machineBindings`.                 | Get the machine ID from Settings → License → This Machine and re-issue. |

## Key rotation

Rotating the publisher key invalidates **every** in-the-wild license.
Procedure:

1. Generate a new keypair with `--force`.
2. Bump `LICENSE_PROTOCOL_VERSION` in `publisherPublicKey.cjs`.
3. Re-issue every active customer license against the new private key.
4. Cut a new release build (`v1.4.0` or similar).
5. Push the update to all customers via the auto-updater. Their existing
   `LIC1.` strings will fail with `PROTOCOL_MISMATCH` against the old
   build and `BAD_SIGNATURE` against the new build, so they have to
   activate the newly-issued file.
6. After everyone is migrated, archive the old private key (do **not**
   destroy it for at least 7 years — audit may require proving
   provenance of historical licenses).

## What this system is NOT

- It is **not** a hardware lock. The machine binding is a fingerprint
  hash, not a TPM-backed attestation; a determined attacker who controls
  both the source license file and the target machine can replicate the
  binding. The point is to raise friction high enough that casual
  key-sharing fails and an audit catches the rest.
- It is **not** a phone-home anti-piracy DRM. Activation happens
  entirely offline. We do not contact a remote server during verify.
- It is **not** a substitute for the EULA. The EULA defines what the
  customer is *allowed* to do; the license file enforces what the
  software *helps* them do.
