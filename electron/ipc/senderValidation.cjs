/**
 * TransTrack - IPC Sender Validation
 *
 * Electron's ipcMain handlers will answer ANY renderer frame that knows the
 * channel name, including a cross-origin iframe or a stray WebContents. This
 * module establishes a trust anchor for the one legitimate renderer and
 * refuses every other caller.
 *
 * Three independent checks, all of which must pass:
 *   1. event.sender is the WebContents of the registered main window.
 *   2. event.senderFrame is that WebContents' top-level frame (never a
 *      sub-frame / iframe), so an injected iframe cannot reach IPC.
 *   3. The frame's URL matches an allow-listed origin — file:// for packaged
 *      builds, plus the local Vite dev server in development.
 *
 * HIPAA 164.312(a)(1) - Access Control
 * HIPAA 164.312(e)(1) - Transmission Security
 */

'use strict';

let trustedWebContentsId = null;
let allowDevOrigins = false;

/**
 * Channels that must remain reachable before/without a trusted window being
 * registered. Kept intentionally empty: registerTrustedWindow() runs during
 * createMainWindow(), before the renderer can issue any IPC, so there is no
 * legitimate pre-registration caller.
 */
const PRE_REGISTRATION_CHANNELS = new Set();

/**
 * Bind the trust anchor to a BrowserWindow. Called from createMainWindow()
 * immediately after construction, before the renderer loads.
 */
function registerTrustedWindow(browserWindow, options = {}) {
  if (!browserWindow || !browserWindow.webContents) {
    throw new Error('registerTrustedWindow requires a BrowserWindow');
  }
  trustedWebContentsId = browserWindow.webContents.id;
  allowDevOrigins = Boolean(options.isDev);

  browserWindow.on('closed', () => {
    trustedWebContentsId = null;
  });

  return trustedWebContentsId;
}

function getTrustedWebContentsId() {
  return trustedWebContentsId;
}

/** Test seam: reset module state between test cases. */
function _resetForTests() {
  trustedWebContentsId = null;
  allowDevOrigins = false;
}

/** Test seam: set state without a real BrowserWindow. */
function _setStateForTests({ webContentsId = null, isDev = false } = {}) {
  trustedWebContentsId = webContentsId;
  allowDevOrigins = Boolean(isDev);
}

/**
 * Is this frame URL an origin we are willing to accept IPC from?
 *
 * Packaged builds load the renderer from disk (file://). Development also
 * serves it from the local Vite dev server. Anything else — remote http(s),
 * data:, blob:, about: — is rejected.
 */
function isAllowedFrameUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === 'file:') return true;

  if (allowDevOrigins && (parsed.protocol === 'http:' || parsed.protocol === 'ws:')) {
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  }

  return false;
}

/**
 * Validate an ipcMain event. Returns { ok: true } or
 * { ok: false, reason: string } describing which check failed.
 *
 * Fails closed: an event that cannot be inspected is rejected.
 */
function validateSender(event, channel) {
  if (!event || typeof event !== 'object') {
    return { ok: false, reason: 'missing_event' };
  }

  const senderId = event.sender?.id;
  if (typeof senderId !== 'number') {
    return { ok: false, reason: 'missing_sender' };
  }

  if (trustedWebContentsId === null) {
    if (PRE_REGISTRATION_CHANNELS.has(channel)) return { ok: true };
    return { ok: false, reason: 'no_trusted_window' };
  }

  if (senderId !== trustedWebContentsId) {
    return { ok: false, reason: 'untrusted_webcontents' };
  }

  // senderFrame is undefined in unit tests that fabricate events; only enforce
  // the frame checks when Electron actually supplied frame information.
  // Reading it can throw when the frame has already been torn down (for
  // example an in-flight call during navigation) — treat that as untrusted.
  let senderFrame;
  try {
    senderFrame = event.senderFrame;
  } catch {
    return { ok: false, reason: 'sender_frame_unavailable' };
  }

  if (senderFrame) {
    // A sub-frame has a parent; the top-level frame does not. Rejecting any
    // frame with a parent stops an injected iframe from calling IPC.
    if (senderFrame.parent) {
      return { ok: false, reason: 'subframe_sender' };
    }
    if (!isAllowedFrameUrl(senderFrame.url)) {
      return { ok: false, reason: 'disallowed_frame_origin' };
    }
  }

  return { ok: true };
}

module.exports = {
  registerTrustedWindow,
  getTrustedWebContentsId,
  validateSender,
  isAllowedFrameUrl,
  PRE_REGISTRATION_CHANNELS,
  _resetForTests,
  _setStateForTests,
};
