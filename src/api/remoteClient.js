/**
 * Remote API client.
 *
 * Used when the Electron renderer (or a pure web build) is configured to
 * speak to a TransTrack API server instead of the local SQLite + IPC bridge.
 *
 * Session tokens:
 *   - Access token: held in memory only (never localStorage).
 *   - Refresh token: httpOnly cookie set by the server (credentials: include).
 *
 * Activation:
 *   - In Electron, set TRANSTRACK_API_URL via the user's preferences or
 *     pass it through `window.transtrackConfig.apiBaseUrl`.
 *   - In a web build, define VITE_TRANSTRACK_API_URL at build time.
 */

const LEGACY_ACCESS_KEY = 'transtrack:access';
const LEGACY_REFRESH_KEY = 'transtrack:refresh';

/** @type {string | null} */
let memoryAccessToken = null;

function purgeLegacyLocalStorage() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LEGACY_ACCESS_KEY);
  localStorage.removeItem(LEGACY_REFRESH_KEY);
}

purgeLegacyLocalStorage();

function readWindowToken() {
  try {
    return typeof window !== 'undefined' ? (window.__transtrackAccess || null) : null;
  } catch {
    return null;
  }
}

function writeWindowToken(access) {
  try {
    if (typeof window !== 'undefined') {
      window.__transtrackAccess = access || null;
    }
  } catch { /* ignore */ }
}

function tokenStore() {
  return {
    getAccess: () => memoryAccessToken || readWindowToken(),
    setAccess: (access) => {
      memoryAccessToken = access || null;
      writeWindowToken(memoryAccessToken);
    },
    clear: () => {
      memoryAccessToken = null;
      writeWindowToken(null);
    },
  };
}

function browserEntityStore(entityName) {
  const key = `transtrack:remote-entity:${entityName}`;
  const read = () => {
    try {
      if (typeof sessionStorage === 'undefined') return [];
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const write = (rows) => {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(key, JSON.stringify(rows));
  };
  const newId = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    list: async () => read(),
    filter: async (filters = {}) =>
      read().filter((row) =>
        Object.entries(filters).every(([k, v]) => {
          if (v === undefined || v === null || v === '') return true;
          return row[k] === v;
        })
      ),
    get: async (id) => read().find((r) => r.id === id) || null,
    create: async (data) => {
      const rows = read();
      const row = {
        id: newId(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...data,
      };
      rows.unshift(row);
      write(rows);
      return row;
    },
    update: async (id, data) => {
      const rows = read();
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`${entityName} not found`);
      rows[i] = { ...rows[i], ...data, updated_at: new Date().toISOString() };
      write(rows);
      return rows[i];
    },
    delete: async (id) => {
      write(read().filter((r) => r.id !== id));
      return { success: true };
    },
  };
}

/** Config entities that live in the desktop UI (not the Postgres API). */
const LOCAL_CONFIG_ENTITIES = new Set([
  'EHRIntegration',
  'EHRImport',
  'EHRSyncLog',
  'EHRValidationRule',
  'PriorityWeights',
  'Notification',
  'NotificationRule',
  'DonorOrgan',
  'Match',
]);

class RemoteClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.tokens = tokenStore();
  }

  async _fetch(path, opts = {}) {
    const url = this.baseUrl + path;
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    const access = this.tokens.getAccess();
    if (access) headers.authorization = `Bearer ${access}`;
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401 && access && opts._retry !== true) {
      const refreshed = await this._refresh();
      if (refreshed) return this._fetch(path, { ...opts, _retry: true });
    }
    if (!r.ok) {
      let payload;
      try { payload = await r.json(); } catch { payload = { error: { message: r.statusText } }; }
      const err = new Error(payload?.error?.message || `HTTP ${r.status}`);
      err.status = r.status;
      err.code = payload?.error?.code;
      err.details = payload?.error?.details;
      throw err;
    }
    if (r.status === 204) return null;
    const contentType = r.headers.get('content-type') || '';
    if (contentType.includes('json')) return r.json();
    return r.text();
  }

  async _refresh() {
    try {
      const r = await fetch(this.baseUrl + '/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!r.ok) { this.tokens.clear(); return false; }
      const body = await r.json();
      this.tokens.setAccess(body.access);
      return true;
    } catch {
      this.tokens.clear();
      return false;
    }
  }

  // --- Auth ---
  auth = {
    login: async ({ email, password }) => {
      const r = await this._fetch('/auth/login', { method: 'POST', body: { email, password } });
      if (r.kind === 'session') this.tokens.setAccess(r.access);
      return r;
    },
    loginMfa: async ({ challengeId, challenge_token, code }) => {
      const id = challengeId || challenge_token;
      const r = await this._fetch('/auth/mfa/verify', { method: 'POST', body: { challengeId: id, code } });
      if (r.kind === 'session') this.tokens.setAccess(r.access);
      return r;
    },
    logout: async () => {
      try { await this._fetch('/auth/logout', { method: 'POST', body: {} }); }
      finally { this.tokens.clear(); }
      return { ok: true };
    },
    me: async () => this._fetch('/auth/me'),
    isAuthenticated: async () => !!this.tokens.getAccess(),
    redirectToLogin: () => { window.location.hash = '#/login'; },
    changePassword: async ({ currentPassword, newPassword, current, next }) =>
      this._fetch('/auth/password/change', {
        method: 'POST',
        body: { current: current || currentPassword, next: next || newPassword },
      }),
  };

  // --- MFA ---
  mfa = {
    beginEnrollment: async () => this._fetch('/auth/mfa/enroll/begin', { method: 'POST', body: {} }),
    confirmEnrollment: async ({ code }) =>
      this._fetch('/auth/mfa/enroll/confirm', { method: 'POST', body: { code } }),
  };

  // --- Patients ---
  patients = {
    list: async (params = {}) => this._fetch('/patients?' + new URLSearchParams(params)),
    get: async (id) => this._fetch(`/patients/${id}`),
    create: async (data) => this._fetch('/patients', { method: 'POST', body: data }),
    update: async (id, fields) => this._fetch(`/patients/${id}`, { method: 'PATCH', body: fields }),
  };

  // --- Organ offers ---
  organOffers = {
    list: async (params = {}) => this._fetch('/organ-offers?' + new URLSearchParams(params)),
    create: async (data) => this._fetch('/organ-offers', { method: 'POST', body: data }),
    transition: async ({ id, action, ...payload }) =>
      this._fetch(`/organ-offers/${id}/${action}`, { method: 'POST', body: payload }),
  };

  // --- Labs ---
  labs = {
    listForPatient: async (patientId, params = {}) =>
      this._fetch(`/patients/${patientId}/labs?` + new URLSearchParams(params)),
    create: async (patientId, data) =>
      this._fetch(`/patients/${patientId}/labs`, { method: 'POST', body: data }),
  };

  // --- HL7 ---
  hl7 = {
    list: async (params = {}) => this._fetch('/hl7/messages?' + new URLSearchParams(params)),
    get: async (id) => this._fetch(`/hl7/messages/${id}`),
    ingest: async ({ message }) => this._fetch('/hl7/ingest', { method: 'POST', body: { message } }),
  };

  // --- Audit ---
  audit = {
    list: async (params = {}) => this._fetch('/audit?' + new URLSearchParams(params)),
    verifyChain: async () => this._fetch('/audit/verify'),
  };

  // --- Integrations (Epic on FHIR, etc.) ---
  integrations = {
    epic: {
      status: async () => this._fetch('/integrations/epic/status'),
      import: async ({ epicPatientId, bundle } = {}) =>
        this._fetch('/integrations/epic/import', {
          method: 'POST',
          body: { epicPatientId, bundle },
        }),
    },
  };

  // --- Calculators (server-side authoritative) ---
  calculators = {
    listFormulas: async () => (await this._fetch('/calculators')).formulas,
    meld:   (input) => this._fetch('/calculators/meld',    { method: 'POST', body: input }),
    meldNa: (input) => this._fetch('/calculators/meld-na', { method: 'POST', body: input }),
    meld3:  (input) => this._fetch('/calculators/meld-3',  { method: 'POST', body: input }),
    peld:   (input) => this._fetch('/calculators/peld',    { method: 'POST', body: input }),
    las:    (input) => this._fetch('/calculators/las',     { method: 'POST', body: input }),
    kdpi:   (input) => this._fetch('/calculators/kdpi',    { method: 'POST', body: input }),
    epts:   (input) => this._fetch('/calculators/epts',    { method: 'POST', body: input }),
  };

  /**
   * Entity facade matching localClient / Electron IPC shape.
   * - Patient: HTTP API (shared waitlist with Epic import)
   * - Everything else that exists on window.electronAPI.entities: local SQLite
   *   via IPC (EHRIntegration profiles, validation rules, etc.)
   */
  entities = new Proxy(
    {},
    {
      get: (_target, entityName) => {
        if (typeof entityName === 'symbol') return undefined;
        const self = this;

        if (entityName === 'Patient') {
          return {
            list: async (_orderBy, limit = 50) => {
              const rows = await self._fetch(
                '/patients?' + new URLSearchParams({ limit: String(limit || 50) })
              );
              return Array.isArray(rows) ? rows : [];
            },
            get: async (id) => self._fetch(`/patients/${id}`),
            create: async (data) =>
              self._fetch('/patients', { method: 'POST', body: data }),
            update: async (id, data) =>
              self._fetch(`/patients/${id}`, { method: 'PATCH', body: data }),
            filter: async (filters = {}, _orderBy, limit = 50) => {
              const params = { limit: String(limit || 50) };
              if (filters.waitlist_status) params.status = filters.waitlist_status;
              if (filters.organ_needed) params.organ = filters.organ_needed;
              if (filters.search) params.search = filters.search;
              let rows = await self._fetch('/patients?' + new URLSearchParams(params));
              rows = Array.isArray(rows) ? rows : [];
              const skip = new Set(['waitlist_status', 'organ_needed', 'search']);
              return rows.filter((row) =>
                Object.entries(filters).every(([k, v]) => {
                  if (skip.has(k) || v === undefined || v === null || v === '') return true;
                  return row[k] === v;
                })
              );
            },
            delete: async () => {
              throw new Error('Patient delete is not available via the remote API');
            },
          };
        }

        if (entityName === 'AuditLog') {
          return {
            list: async (_orderBy, limit = 50) => {
              const rows = await self._fetch(
                '/audit?' + new URLSearchParams({ limit: String(limit || 50) })
              );
              return Array.isArray(rows) ? rows : (rows?.items || []);
            },
            filter: async (filters = {}, _orderBy, limit = 50) => {
              const params = { limit: String(limit || 50) };
              if (filters.entity_id) params.entityId = filters.entity_id;
              const rows = await self._fetch('/audit?' + new URLSearchParams(params));
              return Array.isArray(rows) ? rows : (rows?.items || []);
            },
            create: async () => ({}),
            get: async () => null,
            update: async () => ({}),
            delete: async () => ({}),
          };
        }

        // EHRIntegration / rules / etc. are desktop config — not on the HTTP API.
        // In production, clinical config must not reside in browser sessionStorage.
        if (LOCAL_CONFIG_ENTITIES.has(entityName)) {
          if (typeof import.meta !== 'undefined' && import.meta.env?.PROD) {
            const msg = 'Remote storage of clinical config is disabled in production';
            return {
              list: async () => { throw new Error(msg); },
              filter: async () => { throw new Error(msg); },
              get: async () => { throw new Error(msg); },
              create: async () => { throw new Error(msg); },
              update: async () => { throw new Error(msg); },
              delete: async () => { throw new Error(msg); },
            };
          }
          return browserEntityStore(entityName);
        }

        return {
          list: async () => [],
          filter: async () => [],
          get: async () => null,
          create: async () => {
            throw new Error(
              `${entityName} is not available in remote API mode. ` +
              'For live Epic import use the "Epic on FHIR" tab.'
            );
          },
          update: async () => {
            throw new Error(`${entityName} is not available in remote API mode.`);
          },
          delete: async () => {
            throw new Error(`${entityName} is not available in remote API mode.`);
          },
        };
      },
    }
  );

  functions = {
    invoke: async (functionName, params) => {
      // Local-only IPC functions (priority recalc, etc.) are not on the HTTP API yet.
      console.warn(`[remoteClient] functions.invoke(${functionName}) not implemented remotely`, params);
      return { data: null };
    },
  };
}

function validateBaseUrl(raw) {
  if (!raw) return null;
  // Strip UTF-8 BOM / whitespace — PowerShell Set-Content -Encoding utf8
  // often prefixes .env files with U+FEFF, which breaks `new URL(...)`.
  const cleaned = String(raw).replace(/^\uFEFF/, '').trim();
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return cleaned;
    if (url.protocol !== 'https:') return null;
    return cleaned;
  } catch {
    return null;
  }
}

/**
 * Desktop-only IPC surface. When the renderer is in remote API mode inside
 * Electron, pages like Prevention Queue / Disaster Recovery still talk to
 * local SQLite via preload. Component tests mock window.electronAPI the
 * same way.
 */
function createElectronPassthrough(namespace) {
  return new Proxy(
    {},
    {
      get(_target, method) {
        if (typeof method === 'symbol') return undefined;
        return async (...args) => {
          const ns = typeof window !== 'undefined' ? window.electronAPI?.[namespace] : null;
          const fn = ns?.[method];
          if (typeof fn !== 'function') {
            throw new Error(
              `${namespace}.${method} requires the TransTrack desktop runtime (Electron IPC).`
            );
          }
          return fn(...args);
        };
      },
    }
  );
}

function resolveBaseUrl() {
  // Remote mode is OPT-IN only. Never infer it from import.meta.env.DEV —
  // Vitest sets DEV=true and would otherwise force every component test
  // onto the HTTP client (breaking electronAPI mocks).
  if (typeof window !== 'undefined' && window.transtrackConfig?.apiBaseUrl) {
    const fromPreload = validateBaseUrl(window.transtrackConfig.apiBaseUrl);
    if (fromPreload) return fromPreload;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TRANSTRACK_API_URL) {
    const raw = String(import.meta.env.VITE_TRANSTRACK_API_URL).replace(/^\uFEFF/, '').trim();
    // Old proxy URL — rewrite to the real API so login keeps working if Vite
    // proxy is unavailable mid-session.
    if (raw.includes('/__api')) {
      return validateBaseUrl('http://127.0.0.1:8080');
    }
    const fromEnv = validateBaseUrl(raw);
    if (fromEnv) return fromEnv;
  }
  return null;
}

export function isRemoteEnabled() {
  return !!resolveBaseUrl();
}

export function createRemoteClient() {
  const base = resolveBaseUrl();
  if (!base) throw new Error('No TRANSTRACK_API_URL configured');
  const client = new RemoteClient(base);
  // Hybrid desktop + API: keep local IPC for operational desktop pages.
  client.actionQueue = createElectronPassthrough('actionQueue');
  client.recovery = createElectronPassthrough('recovery');
  client.risk = createElectronPassthrough('risk');
  client.outcomes = createElectronPassthrough('outcomes');
  client.compliance = createElectronPassthrough('compliance');
  client.predictions = createElectronPassthrough('predictions');
  client.tasks = createElectronPassthrough('tasks');
  client.srtr = createElectronPassthrough('srtr');
  client.sso = createElectronPassthrough('sso');
  return client;
}

export { resolveBaseUrl };

export default { createRemoteClient, isRemoteEnabled, resolveBaseUrl };
