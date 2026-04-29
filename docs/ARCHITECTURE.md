# TransTrack Architecture

## System Overview

TransTrack is an **offline-first, HIPAA-compliant Electron desktop application** for transplant waitlist and operations management. All data is stored locally in an AES-256 encrypted SQLite database. No cloud services are required.

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  Renderer Process (React SPA)                                         │
│                                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │   Pages      │  │  Components  │  │  api/localClient.js         │  │
│  │  Dashboard   │  │  PatientCard │  │  → window.electronAPI       │  │
│  │  Patients    │  │  DonorForm   │  │  → IPC invoke               │  │
│  │  Matching    │  │  Navbar      │  │                             │  │
│  │  Reports     │  │  ErrorBound. │  │  TanStack Query caching    │  │
│  │  Settings    │  │  40+ UI      │  │                             │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────────────┘  │
│         │                 │                      │                    │
│         └─────────────────┴──────────────────────┘                    │
│                              │                                        │
│                   contextBridge (preload.cjs)                         │
└──────────────────────────────┼────────────────────────────────────────┘
                               │  IPC (80+ channels)
┌──────────────────────────────┼────────────────────────────────────────┐
│  Main Process (Electron)     │                                        │
│                              │                                        │
│  ┌───────────────────────────┴──────────────────────────────────────┐ │
│  │  IPC Handler Coordinator (handlers.cjs)                          │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │ │
│  │  │  auth    │ │ entities │ │  admin   │ │ license  │           │ │
│  │  ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤           │ │
│  │  │ barriers │ │  ahhq    │ │  labs    │ │ clinical │           │ │
│  │  ├──────────┤ └──────────┘ └──────────┘ └──────────┘           │ │
│  │  │operations│                                                   │ │
│  │  └──────────┘    ← All share session state via shared.cjs      │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                              │                                        │
│  ┌───────────────────────────┴──────────────────────────────────────┐ │
│  │  Services Layer                                                   │ │
│  │  riskEngine · readinessBarriers · ahhqService · labsService      │ │
│  │  transplantClock · accessControl · disasterRecovery              │ │
│  │  complianceView · offlineReconciliation                          │ │
│  └───────────────────────────┬──────────────────────────────────────┘ │
│                              │                                        │
│  ┌───────────────────────────┴──────────────────────────────────────┐ │
│  │  Database Layer                                                   │ │
│  │  init.cjs (key management, encryption, migration)                │ │
│  │  schema.cjs (20+ tables, indexes, foreign keys)                  │ │
│  │  SQLCipher (AES-256-CBC, PBKDF2-HMAC-SHA512, 256k iterations)   │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Authentication
1. `AuthContext` → `api.auth.login(credentials)`
2. → IPC `auth:login` → bcrypt verify → session created (8-hour expiry)
3. Session stores `org_id` for downstream org isolation

### Entity CRUD
1. `api.entities.Patient.list()` → IPC `entity:list`
2. → `getSessionOrgId()` → org-scoped parameterized SQL
3. → Response → TanStack Query cache

### Business Functions
1. `api.functions.invoke('calculatePriorityAdvanced', { patient_id })`
2. → IPC `function:invoke` → function registry dispatch
3. → Priority scoring algorithm → DB update → audit log

## Security Architecture

| Layer | Mechanism |
|-------|-----------|
| **Data at rest** | AES-256-CBC via SQLCipher |
| **Key management** | 256-bit random key, file permissions `0o600` |
| **Org isolation** | `getSessionOrgId()` enforced on all queries; org_id never from client |
| **SQL injection** | Parameterized queries; `ALLOWED_ORDER_COLUMNS` whitelist |
| **Authentication** | bcrypt (cost 12), 8-hour sessions, 5-attempt lockout |
| **Audit trail** | Immutable `audit_logs` table, cannot be modified via API |
| **Access control** | Role-based with break-the-glass justification logging |

## Module Map

### Frontend (`src/`)
| Module | Files | Purpose |
|--------|-------|---------|
| Pages | 13 | Dashboard, Patients, DonorMatching, Reports, Settings, etc. |
| Components | 50+ | Domain components + Radix/shadcn UI primitives |
| API | 2 | `localClient.js` (Electron IPC) with dev mock fallback |
| Hooks | 2 | `useIsMobile`, `useJustifiedAccess` |
| Lib | 5 | Auth context, query client, navigation, utils |

### Electron Main (`electron/`)
| Module | Files | Purpose |
|--------|-------|---------|
| IPC Handlers | 25+ modules under `electron/ipc/handlers/` | Auth, entities, admin, MFA, barriers, aHHQ, labs, clinical, operations, organ-offer state machine, living-donor workflow, post-transplant follow-up, OPTN/SRTR exports, HL7, SIEM, calculators, predictions, inactivation-risk, etc. |
| Services | 10+ | Inactivation Risk Engine v2 (`inactivationRiskEngine.cjs`), risk engine v1, barriers, aHHQ, labs, clock, access, recovery, compliance, reconciliation |
| Database | `init.cjs`, `schema.cjs` (27 tables), `migrations.cjs` | Schema definitions, SQLCipher encryption, versioned migrations |
| License | `manager.cjs`, `tiers.cjs` (no-op stubs) | The licensing/activation system has been removed; these files exist as compatibility shims that always report fully licensed |
| Functions | `lib/` | Priority scoring, donor matching, FHIR import |

## Build Variants

The 1.0 distribution ships as a single unrestricted build. There are no
evaluation / enterprise variants, no watermark, no patient/user limits, and
no license activation requirement. (See `docs/DUE_DILIGENCE.md` §6 for the
full statement and the historical rationale.)

## Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 39 (`package.json` devDependency) |
| Frontend | React 18, Vite 6 |
| Styling | Tailwind CSS, Radix UI (shadcn) |
| State | TanStack React Query v5 |
| Forms | React Hook Form + Zod |
| Database | SQLite via better-sqlite3-multiple-ciphers (SQLCipher AES-256-CBC, PBKDF2-HMAC-SHA512 ≥256 000 iterations) |
| Charts | Recharts |
| Routing | React Router v6 (HashRouter) |
| Optional server tier | Fastify + PostgreSQL + FHIR R4 + SMART on FHIR v2 + CDS Hooks 1.1 + MLLP/TLS HL7 v2 (early-access; not part of the desktop build) |
| Operational scoring core | `electron/services/inactivationRiskEngine.cjs` — pure-function, deterministic, ~700 lines, zero external deps |
