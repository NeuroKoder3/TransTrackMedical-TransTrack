/**
 * TransTrack - API Client
 *
 * Resolves the active binding LAZILY at call time (not at module load).
 * That matters in Electron: preload sets window.transtrackConfig.apiBaseUrl
 * before renderer JS runs, but a static `const api = ...` evaluated too early
 * (or against a stale Vite env) can lock the app into local IPC mode and
 * make remote Epic/API login look "broken".
 */

import { localClient } from './localClient';
import { isRemoteEnabled, createRemoteClient, resolveBaseUrl } from './remoteClient';

let _cached = null;
let _cachedMode = null;

function resolveClient() {
  const mode = isRemoteEnabled() ? 'remote' : 'local';
  if (_cached && _cachedMode === mode) return _cached;
  _cachedMode = mode;
  _cached = mode === 'remote' ? createRemoteClient() : localClient;
  return _cached;
}

/** Force re-resolve (e.g. after runtime config changes). */
export function resetApiClient() {
  _cached = null;
  _cachedMode = null;
}

export function getApiMode() {
  return isRemoteEnabled() ? 'remote' : 'local';
}

export function getApiBaseUrl() {
  return resolveBaseUrl();
}

/**
 * Lazy proxy — every property access hits the currently resolved client.
 */
export const api = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'then') return undefined; // not a Promise
      const client = resolveClient();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);

/** @deprecated Prefer getApiMode() — kept as a function-compatible alias. */
export const apiMode = {
  toString: () => getApiMode(),
  valueOf: () => getApiMode(),
  [Symbol.toPrimitive]: () => getApiMode(),
  get current() { return getApiMode(); },
};

/**
 * Wrap an API call with standardized error handling.
 */
export async function safeApiCall(fn) {
  try {
    const data = await fn();
    return { data, error: null };
  } catch (err) {
    const message =
      err?.message || 'An unexpected error occurred. Please try again.';

    if (message.includes('Session expired')) {
      api.auth.redirectToLogin?.();
    }

    return { data: null, error: message };
  }
}

export default api;
