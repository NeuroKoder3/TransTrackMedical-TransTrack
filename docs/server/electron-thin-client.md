# Running the Electron client against the API server

The renderer code now selects between two API bindings at runtime:

- `localClient`  — talks to the local SQLite DB via Electron IPC. This is
  the original single-machine mode.
- `remoteClient` — talks to a TransTrack API server over HTTPS.

The selection is automatic and based on whether a remote API URL is
configured. The relevant code is in `src/api/apiClient.js`:

```js
import { localClient } from './localClient';
import { isRemoteEnabled, createRemoteClient } from './remoteClient';

export const api = isRemoteEnabled() ? createRemoteClient() : localClient;
```

## Configuring the remote URL

### Option A — Vite build-time

Set the environment variable when building the renderer:

```bash
VITE_TRANSTRACK_API_URL=https://api.transtrack.hospital.example npm run build
```

This bakes the URL into the bundle.

### Option B — Runtime, via window.transtrackConfig

For a single packaged Electron build that can talk to multiple servers,
the main process can inject a config object before the preload script
finishes. Add to `electron/main.cjs`:

```js
mainWindow.webContents.on('did-finish-load', () => {
  const apiBaseUrl = readUserPreference('apiBaseUrl');
  if (apiBaseUrl) {
    mainWindow.webContents.executeJavaScript(
      `window.transtrackConfig = { apiBaseUrl: ${JSON.stringify(apiBaseUrl)} };`
    );
  }
});
```

Once the renderer reloads, `apiClient.js` will pick the remote client.

## What's currently routed remotely

The remote client implements the highest-volume surfaces directly:

- `auth.login` / `loginMfa` / `logout` / `me` / `changePassword`
- `mfa.beginEnrollment` / `confirmEnrollment`
- `patients.list/get/create/update`
- `organOffers.list/create/transition`
- `labs.listForPatient/create`
- `hl7.list/get/ingest`
- `audit.list/verifyChain`
- `calculators.*` (server-side authoritative calculators)

Other namespaces (`postTx`, `livingDonor`, `srtr`, `tasks`, etc.) still
route through Electron IPC for now and will be moved as the API surface
expands. Pages that only use the routed APIs work unchanged in remote
mode. Pages that touch unrouted APIs need the local store, which is
acceptable during the migration.

## Web build

When `VITE_TRANSTRACK_API_URL` is set at build time, the renderer can
also be served as a pure web app (no Electron). The remote client uses
`localStorage` for tokens, which is fine for short-lived JWTs but should
be replaced with HTTP-only cookies before any production hospital
deployment.
