/**
 * TransTrack - Secure Deletion
 *
 * Deleting a file only unlinks the directory entry; the bytes stay on disk
 * until the filesystem happens to reuse those blocks. For files that held PHI
 * — CSV/PDF exports, imported EHR payloads, temporary decrypted copies,
 * retired backups — this module overwrites the content before unlinking.
 *
 * The row-level equivalent inside the database is `PRAGMA secure_delete = ON`,
 * set in electron/database/init.cjs.
 *
 * SCOPE AND HONEST LIMITS: overwrite-in-place is effective on traditional
 * block storage. On SSDs with wear levelling, on copy-on-write filesystems
 * (APFS, Btrfs, ZFS), and on any snapshotted or journaled volume, the original
 * blocks may survive somewhere the application cannot reach. Full-disk
 * encryption is the only reliable defence for that residue, which is why it
 * remains a documented deployment requirement rather than something this code
 * can guarantee. See docs/PRODUCTION_READINESS.md.
 *
 * HIPAA 164.310(d)(2)(i) - Device and media disposal
 * HIPAA 164.310(d)(2)(ii) - Media re-use
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PASSES = 3;
const CHUNK_BYTES = 64 * 1024;

/**
 * Overwrite a file's contents in place, then remove it.
 *
 * Opens by descriptor and uses fstat on that descriptor so there is no
 * exists()-then-act TOCTOU window (the pattern CodeQL flags as
 * js/file-system-race).
 *
 * @param {string} filePath
 * @param {{passes?: number, rename?: boolean}} [options]
 *   passes  number of overwrite passes (default 3: random, random, zeros)
 *   rename  rename to a random name before unlinking, so the original
 *           filename does not persist in the directory journal
 * @returns {{deleted: boolean, passes: number, bytes: number, reason?: string}}
 */
function secureDeleteFile(filePath, options = {}) {
  const passes = Number.isInteger(options.passes) && options.passes > 0
    ? options.passes
    : DEFAULT_PASSES;
  const shouldRename = options.rename !== false;

  let fd;
  try {
    fd = fs.openSync(filePath, 'r+');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Already gone — the desired end state, so report success.
      return { deleted: true, passes: 0, bytes: 0, reason: 'not_found' };
    }
    return { deleted: false, passes: 0, bytes: 0, reason: err.code || 'open_failed' };
  }

  let size = 0;
  try {
    size = fs.fstatSync(fd).size;

    for (let pass = 0; pass < passes; pass += 1) {
      // Final pass writes zeros so the residue is not obviously random data.
      const useZeros = pass === passes - 1;
      let written = 0;
      while (written < size) {
        const chunkSize = Math.min(CHUNK_BYTES, size - written);
        const chunk = useZeros
          ? Buffer.alloc(chunkSize, 0)
          : crypto.randomBytes(chunkSize);
        fs.writeSync(fd, chunk, 0, chunkSize, written);
        written += chunkSize;
      }
      // Force each pass to the device so a later pass cannot be coalesced
      // away in the page cache.
      fs.fsyncSync(fd);
    }
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    // Overwrite failed; still remove the file so the PHI is at least unlinked.
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    return { deleted: true, passes: 0, bytes: size, reason: `overwrite_failed:${err.code || 'unknown'}` };
  }

  try { fs.closeSync(fd); } catch { /* ignore */ }

  let targetPath = filePath;
  if (shouldRename) {
    try {
      const scrubbed = path.join(
        path.dirname(filePath),
        `.wipe-${crypto.randomBytes(12).toString('hex')}`
      );
      fs.renameSync(filePath, scrubbed);
      targetPath = scrubbed;
    } catch { /* keep the original path */ }
  }

  try {
    fs.unlinkSync(targetPath);
  } catch (err) {
    return { deleted: false, passes, bytes: size, reason: err.code || 'unlink_failed' };
  }

  return { deleted: true, passes, bytes: size };
}

/**
 * Securely delete every file in a directory, then remove the directory.
 * Recurses into subdirectories. Never follows symlinks out of the tree.
 *
 * @returns {{deleted: number, failed: number, bytes: number}}
 */
function secureDeleteDirectory(dirPath, options = {}) {
  const summary = { deleted: 0, failed: 0, bytes: 0 };

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return summary;
    summary.failed += 1;
    return summary;
  }

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = secureDeleteDirectory(entryPath, options);
      summary.deleted += nested.deleted;
      summary.failed += nested.failed;
      summary.bytes += nested.bytes;
    } else if (entry.isSymbolicLink()) {
      // Wiping through a symlink would destroy an unrelated file; just unlink.
      try { fs.unlinkSync(entryPath); summary.deleted += 1; } catch { summary.failed += 1; }
    } else {
      const result = secureDeleteFile(entryPath, options);
      if (result.deleted) {
        summary.deleted += 1;
        summary.bytes += result.bytes;
      } else {
        summary.failed += 1;
      }
    }
  }

  try { fs.rmdirSync(dirPath); } catch { /* non-empty or already gone */ }
  return summary;
}

/**
 * Run a callback with a temporary file path, guaranteeing the file is securely
 * wiped afterwards even if the callback throws. Use for any transient file
 * that holds decrypted PHI.
 *
 * @param {string} tempPath
 * @param {(tempPath: string) => T} work
 * @returns {T}
 */
function withSecureTempFile(tempPath, work) {
  try {
    return work(tempPath);
  } finally {
    try { secureDeleteFile(tempPath); } catch { /* best effort */ }
  }
}

module.exports = {
  secureDeleteFile,
  secureDeleteDirectory,
  withSecureTempFile,
  DEFAULT_PASSES,
};
