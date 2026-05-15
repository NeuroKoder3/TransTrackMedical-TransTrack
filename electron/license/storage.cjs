/**
 * TransTrack — License file storage.
 *
 * Reads / writes the active license to a file in userData. The wire
 * format is already signed and tamper-evident, so we don't need
 * additional integrity protection on the file itself — we just store
 * the LIC1.* string. We restrict file permissions to 0o600 to keep
 * casual readers out.
 *
 * Trial mode: when there is no license file, we transparently fall back
 * to a "trial" state that lasts TRIAL_DURATION_DAYS from the recorded
 * trial_started_at timestamp (which is created on first call). Once
 * expired, the trial cannot be reset by re-running the app (the file is
 * append-only-ish; we never erase the trial timestamp).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TRIAL_DURATION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function _userDataDir() {
  if (process.env.TRANSTRACK_USERDATA_DIR) return process.env.TRANSTRACK_USERDATA_DIR;
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    return path.join(process.cwd(), '.transtrack-test-userdata');
  }
}

function _licensePath() {
  return path.join(_userDataDir(), 'license.dat');
}

function _trialPath() {
  return path.join(_userDataDir(), '.transtrack-trial');
}

// All filesystem helpers below avoid the existsSync()-then-act pattern that
// CodeQL flags as `js/file-system-race`. We attempt the operation directly
// and treat ENOENT as the negative result. This eliminates the TOCTOU window
// and is what Node's own docs recommend.

function loadLicense() {
  const p = _licensePath();
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw || null;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return null;
  }
}

function storeLicense(wireLicense) {
  if (typeof wireLicense !== 'string' || !wireLicense.startsWith('LIC1.')) {
    throw new Error('storeLicense expects a LIC1.* wire-format string');
  }
  const dir = _userDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(_licensePath(), wireLicense, { mode: 0o600 });
  try { fs.chmodSync(_licensePath(), 0o600); } catch { /* windows */ }
}

function deleteLicense() {
  try {
    fs.unlinkSync(_licensePath());
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      // Re-suppress: deletion errors must never bubble up out of this path.
    }
  }
}

/**
 * Trial state — { startedAt: ISO, expiresAt: ISO, daysRemaining: number, expired: boolean }
 * Always returns an object; creates the trial file on first call so subsequent
 * calls give a deterministic answer.
 */
function getTrialState(nowMs = Date.now()) {
  const p = _trialPath();
  const dir = _userDataDir();
  fs.mkdirSync(dir, { recursive: true });

  let startedAt;
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (obj && typeof obj.startedAt === 'string' && !isNaN(Date.parse(obj.startedAt))) {
      startedAt = obj.startedAt;
    }
  } catch (err) {
    // ENOENT (no trial yet) and parse errors both fall through to "create new"
    if (err && err.code !== 'ENOENT') {
      /* file corrupt; rewrite */
    }
  }

  if (!startedAt) {
    startedAt = new Date(nowMs).toISOString();
    fs.writeFileSync(p, JSON.stringify({ startedAt }), { mode: 0o600 });
    try { fs.chmodSync(p, 0o600); } catch { /* windows */ }
  }

  const startMs = Date.parse(startedAt);
  const expiresMs = startMs + TRIAL_DURATION_DAYS * DAY_MS;
  const daysRemaining = Math.ceil((expiresMs - nowMs) / DAY_MS);
  return {
    startedAt,
    expiresAt: new Date(expiresMs).toISOString(),
    daysRemaining: Math.max(0, daysRemaining),
    expired: nowMs > expiresMs,
    durationDays: TRIAL_DURATION_DAYS,
  };
}

module.exports = {
  loadLicense,
  storeLicense,
  deleteLicense,
  getTrialState,
  TRIAL_DURATION_DAYS,
};
