# Threat Model

## System Description

TransTrack is an offline-first Electron desktop application for managing transplant waitlists. It processes Protected Health Information (PHI) including patient demographics, medical scores, donor organs, and transplant matching results.

## Data Flow Diagram

```
┌───────────────┐
│  Medical Staff │
│  (End Users)   │
└───────┬───────┘
        │ Local workstation
        ▼
┌───────────────────────────────────────┐
│          TransTrack Desktop App        │
│  ┌─────────────┐  ┌────────────────┐  │
│  │  React UI   │  │  Electron Main │  │
│  │  (Renderer) │──│   (Node.js)    │  │
│  └─────────────┘  └───────┬────────┘  │
│                           │            │
│                   ┌───────▼────────┐   │
│                   │  SQLCipher DB  │   │
│                   │  (AES-256)     │   │
│                   └────────────────┘   │
└───────────────────────┬───────────────┘
                        │ Optional (FHIR)
                        ▼
                ┌───────────────┐
                │  External EHR  │
                │   (Optional)   │
                └───────────────┘
```

## STRIDE Analysis

### Spoofing
| Attack | Likelihood | Impact | Mitigation |
|--------|:----------:|:------:|------------|
| Credential theft | Medium | High | bcrypt hashing, account lockout, password policy |
| Session replay | Low | High | Server-side session with expiration |
| Impersonation | Low | Critical | Authentication required for all operations |

### Tampering
| Attack | Likelihood | Impact | Mitigation |
|--------|:----------:|:------:|------------|
| Database modification | Low | Critical | SQLCipher encryption, audit log immutability triggers |
| Priority score manipulation | Medium | Critical | Input validation (MELD 6-40, LAS 0-100, etc.) |
| Audit log alteration | Low | Critical | SQLite triggers prevent UPDATE/DELETE on audit_logs |
| Match result tampering | Low | Critical | All modifications audit logged with before/after values |

### Repudiation
| Attack | Likelihood | Impact | Mitigation |
|--------|:----------:|:------:|------------|
| Deny data access | Medium | High | Comprehensive audit logging (WHO/WHAT/WHEN/WHY) |
| Deny modifications | Medium | High | SHA-256 record hashing for immutability verification |

### Information Disclosure
| Attack | Likelihood | Impact | Mitigation |
|--------|:----------:|:------:|------------|
| Direct file access | Low | Critical | AES-256 encryption at rest |
| Error message leakage | Medium | Medium | Generic error responses, structured internal logging |
| Cross-org data access | Low | Critical | Organization isolation at query level, tested |
| XSS in notifications | Low | Medium | Patient name sanitization, CSP headers |
| DevTools inspection | Medium | High | DevTools disabled in production builds |

### Denial of Service
| Attack | Likelihood | Impact | Mitigation |
|--------|:----------:|:------:|------------|
| IPC flooding | Low | Medium | Rate limiting per handler |
| Database locking | Low | High | WAL mode, connection management |
| Disk exhaustion | Low | Medium | Log rotation, backup retention limits |

### Elevation of Privilege
| Attack | Likelihood | Impact | Mitigation |
|--------|:----------:|:------:|------------|
| Role escalation | Low | Critical | Role checks in all handlers, org-scoped queries |
| License bypass | Medium | Medium | Fail-closed licensing, clock-skew protection |
| Cross-org access | Low | Critical | Hard org_id scoping, comprehensive test suite |

## Risk Assessment Summary

| Risk Level | Count | Examples |
|:----------:|:-----:|---------|
| Critical | 3 | PHI exposure, score manipulation, cross-org access |
| High | 4 | Credential theft, audit tampering, DevTools |
| Medium | 5 | XSS, error leakage, license bypass, DoS |
| Low | 3 | Physical theft, keylogging, memory dumps |

## Residual Risks

These risks are outside the application boundary and must be mitigated by the deploying organization:

1. **Physical device security** — Use full-disk encryption (BitLocker/FileVault)
2. **Network security** — Use TLS 1.3 for any EHR integration endpoints
3. **Endpoint security** — Deploy EDR/antivirus on workstations
4. **User training** — Security awareness training for all users
5. **Key management** — Secure offline storage of encryption key backups

---

*Last updated: 2026-03-21*
