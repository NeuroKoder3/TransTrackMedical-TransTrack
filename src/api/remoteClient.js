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

function tokenStore() {
  return {
    getAccess: () => memoryAccessToken,
    setAccess: (access) => {
      memoryAccessToken = access || null;
    },
    clear: () => {
      memoryAccessToken = null;
    },
  };
}

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
    loginMfa: async ({ challengeId, code }) => {
      const r = await this._fetch('/auth/mfa/verify', { method: 'POST', body: { challengeId, code } });
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
    changePassword: async ({ current, next }) =>
      this._fetch('/auth/password/change', { method: 'POST', body: { current, next } }),
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
}

function validateBaseUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return raw;
    if (url.protocol !== 'https:') return null;
    return raw;
  } catch {
    return null;
  }
}

function resolveBaseUrl() {
  if (typeof window !== 'undefined' && window.transtrackConfig?.apiBaseUrl) {
    return validateBaseUrl(window.transtrackConfig.apiBaseUrl);
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TRANSTRACK_API_URL) {
    return validateBaseUrl(import.meta.env.VITE_TRANSTRACK_API_URL);
  }
  return null;
}

export function isRemoteEnabled() {
  return !!resolveBaseUrl();
}

export function createRemoteClient() {
  const base = resolveBaseUrl();
  if (!base) throw new Error('No TRANSTRACK_API_URL configured');
  return new RemoteClient(base);
}

export default { createRemoteClient, isRemoteEnabled };
