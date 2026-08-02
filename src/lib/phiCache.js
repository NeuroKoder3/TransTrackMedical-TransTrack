import { queryClientInstance } from '@/lib/query-client';

/**
 * Client-side PHI cache lifecycle.
 *
 * Finding H-13: logout cleared the auth state but never purged the TanStack
 * Query cache, so cached patient lists, laboratory results and detail records
 * stayed resident in renderer memory until the process restarted. On a shared
 * clinical workstation — the product's primary deployment model — the next
 * user's session began holding the previous user's PHI.
 *
 * Everything that can hold PHI or session-scoped operational metadata on the
 * client is torn down here, in one place, so a new cache cannot be added
 * without a corresponding entry.
 */

/** sessionStorage keys the renderer is permitted to write, all session-scoped. */
export const SESSION_STORAGE_KEYS = ['navHistory'];

/**
 * Purge every client-side store that can outlive a session.
 *
 * Never throws: this runs on the logout path, including the involuntary paths
 * (idle timeout, OS screen lock), where a failure must not prevent the session
 * from ending.
 */
export function purgeClientPhiCaches() {
  try {
    // cancelQueries first so an in-flight fetch cannot repopulate the cache
    // after it has been emptied.
    queryClientInstance.cancelQueries();
    queryClientInstance.removeQueries();
    queryClientInstance.getQueryCache().clear();
    queryClientInstance.getMutationCache().clear();
    queryClientInstance.clear();
  } catch {
    // Best effort — the session ends regardless.
  }

  try {
    for (const key of SESSION_STORAGE_KEYS) {
      window.sessionStorage?.removeItem(key);
    }
  } catch {
    // sessionStorage can be unavailable (privacy mode, non-browser test env).
  }
}
