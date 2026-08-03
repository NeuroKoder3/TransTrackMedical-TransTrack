/**
 * Bulk PHI access broker.
 *
 * Finding H-1: the break-glass justification gate applied to a single-patient
 * read but not to bulk list/filter, so any role holding patient:view could
 * extract the whole patient population without justifying it. The main process
 * now requires a list-scope grant before returning bulk patient rows.
 *
 * The renderer counterpart lives here rather than in each of the seven pages
 * that perform bulk reads. The API client detects the main process's refusal,
 * asks the broker for a grant, and retries once. A single app-level gate
 * component services the request by collecting a justification.
 *
 * Putting the gate at the API boundary means a page added later is covered
 * automatically, and there is exactly one place where a bulk PHI read can be
 * released.
 */

/** Recognises the main process's bulk-grant refusal without matching other errors. */
export function isBulkPhiJustificationError(error) {
  return /PHI access justification required before bulk/i.test(String(error?.message || ''));
}

export const BULK_PHI_PERMISSION = 'patient:view_phi';
export const BULK_PHI_SCOPE_ID = '*';

let listener = null;
/**
 * Concurrent bulk reads (the dashboard issues several at once) must raise one
 * prompt, not one per query, so an in-flight request is shared.
 */
let inFlight = null;

/** Registered by the app-level gate component. */
export function setBulkPhiGrantHandler(handler) {
  listener = handler;
  return () => {
    if (listener === handler) listener = null;
  };
}

/**
 * Ask the user to justify a bulk PHI read.
 * Resolves true when the main process issued a grant, false otherwise.
 */
export function requestBulkPhiGrant(entityType = 'Patient') {
  if (inFlight) return inFlight;
  if (!listener) return Promise.resolve(false);

  inFlight = Promise.resolve()
    .then(() => listener(entityType))
    .then((granted) => !!granted)
    .catch(() => false)
    .finally(() => { inFlight = null; });

  return inFlight;
}

/**
 * Run a bulk PHI read, obtaining a justification grant and retrying once if the
 * main process refuses for want of one. Any other error propagates unchanged.
 */
export async function withBulkPhiGrant(entityType, run) {
  try {
    return await run();
  } catch (err) {
    if (!isBulkPhiJustificationError(err)) throw err;
    const granted = await requestBulkPhiGrant(entityType);
    if (!granted) throw err;
    return run();
  }
}

/** Test seam. */
export function _resetBulkPhiBroker() {
  listener = null;
  inFlight = null;
}
