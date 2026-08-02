/**
 * TransTrack - Filesystem path confinement for backup/restore IPC
 *
 * `file:restoreDatabase` and `backup:create-and-verify` take a filesystem path
 * from the renderer. An admin session was the only control on them, which means
 * a compromised renderer (or an operator who pasted the wrong string) could read
 * a database image from anywhere on the volume, or write a copy of the live
 * encrypted database anywhere the user account can write — including a synced
 * folder or a removable drive. Restricting these to the directories the product
 * actually manages keeps a PHI-bearing file inside the boundary the deployment
 * documented, and turns "restore from an attacker-planted file" into an error.
 *
 * Confinement is done on the *canonical* path: every path is resolved through
 * fs.realpathSync so a symlink whose target sits outside the allowlist is caught
 * by its target, not by its name. Paths that do not exist yet (a backup about to
 * be written) are canonicalised via their deepest existing ancestor, so a
 * symlinked parent directory is resolved too.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Windows and macOS default to case-insensitive filesystems, so a containment
 * comparison that is case-sensitive there would let `C:\USERS\...` escape a root
 * recorded as `C:\Users\...`. Linux is case-sensitive and must stay that way.
 */
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

/**
 * Resolve a directory to its canonical form, tolerating a root that has not been
 * created yet (a fresh install has no backups directory until the first backup).
 */
function canonicalizeRoot(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * The directories a backup or restore path may live in.
 *
 * TRANSTRACK_BACKUP_DIR is honoured because disasterRecovery.cjs and the
 * pre-migration safety copies already write there; a site that redirects backups
 * to a managed volume must be able to restore from it. TRANSTRACK_EXPORT_DIR is
 * the deliberate escape hatch for an operator who keeps images on a specific
 * share — it exists only when the deployment sets it, so the default posture is
 * "userData only".
 *
 * The userData directory itself is included because restoreDatabaseFromBackup
 * leaves `.pre-restore.<ts>` images beside the live database, and rolling one of
 * those back is the documented recovery from a bad restore.
 */
function getAllowedRoots() {
  const roots = [];

  let userData = null;
  try {
    userData = app.getPath('userData');
  } catch {
    userData = null;
  }

  if (userData) {
    roots.push({ label: 'application data directory', dir: canonicalizeRoot(userData) });
  }

  const backupDir = process.env.TRANSTRACK_BACKUP_DIR
    || (userData ? path.join(userData, 'backups') : null);
  if (backupDir) {
    roots.push({ label: 'backup directory', dir: canonicalizeRoot(backupDir) });
  }

  const exportDir = process.env.TRANSTRACK_EXPORT_DIR;
  if (exportDir) {
    roots.push({ label: 'configured export directory', dir: canonicalizeRoot(exportDir) });
  }

  return roots;
}

/** Compare two canonical paths for containment, honouring the platform's casing. */
function isWithin(candidate, root) {
  const a = CASE_INSENSITIVE_FS ? candidate.toLowerCase() : candidate;
  const b = CASE_INSENSITIVE_FS ? root.toLowerCase() : root;
  if (a === b) return true;
  return a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

/**
 * Canonicalise a path that may not exist yet.
 *
 * Walks up to the deepest ancestor that does exist, resolves that through
 * realpath, then re-appends the segments below it. This is what makes a target
 * like `<backups>/link-to-elsewhere/evil.db` resolve to its real location even
 * though the leaf has never been created.
 */
function canonicalizeTarget(absolutePath) {
  let current = absolutePath;
  const trailing = [];

  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...trailing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolutePath; // reached the volume root
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve `candidate` and prove it lands inside an allowlisted directory.
 *
 * @param {string} candidate      caller-supplied path
 * @param {object} [options]
 * @param {string} [options.purpose]  wording for the error message
 * @param {boolean} [options.mustExist]  require an existing regular file
 * @param {string[]} [options.extensions]  permitted lower-case file extensions
 * @returns {string} the canonical, confined path
 * @throws {Error} when the path is malformed, escapes the allowlist, or fails
 *                 the existence/extension checks. There is no permissive branch:
 *                 if the allowlist cannot be determined the call is refused.
 */
function resolveConfinedPath(candidate, options = {}) {
  const purpose = options.purpose || 'this operation';

  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error(`A file path is required for ${purpose}`);
  }
  if (candidate.includes('\0')) {
    throw new Error(`Invalid file path for ${purpose}`);
  }
  if (!path.isAbsolute(candidate)) {
    // A relative path would resolve against the main process's working
    // directory, which is not a location the operator can reason about.
    throw new Error(`An absolute file path is required for ${purpose}`);
  }

  const roots = getAllowedRoots();
  if (roots.length === 0) {
    throw new Error(
      `Refusing ${purpose}: no permitted directory could be resolved. ` +
      'Set TRANSTRACK_BACKUP_DIR or TRANSTRACK_EXPORT_DIR.'
    );
  }

  const resolved = canonicalizeTarget(path.resolve(candidate));
  const root = roots.find(r => isWithin(resolved, r.dir));
  if (!root) {
    throw new Error(
      `Refusing ${purpose}: the path is outside the permitted directories ` +
      `(${roots.map(r => r.label).join(', ')}).`
    );
  }

  if (Array.isArray(options.extensions) && options.extensions.length > 0) {
    const ext = path.extname(resolved).toLowerCase();
    if (!options.extensions.includes(ext)) {
      throw new Error(
        `Refusing ${purpose}: "${ext || 'no extension'}" is not an accepted file type ` +
        `(${options.extensions.join(', ')}).`
      );
    }
  }

  if (options.mustExist) {
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new Error(`Backup file not found`);
    }
    if (!stat.isFile()) {
      throw new Error(`Refusing ${purpose}: the path is not a regular file.`);
    }
  } else {
    // A target that is about to be written must have a real, confined parent —
    // otherwise the write creates the file wherever the parent link points.
    const parent = canonicalizeTarget(path.dirname(resolved));
    if (!roots.some(r => isWithin(parent, r.dir))) {
      throw new Error(
        `Refusing ${purpose}: the destination directory is outside the permitted directories.`
      );
    }
  }

  return resolved;
}

/**
 * Where a backup goes when the caller did not name a destination.
 *
 * The backup directory is preferred over the application data directory so the
 * retention sweep in disasterRecovery.cjs sees the file.
 */
function defaultBackupPath(now = new Date()) {
  const roots = getAllowedRoots();
  const target = roots.find(r => r.label === 'backup directory') || roots[0];
  if (!target) {
    throw new Error('Refusing to back up: no permitted directory could be resolved.');
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(target.dir, `transtrack-backup-${stamp}.db`);
}

module.exports = { getAllowedRoots, resolveConfinedPath, defaultBackupPath };
