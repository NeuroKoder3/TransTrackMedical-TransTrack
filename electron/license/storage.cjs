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
 * expired, the trial cannot be reset by deleting the trial file or by
 * rolling the system clock back — a companion high-water clock file
 * retains the earliest trial start and the latest observed wall time
 * (M-21).
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

function _clockPath() {
  return path.join(_userDataDir(), '.transtrack-clock');
}

function _readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      /* corrupt; treat as missing */
    }
    return null;
  }
}

function _writeJson(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj), { mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch { /* windows */ }
}

/**
 * Monotonic wall-clock observation used for trial expiry and license
 * soft-expiry. Returns max(nowMs, previouslyObserved) so a clock
 * rollback cannot extend entitlement (M-21).
 */
function observeMonotonicNow(nowMs = Date.now()) {
  const clock = _readJson(_clockPath()) || {};
  const prior = Number(clock.lastSeenAtMs);
  const effective = Number.isFinite(prior) ? Math.max(nowMs, prior) : nowMs;
  const next = {
    ...clock,
    lastSeenAtMs: effective,
  };
  _writeJson(_clockPath(), next);
  return effective;
}

function getMonotonicNow(nowMs = Date.now()) {
  const clock = _readJson(_clockPath()) || {};
  const prior = Number(clock.lastSeenAtMs);
  if (Number.isFinite(prior) && prior > nowMs) return prior;
  return nowMs;
}

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
 * Trial state — { startedAt, expiresAt, daysRemaining, expired, durationDays }
 * Always returns an object; creates the trial file on first call so subsequent
 * calls give a deterministic answer. Deleting the trial file does not reset
 * the window when the high-water clock still records trialStartedAt (M-21).
 */
function getTrialState(nowMs = Date.now()) {
  const dir = _userDataDir();
  fs.mkdirSync(dir, { recursive: true });

  const clock = _readJson(_clockPath()) || {};
  const effectiveNow = observeMonotonicNow(nowMs);

  let startedAt = null;
  const trialObj = _readJson(_trialPath());
  if (trialObj && typeof trialObj.startedAt === 'string' && !isNaN(Date.parse(trialObj.startedAt))) {
    startedAt = trialObj.startedAt;
  }

  // Anti-reset: if the trial file was deleted, restore from the clock file.
  if (!startedAt && typeof clock.trialStartedAt === 'string' && !isNaN(Date.parse(clock.trialStartedAt))) {
    startedAt = clock.trialStartedAt;
    _writeJson(_trialPath(), { startedAt });
  }

  // Prefer the earliest known start (never let a rewritten trial file move
  // the start forward).
  if (
    startedAt &&
    typeof clock.trialStartedAt === 'string' &&
    !isNaN(Date.parse(clock.trialStartedAt)) &&
    Date.parse(clock.trialStartedAt) < Date.parse(startedAt)
  ) {
    startedAt = clock.trialStartedAt;
    _writeJson(_trialPath(), { startedAt });
  }

  if (!startedAt) {
    startedAt = new Date(effectiveNow).toISOString();
    _writeJson(_trialPath(), { startedAt });
  }

  _writeJson(_clockPath(), {
    lastSeenAtMs: effectiveNow,
    trialStartedAt: startedAt,
  });

  const startMs = Date.parse(startedAt);
  const expiresMs = startMs + TRIAL_DURATION_DAYS * DAY_MS;
  const daysRemaining = Math.ceil((expiresMs - effectiveNow) / DAY_MS);
  return {
    startedAt,
    expiresAt: new Date(expiresMs).toISOString(),
    daysRemaining: Math.max(0, daysRemaining),
    expired: effectiveNow > expiresMs,
    durationDays: TRIAL_DURATION_DAYS,
  };
}

module.exports = {
  loadLicense,
  storeLicense,
  deleteLicense,
  getTrialState,
  observeMonotonicNow,
  getMonotonicNow,
  TRIAL_DURATION_DAYS,
};
