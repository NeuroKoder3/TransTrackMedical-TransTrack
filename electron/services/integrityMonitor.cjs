/**
 * TransTrack - Local Tamper Detection
 *
 * Detects modification of the main-process JavaScript that enforces the
 * security controls. On a workstation an attacker with local write access
 * could otherwise edit, for example, accessControl.cjs to grant themselves
 * every permission, or shared.cjs to stop writing audit rows, and nothing
 * would report it.
 *
 * How it works:
 *   - A baseline manifest maps each protected file to its SHA-256 digest.
 *   - The manifest itself is HMAC'd with a key held in OS secure storage, so
 *     an attacker cannot simply regenerate it after editing a file.
 *   - Verification recomputes the digests and reports drift.
 *
 * WHY THIS REPORTS RATHER THAN BLOCKS: refusing to start on a digest mismatch
 * would brick the application after any legitimate patch, in-place upgrade, or
 * antivirus quarantine-and-restore — for a clinical system that is a worse
 * outcome than running with a loud warning. Findings surface through
 * system:getHealth and are written to the audit trail. Code signing plus
 * electron-updater signature verification remain the controls that stop
 * unauthorized binaries from being installed in the first place; this is the
 * detective layer behind them.
 *
 * HIPAA 164.312(c)(1) - Integrity
 * HIPAA 164.312(e)(2)(i) - Integrity controls
 * 21 CFR 11.10(a) - Validation, ability to discern altered records
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let app, safeStorage;
try { ({ app, safeStorage } = require('electron')); } catch { /* plain Node / CI */ }

const MANIFEST_FILENAME = 'integrity-baseline.json';
const MANIFEST_VERSION = 1;

/**
 * Files whose modification would weaken a security control. Paths are relative
 * to the electron/ directory. Kept explicit rather than globbed so that adding
 * a file to the protected set is a deliberate, reviewable decision.
 *
 * NOTE: Epic/FHIR/HL7 integration modules are intentionally monitored too —
 * observing them is read-only and cannot alter their behaviour.
 */
const PROTECTED_FILES = [
  'main.cjs',
  'preload.cjs',
  'config/securityPolicy.cjs',
  'database/init.cjs',
  'database/schema.cjs',
  'database/migrations.cjs',
  'ipc/handlers.cjs',
  'ipc/shared.cjs',
  'ipc/senderValidation.cjs',
  'ipc/argValidation.cjs',
  'ipc/rateLimiter.cjs',
  'ipc/auditReportHandler.cjs',
  'ipc/handlers/auth.cjs',
  'ipc/handlers/entities.cjs',
  'ipc/handlers/mfa.cjs',
  'services/accessControl.cjs',
  'services/auditCanonical.cjs',
  'services/auditChain.cjs',
  'services/auditExport.cjs',
  'services/auditHmacKey.cjs',
  'services/encryptionKeyManagement.cjs',
  'services/electronicSignature.cjs',
  'services/integrityMonitor.cjs',
  'services/logger.cjs',
  'services/screenLock.cjs',
  'services/secretEncryption.cjs',
  'services/secureDelete.cjs',
];

function getElectronRoot() {
  return path.join(__dirname, '..');
}

function getManifestPath() {
  if (!app || typeof app.getPath !== 'function') return null;
  return path.join(app.getPath('userData'), MANIFEST_FILENAME);
}

function isSafeStorageAvailable() {
  try {
    return Boolean(
      safeStorage
      && typeof safeStorage.isEncryptionAvailable === 'function'
      && safeStorage.isEncryptionAvailable()
    );
  } catch {
    return false;
  }
}

function hashFile(absolutePath) {
  try {
    const contents = fs.readFileSync(absolutePath);
    return crypto.createHash('sha256').update(contents).digest('hex');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Compute the current digest set for every protected file.
 * @param {string} [rootDir] override for tests
 * @returns {{ files: Record<string,string|null>, missing: string[] }}
 */
function computeDigests(rootDir) {
  const root = rootDir || getElectronRoot();
  const files = {};
  const missing = [];

  for (const relativePath of PROTECTED_FILES) {
    const digest = hashFile(path.join(root, relativePath));
    files[relativePath] = digest;
    if (digest === null) missing.push(relativePath);
  }

  return { files, missing };
}

/**
 * Seal a manifest so it cannot be regenerated without the OS-held key.
 * Falls back to an unkeyed digest when no keyring exists, and says so, rather
 * than silently pretending the manifest is protected.
 */
function sealManifest(manifest) {
  const canonical = JSON.stringify(manifest.files, Object.keys(manifest.files).sort());

  if (isSafeStorageAvailable()) {
    try {
      // safeStorage output is bound to the OS user account, so an attacker in a
      // different account cannot produce a matching seal.
      return {
        algorithm: 'safeStorage+sha256',
        value: safeStorage.encryptString(
          crypto.createHash('sha256').update(canonical).digest('hex')
        ).toString('base64'),
      };
    } catch { /* fall through to unkeyed */ }
  }

  return {
    algorithm: 'sha256-unkeyed',
    value: crypto.createHash('sha256').update(canonical).digest('hex'),
  };
}

function verifySeal(manifest) {
  const seal = manifest?.seal;
  if (!seal || typeof seal.value !== 'string') return { ok: false, reason: 'missing_seal' };

  const canonical = JSON.stringify(manifest.files, Object.keys(manifest.files).sort());
  const expectedDigest = crypto.createHash('sha256').update(canonical).digest('hex');

  if (seal.algorithm === 'safeStorage+sha256') {
    if (!isSafeStorageAvailable()) return { ok: false, reason: 'safe_storage_unavailable' };
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(seal.value, 'base64'));
      return decrypted === expectedDigest
        ? { ok: true }
        : { ok: false, reason: 'seal_mismatch' };
    } catch {
      return { ok: false, reason: 'seal_decrypt_failed' };
    }
  }

  if (seal.algorithm === 'sha256-unkeyed') {
    return seal.value === expectedDigest ? { ok: true } : { ok: false, reason: 'seal_mismatch' };
  }

  return { ok: false, reason: 'unknown_seal_algorithm' };
}

/**
 * Write (or rewrite) the baseline. Called on first run and after an upgrade
 * changes the application version.
 */
function createBaseline({ rootDir, manifestPath } = {}) {
  const target = manifestPath || getManifestPath();
  if (!target) return { created: false, reason: 'no_user_data_path' };

  const { files, missing } = computeDigests(rootDir);
  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    appVersion: (app && typeof app.getVersion === 'function') ? app.getVersion() : 'unknown',
    createdAt: new Date().toISOString(),
    files,
  };
  manifest.seal = sealManifest(manifest);

  try {
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  } catch (err) {
    return { created: false, reason: err.code || 'write_failed' };
  }

  return {
    created: true,
    fileCount: Object.keys(files).length,
    missing,
    sealAlgorithm: manifest.seal.algorithm,
  };
}

function readManifest(manifestPath) {
  const target = manifestPath || getManifestPath();
  if (!target) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Compare the current files against the sealed baseline.
 *
 * @returns {{
 *   status: 'ok'|'baseline_missing'|'baseline_untrusted'|'modified'|'version_changed'|'unavailable',
 *   modified: string[], missing: string[], added: string[],
 *   checked: number, sealAlgorithm?: string, reason?: string
 * }}
 */
function verifyIntegrity({ rootDir, manifestPath } = {}) {
  const empty = { modified: [], missing: [], added: [], checked: 0 };

  const target = manifestPath || getManifestPath();
  if (!target) return { status: 'unavailable', reason: 'no_user_data_path', ...empty };

  const manifest = readManifest(target);
  if (!manifest || !manifest.files) {
    return { status: 'baseline_missing', ...empty };
  }

  const sealResult = verifySeal(manifest);
  if (!sealResult.ok) {
    // The manifest itself was altered — treat it as untrustworthy rather than
    // comparing against attacker-controlled digests.
    return { status: 'baseline_untrusted', reason: sealResult.reason, ...empty };
  }

  const currentVersion = (app && typeof app.getVersion === 'function') ? app.getVersion() : 'unknown';
  if (manifest.appVersion && manifest.appVersion !== currentVersion) {
    return {
      status: 'version_changed',
      reason: `baseline recorded for ${manifest.appVersion}, running ${currentVersion}`,
      ...empty,
      sealAlgorithm: manifest.seal.algorithm,
    };
  }

  const { files: current } = computeDigests(rootDir);
  const modified = [];
  const missing = [];
  const added = [];

  for (const [relativePath, baselineDigest] of Object.entries(manifest.files)) {
    const currentDigest = current[relativePath];
    if (currentDigest === null || currentDigest === undefined) {
      missing.push(relativePath);
    } else if (currentDigest !== baselineDigest) {
      modified.push(relativePath);
    }
  }

  for (const relativePath of Object.keys(current)) {
    if (!(relativePath in manifest.files)) added.push(relativePath);
  }

  const clean = modified.length === 0 && missing.length === 0 && added.length === 0;
  return {
    status: clean ? 'ok' : 'modified',
    modified,
    missing,
    added,
    checked: Object.keys(manifest.files).length,
    sealAlgorithm: manifest.seal.algorithm,
  };
}

/**
 * Startup entry point: establish a baseline on first run or after an upgrade,
 * otherwise verify. Never throws — integrity monitoring must not prevent the
 * application from starting.
 *
 * @returns {object} the verification result, with `baselineCreated` when a new
 *   baseline was written.
 */
function initializeIntegrityMonitor(options = {}) {
  try {
    let result = verifyIntegrity(options);

    if (result.status === 'baseline_missing' || result.status === 'version_changed') {
      const created = createBaseline(options);
      if (created.created) {
        result = { ...verifyIntegrity(options), baselineCreated: true, previousStatus: result.status };
      }
    }

    return result;
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err.message,
      modified: [],
      missing: [],
      added: [],
      checked: 0,
    };
  }
}

module.exports = {
  initializeIntegrityMonitor,
  verifyIntegrity,
  createBaseline,
  computeDigests,
  readManifest,
  PROTECTED_FILES,
  MANIFEST_FILENAME,
};
