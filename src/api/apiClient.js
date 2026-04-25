/**
 * TransTrack - API Client
 *
 * Provides a unified API interface with environment detection and
 * centralized error handling. In Electron, delegates to the IPC-based
 * localClient. In browser dev mode, uses a mock client.
 */

import { localClient } from './localClient';
import { isRemoteEnabled, createRemoteClient } from './remoteClient';

/**
 * Active API binding.
 *
 * When a remote API base URL is configured (via VITE_TRANSTRACK_API_URL at
 * build time, or window.transtrackConfig.apiBaseUrl at runtime), the renderer
 * speaks to the TransTrack server over HTTPS and the local SQLite + IPC
 * surface is bypassed. In all other cases the local Electron IPC client is
 * used so existing single-machine deployments continue to work unchanged.
 */
export const api = isRemoteEnabled() ? createRemoteClient() : localClient;
export const apiMode = isRemoteEnabled() ? 'remote' : 'local';

/**
 * Wrap an API call with standardized error handling.
 * Catches IPC / network errors and returns a consistent shape.
 *
 * @param {Function} fn - Async function returning a result
 * @returns {Promise<{ data: any, error: null } | { data: null, error: string }>}
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
