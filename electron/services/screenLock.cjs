/**
 * TransTrack - OS Screen Lock / Suspend Session Locking
 *
 * The idle timeout in the renderer (IdleTimeoutManager) and the matching
 * main-process check in ipc/shared.cjs both key off *inactivity*. Neither fires
 * when a clinician locks the workstation deliberately (Win+L), when the lid
 * closes, or when the machine suspends — the session simply stays open until the
 * idle window elapses, which can be many minutes of a live authenticated
 * session sitting behind a lock screen and, worse, PHI still rendered on screen
 * the instant the workstation is unlocked by anyone.
 *
 * This module closes that window by treating an OS lock or suspend as an
 * immediate end of session:
 *
 *   1. the server-side session row is deleted, so it cannot be resumed;
 *   2. in-memory session state is cleared, so every subsequent IPC call fails
 *      closed through the existing validateSession() path;
 *   3. the event is written to the audit trail (no PHI);
 *   4. the renderer is told, so PHI is cleared from the screen rather than
 *      remaining visible behind the lock screen and after unlock.
 *
 * Main-process-authoritative by design: step 2 is what actually enforces the
 * lock. Step 4 is presentation, and the control still holds if the renderer
 * ignores it.
 *
 * Failure behaviour is deliberately quiet — a locked workstation must never
 * crash the app or block the OS transition, so every step is best-effort and
 * the module never throws into Electron's event emitter.
 *
 * HIPAA 164.312(a)(2)(iii) - Automatic Logoff
 * HIPAA 164.310(b)/(c)     - Workstation Use / Workstation Security
 */

'use strict';

let powerMonitor;
try { ({ powerMonitor } = require('electron')); } catch { /* plain Node / CI */ }

const { logger } = require('./logger.cjs');

/**
 * OS transitions that must end the session.
 *
 * 'lock-screen'  — the user locked the workstation (all platforms that report it)
 * 'suspend'      — sleep/hibernate; on many Windows and Linux configurations
 *                  this arrives without a preceding 'lock-screen'
 *
 * 'resume' and 'unlock-screen' are intentionally NOT handled: the session is
 * already gone by then, and re-authentication is the required behaviour.
 */
const LOCK_EVENTS = ['lock-screen', 'suspend'];

let initialized = false;
let getMainWindowRef = null;
const registered = [];

/**
 * End the current session because of an OS-level lock/suspend.
 *
 * Safe to call when nobody is logged in (returns { locked: false }).
 *
 * @param {string} reason  the originating OS event, recorded in the audit trail
 * @returns {{locked: boolean, reason: string, notified?: boolean, error?: string}}
 */
function lockSession(reason) {
  let shared;
  try {
    shared = require('../ipc/shared.cjs');
  } catch (err) {
    return { locked: false, reason, error: `shared_unavailable:${err.message}` };
  }

  let sessionId = null;
  let userEmail = null;
  let userRole = null;
  let userId = null;

  try {
    const state = shared.getSessionState();
    sessionId = state.currentSession;
    userId = state.currentUser?.id || null;
    userEmail = state.currentUser?.email || null;
    userRole = state.currentUser?.role || null;
  } catch { /* treat an unreadable session as no session */ }

  if (!sessionId) {
    // Nothing to lock. Still notify so a renderer sitting on a stale view
    // (for example after the session expired server-side) returns to login.
    const notified = notifyRenderer(reason, false);
    return { locked: false, reason, notified };
  }

  // 1. Remove the session row so it cannot be resumed from another window.
  try {
    const { getDatabase } = require('../database/init.cjs');
    getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  } catch (err) {
    // Non-fatal: clearing in-memory state below is what enforces the lock.
    logger.warn('Screen lock: could not delete session row', { error: err.message });
  }

  // 2. Audit BEFORE clearing, so the entry is still attributable to the user.
  try {
    shared.logAudit(
      'session.lock',
      'Session',
      sessionId,
      null,
      `Session ended by OS ${reason}`,
      userEmail,
      userRole
    );
  } catch (err) {
    logger.warn('Screen lock: could not write audit entry', { error: err.message });
  }

  // 3. The actual enforcement — every later IPC call now fails validateSession().
  try {
    shared.clearSession();
  } catch (err) {
    logger.error('Screen lock: failed to clear session state', { error: err.message });
    return { locked: false, reason, error: err.message };
  }

  logger.info('Session locked by OS event', { reason, userId });

  const notified = notifyRenderer(reason, true);
  return { locked: true, reason, notified };
}

/**
 * Tell the renderer to drop back to the login screen.
 * Never throws; a destroyed or missing window is simply not notified.
 */
function notifyRenderer(reason, wasAuthenticated) {
  try {
    const win = typeof getMainWindowRef === 'function' ? getMainWindowRef() : null;
    if (!win || win.isDestroyed?.()) return false;

    const contents = win.webContents;
    if (!contents || contents.isDestroyed?.()) return false;

    contents.send('session:locked', { reason, wasAuthenticated });
    return true;
  } catch {
    return false;
  }
}

/**
 * Register the OS listeners. Idempotent.
 *
 * @param {{getMainWindow: () => (Electron.BrowserWindow|null)}} options
 * @returns {{enabled: boolean, events: string[], reason?: string}}
 */
function initializeScreenLock(options = {}) {
  if (initialized) {
    return { enabled: true, events: [...registered], reason: 'already_initialized' };
  }

  getMainWindowRef = typeof options.getMainWindow === 'function' ? options.getMainWindow : null;

  if (!powerMonitor || typeof powerMonitor.on !== 'function') {
    logger.warn('Screen lock integration unavailable: powerMonitor not present');
    return { enabled: false, events: [], reason: 'power_monitor_unavailable' };
  }

  for (const event of LOCK_EVENTS) {
    try {
      powerMonitor.on(event, () => {
        try {
          lockSession(event);
        } catch (err) {
          // Must never propagate into Electron's emitter during an OS transition.
          logger.error('Screen lock handler failed', { event, error: err.message });
        }
      });
      registered.push(event);
    } catch (err) {
      // Not every platform/session bus reports every event (notably
      // 'lock-screen' on some Linux desktops); a missing one is not an error.
      logger.warn('Screen lock: could not subscribe to OS event', { event, error: err.message });
    }
  }

  initialized = registered.length > 0;
  logger.info('Screen lock integration registered', { events: registered });

  return { enabled: initialized, events: [...registered] };
}

function getStatus() {
  return {
    enabled: initialized,
    events: [...registered],
    powerMonitorAvailable: Boolean(powerMonitor && typeof powerMonitor.on === 'function'),
  };
}

/** Test seam. */
function _resetForTests() {
  initialized = false;
  getMainWindowRef = null;
  registered.length = 0;
}

module.exports = {
  initializeScreenLock,
  lockSession,
  getStatus,
  LOCK_EVENTS,
  _resetForTests,
};
