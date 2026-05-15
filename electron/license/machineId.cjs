/**
 * TransTrack — Machine fingerprint for license binding.
 *
 * Produces a stable 32-byte hex identifier for the install. This is NOT
 * a strong hardware lock — a determined adversary can defeat it — but
 * it raises the friction enough that casual key-sharing fails.
 *
 * Inputs blended together via SHA-256:
 *   - OS platform + arch
 *   - hostname (lowercased)
 *   - a randomly-generated install UUID persisted under userData
 *     (rotates if the user blows away userData, which is acceptable
 *     because that requires a re-activation anyway)
 *   - MAC addresses of all non-internal NICs, sorted (so the order
 *     within the OS table doesn't matter)
 *
 * Anything that would change when the user clones the install to a
 * different physical machine (hostname, NIC MACs) contributes; anything
 * that flaps every boot (process IDs, RAM size, dynamic IPs) does NOT.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let _cachedFingerprint = null;

function _userDataDir() {
  if (process.env.TRANSTRACK_USERDATA_DIR) return process.env.TRANSTRACK_USERDATA_DIR;
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    return path.join(process.cwd(), '.transtrack-test-userdata');
  }
}

function _stableInstallUuid() {
  const dir = _userDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const idPath = path.join(dir, '.transtrack-install-uuid');

  // Read the existing UUID directly rather than check-then-read, to avoid
  // the TOCTOU race CodeQL flags as `js/file-system-race`. ENOENT (no file
  // yet) and any other read error fall through to the regenerate path.
  try {
    const v = fs.readFileSync(idPath, 'utf8').trim();
    if (/^[a-f0-9-]{8,}$/i.test(v)) return v;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      /* file corrupted or unreadable; fall through and overwrite */
    }
  }

  const uuid = crypto.randomUUID();
  fs.writeFileSync(idPath, uuid, { mode: 0o600 });
  try { fs.chmodSync(idPath, 0o600); } catch { /* windows */ }
  return uuid;
}

function _nicMacs() {
  const ifs = os.networkInterfaces();
  const macs = [];
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.internal) continue;
      if (!ni.mac || ni.mac === '00:00:00:00:00:00') continue;
      macs.push(ni.mac.toLowerCase());
    }
  }
  return [...new Set(macs)].sort();
}

/**
 * Return the stable hex machine ID. Cached for the lifetime of the
 * process so the cost is paid once.
 */
function getMachineFingerprint() {
  if (_cachedFingerprint) return _cachedFingerprint;
  const blend = JSON.stringify({
    platform: os.platform(),
    arch: os.arch(),
    host: (os.hostname() || '').toLowerCase(),
    installUuid: _stableInstallUuid(),
    macs: _nicMacs(),
  });
  _cachedFingerprint = crypto.createHash('sha256').update(blend).digest('hex');
  return _cachedFingerprint;
}

/**
 * Hash one or more machine IDs into the canonical form stored inside
 * the signed license payload. We HMAC with a fixed pepper so a stolen
 * license file can't be used to enumerate which machines are bound.
 */
function hashForBinding(machineId) {
  return crypto.createHmac('sha256', 'transtrack-license-binding-v1')
    .update(machineId)
    .digest('hex');
}

function _resetForTests() {
  _cachedFingerprint = null;
}

module.exports = {
  getMachineFingerprint,
  hashForBinding,
  _resetForTests,
};
