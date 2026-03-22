# Database Encryption Key Management

## Overview

TransTrack uses SQLCipher to encrypt all patient data at rest. This document describes the key management procedures required for HIPAA compliance and FDA 21 CFR Part 11.

## SQLCipher Configuration

| Parameter | Value | Standard |
|-----------|-------|----------|
| **Algorithm** | AES-256-CBC | FIPS 140-2 Validated |
| **Key Derivation** | PBKDF2-HMAC-SHA512 | NIST SP 800-132 |
| **KDF Iterations** | 256,000 | Exceeds OWASP minimum |
| **Page Size** | 4,096 bytes | SQLCipher default |
| **HMAC** | SHA-512 | Page-level authentication |
| **Key Length** | 256 bits (64 hex chars) | AES-256 standard |

## Key Storage

### Location
```
<userData>/
├── .transtrack-key         # Primary encryption key (mode 0600)
├── .transtrack-key.backup  # Backup copy of encryption key (mode 0600)
└── transtrack.db           # Encrypted database
```

### File Permissions
- Keys are stored with `0600` permissions (owner read/write only)
- Keys are stored in the Electron `userData` directory (OS-specific secure location)

### Platform-Specific Paths
| Platform | Path |
|----------|------|
| Windows | `%APPDATA%/TransTrack/` |
| macOS | `~/Library/Application Support/TransTrack/` |
| Linux | `~/.config/TransTrack/` |

## Key Generation

1. A 256-bit key is generated using `crypto.randomBytes(32)` (Node.js CSPRNG)
2. The key is stored as a 64-character hexadecimal string
3. A backup copy is automatically created alongside the primary key
4. The key is applied to SQLCipher using the hex key format: `x'<key>'`

## Key Rotation

TransTrack supports key rotation via the `rekeyDatabase()` function:

1. A new 256-bit key is generated
2. SQLCipher's `PRAGMA rekey` re-encrypts the entire database
3. The old key is backed up as `.transtrack-key.backup.old`
4. The new key replaces both primary and backup key files
5. An audit log entry records the rotation event

### Recommended Rotation Schedule
- **Minimum**: Annually
- **Recommended**: Quarterly
- **Required**: After any suspected key compromise

## Backup Procedures

### Key Backup
1. The backup key (`.transtrack-key.backup`) is automatically maintained
2. Administrators should also maintain an offline copy in a secure location (e.g., hardware security module, sealed envelope in a safe)
3. Key backups must be stored separately from database backups

### Database Backup
1. Database backups created via `backupDatabase()` retain the same encryption
2. The backup file requires the same encryption key to open
3. Backup integrity is verified via `backup:create-and-verify` handler

## Key Loss Recovery

If both the primary key and backup are lost:
- **The database cannot be decrypted** — this is by design (HIPAA requirement)
- The organization must restore from a backup where the key is known
- Contact TransTrack support for assistance with recovery procedures

## Compliance Requirements

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| HIPAA 164.312(a)(2)(iv) Encryption | AES-256-CBC at rest | ✅ |
| HIPAA 164.312(e)(2)(ii) Encryption in transit | Local-only architecture | ✅ |
| FDA 21 CFR Part 11 | Validated encryption, audit trail | ✅ |
| NIST SP 800-111 | Full-database encryption | ✅ |
| PCI DSS Requirement 3 | Key management procedures documented | ✅ |

## Audit Trail

All key management operations are logged:
- Key generation (initial setup)
- Key rotation (rekey events)
- Database migration (unencrypted → encrypted)
- Backup creation

---

*Last updated: 2026-03-21*
