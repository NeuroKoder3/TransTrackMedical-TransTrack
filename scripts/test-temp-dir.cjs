/**
 * TransTrack — scratch directory helper for the plain-Node test suites.
 *
 * Several suites stub `electron.app.getPath()` with a directory that the code
 * under test then writes into (databases, logs, backups, key material). Those
 * directories used to be created inside `tests/`, which put working test state
 * — including SQLite files seeded with synthetic PHI — into the repository
 * working tree, where a suite that failed part-way left it behind for the next
 * `git status` to trip over (finding L-9).
 *
 * This helper allocates the directory under the OS temp dir instead and
 * registers removal on process exit. `exit` also fires after an uncaught
 * exception and after an explicit `process.exit()`, so a suite that dies
 * half-way through still cleans up; the signal handlers cover Ctrl-C and CI
 * job cancellation, which do not otherwise run exit handlers.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const registered = new Set();
let hooksInstalled = false;

function removeAll() {
  for (const dir of registered) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // A leaked temp directory must never turn a passing suite red, and the
      // OS reclaims it regardless.
    }
  }
  registered.clear();
}

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;

  process.on('exit', removeAll);

  // Signals bypass `exit`, so clean up and then re-raise with the conventional
  // 128+signo status rather than swallowing the interrupt.
  for (const [signal, signo] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) {
    process.on(signal, () => {
      removeAll();
      process.exit(128 + signo);
    });
  }
}

/**
 * Create a fresh scratch directory outside the repository.
 *
 * @param {string} prefix short suite identifier, e.g. 'svc' or 'health'
 * @param {{ subdirs?: string[] }} [options] child directories to pre-create
 * @returns {string} absolute path to the directory
 */
function createTestDataDir(prefix, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `transtrack-test-${prefix}-`));
  registered.add(dir);
  installHooks();

  for (const sub of options.subdirs || []) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  return dir;
}

/** Remove a directory early, e.g. from a suite's own teardown. */
function cleanupTestDataDir(dir) {
  registered.delete(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // See removeAll().
  }
}

module.exports = { createTestDataDir, cleanupTestDataDir };
