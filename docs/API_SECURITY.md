# IPC Security Model

## Overview

TransTrack uses Electron's IPC (Inter-Process Communication) for all renderer-to-main process communication. This document describes the security model.

## Architecture

```
┌──────────────┐      contextBridge      ┌──────────────┐
│   Renderer   │ ───── ipcRenderer ────▸ │    Main      │
│   (React)    │                          │   Process    │
│              │ ◂── ipcRenderer.on ──── │              │
│  No Node.js  │                          │  Full Node   │
│  No require  │                          │  SQLCipher   │
└──────────────┘                          └──────────────┘
```

## Security Controls

### 1. Context Isolation
- `contextIsolation: true` — renderer cannot access Node.js or Electron APIs directly
- `nodeIntegration: false` — no `require()` in renderer
- `enableRemoteModule: false` — remote module disabled

### 2. Preload Bridge (`preload.cjs`)
- Uses `contextBridge.exposeInMainWorld` to expose a typed API
- Only whitelisted IPC channels are accessible
- No raw `ipcRenderer.send/invoke` exposed to renderer

### 3. Session Validation
Every IPC handler validates the current session:
```
if (!shared.validateSession()) throw new Error('Session expired');
```

### 4. Organization Scoping
All data queries include `org_id`:
```sql
SELECT * FROM patients WHERE org_id = ? AND id = ?
```

### 5. Rate Limiting
- Configurable per-handler limits (see `electron/ipc/rateLimiter.cjs`)
- Default: 100 calls per minute per handler
- Auth handlers: 10 calls per minute (login), 5 per minute (register)

### 6. Input Validation
- Entity names validated against whitelist (`shared.entityTableMap`)
- Column names validated against per-table allowlists (`shared.isValidOrderColumn`)
- Medical scores validated against UNOS/OPTN ranges
- SQL values sanitized via `shared.sanitizeForSQLite`

### 7. Error Handling
- Internal errors are logged to structured log files
- Only generic error messages returned to renderer
- Request IDs for cross-referencing errors

## IPC Channel Registry

| Channel | Auth Required | Rate Limit | Notes |
|---------|:------------:|:----------:|-------|
| `entity:create` | Yes | 50/min | License limit enforced |
| `entity:get` | Yes | 200/min | Org-scoped |
| `entity:update` | Yes | 50/min | Audit logged |
| `entity:delete` | Yes | 20/min | Audit logged |
| `entity:list` | Yes | 100/min | Org-scoped |
| `entity:filter` | Yes | 100/min | Org-scoped |
| `auth:login` | No | 10/min | Lockout after 5 failures |
| `auth:register` | Yes (admin) | 5/min | — |
| `file:backupDatabase` | Yes (admin) | 3/min | Integrity verified |
| `backup:create-and-verify` | Yes (admin) | 3/min | Creates + verifies |

---

*Last updated: 2026-03-21*
