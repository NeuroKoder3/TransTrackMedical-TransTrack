#!/usr/bin/env node
/**
 * TransTrack — Node test suite runner.
 *
 * The repository's plain-Node test suites (tests/*.test.cjs) used to be chained
 * together with `&&` inside package.json. That fails fast on the first broken
 * suite and hides how many others would also have failed, which makes a CI run
 * expensive to diagnose. This runner executes a named group, reports a per-suite
 * summary, and exits non-zero if any suite failed.
 *
 * Usage:
 *   node scripts/run-test-suites.cjs core
 *   node scripts/run-test-suites.cjs security
 *   node scripts/run-test-suites.cjs hardening --bail
 *   node scripts/run-test-suites.cjs --list
 *
 * Flags:
 *   --bail    stop at the first failing suite (previous `&&` behaviour)
 *   --list    print the groups and their suites, then exit
 *
 * Adding a suite: add the filename to the relevant group below. A suite listed
 * in a group but missing from disk is a hard error, so a renamed or deleted
 * test file cannot silently stop running.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TESTS_DIR = path.join(__dirname, '..', 'tests');

/**
 * Security, data-integrity, and audit suites. These carry the compliance
 * controls (HIPAA Security Rule, 21 CFR Part 11) and must never be skipped.
 */
const SECURITY_SUITES = [
  'cross-org-access.test.cjs',
  'sessionFailClosed.test.cjs',
  'phiJustification.test.cjs',
  'phiListJustification.test.cjs',
  'auditChain.test.cjs',
  'auditFailClosed.test.cjs',
  'siemRedaction.test.cjs',
  'phiLeakage.test.cjs',
  'loggerRedaction.test.cjs',
  'restoreDatabase.test.cjs',
  'encryptionVerification.test.cjs',
  // H-8: these were reachable only through bespoke npm scripts and so could
  // regress without failing the default gate. They are compliance-relevant.
  'secretEncryption.test.cjs',
  'oidcDesktop.test.cjs',
  'updateAuthorization.test.cjs',
];

/**
 * Suites covering the hardening controls: Electron process isolation, IPC
 * trust boundary, audit tamper-evidence, RBAC least privilege, secure erase,
 * and local file integrity.
 */
const HARDENING_SUITES = [
  'electronHardening.test.cjs',
  'ipcSenderValidation.test.cjs',
  'ipcArgValidation.test.cjs',
  'rbacMatrix.test.cjs',
  'auditHmac.test.cjs',
  'auditKeyGating.test.cjs',
  'auditImmutability.test.cjs',
  'iotaNotifications.test.cjs',
  'iotaNoticeGenerator.test.cjs',
  'iotaNoticeService.test.cjs',
  'chartFiling.test.cjs',
  'auditExport.test.cjs',
  'secureDelete.test.cjs',
  'integrityMonitor.test.cjs',
  'screenLock.test.cjs',
];

/** Clinical logic, business rules, and integration suites. */
const FUNCTIONAL_SUITES = [
  'business-logic.test.cjs',
  'compliance.test.cjs',
  'ehrMigration.test.cjs',
  'calculators.test.cjs',
  'mfa.test.cjs',
  'hl7v2.test.cjs',
  'hl7Ingest.test.cjs',
  'organOffers.test.cjs',
  'livingDonors.test.cjs',
  'postTransplant.test.cjs',
  'optnExport.test.cjs',
  'siemForwarder.test.cjs',
  'passwordHistory.test.cjs',
  'inactivationRiskEngine.test.cjs',
  'inactivationActionQueue.test.cjs',
  'preventionOutcomes.test.cjs',
  'inactivationAlertRules.test.cjs',
  'preventionDigest.test.cjs',
  'healthCheck.test.cjs',
  'signWin.test.cjs',
  // Wiring/packaging integrity: these cross layer seams that individually-correct
  // unit tests cannot see (renderer↔preload bridge, Vite source entry).
  'rendererBridgeCoverage.test.mjs',
  'buildEntryIntegrity.test.mjs',
  'auditExceptions.test.mjs',
  'migrationSafety.test.cjs',
  'supportBundle.test.cjs',
  // The validation package is a deliverable; its cross-references are checked
  // on the same cadence as the code they describe.
  'complianceDocs.test.mjs',
  // Release signing: the evidence that a shipped artifact is actually signed,
  // and that a release build refuses to produce one that is not.
  'artifactSignature.test.mjs',
  'notarize.test.cjs',
  // C-3 / C-4: clinical correctness and the validation trust boundary.
  'calculatorReferenceVectors.test.cjs',
  'clinicalValidation.test.cjs',
  // H-6 / H-7 / M-21: entitlement enforcement and publisher-key provenance.
  'license.test.cjs',
  // H-14 (the offline and thin-client API clients must expose one contract) is
  // covered by tests/components/apiClientParity.test.jsx under Vitest, because
  // the clients are ESM renderer modules. It was previously listed here as
  // 'apiClientParity.test.cjs', a file that has never existed — which made this
  // runner abort before executing a single suite. See RUN_BY_OTHER_RUNNERS and
  // assertNoOrphanSuites below: a listed-but-missing suite is a hard error
  // precisely so this cannot pass unnoticed.
  // Previously reachable only via `npm run test:services` / `test:ipc` (H-8).
  'services.test.cjs',
  'ipc-integration.test.cjs',
];

/**
 * Performance and capacity suites. Excluded from `core` because their runtime
 * is measured in minutes, but run as their own blocking CI job.
 */
const PERFORMANCE_SUITES = ['load-test.cjs'];

/**
 * Test files that are executed by another runner (Vitest, Playwright) or are
 * shared fixtures rather than suites. Listed so the orphan check below can
 * tell "runs elsewhere" apart from "runs nowhere".
 */
const RUN_BY_OTHER_RUNNERS = new Set(['setup-react.js']);

const GROUPS = {
  security: SECURITY_SUITES,
  hardening: HARDENING_SUITES,
  functional: FUNCTIONAL_SUITES,
  performance: PERFORMANCE_SUITES,
  // The default `npm test` group: everything that runs under plain Node without
  // a build step, a display, or a database server.
  core: dedupe([...SECURITY_SUITES, ...HARDENING_SUITES, ...FUNCTIONAL_SUITES]),
  all: dedupe([...SECURITY_SUITES, ...HARDENING_SUITES, ...FUNCTIONAL_SUITES, ...PERFORMANCE_SUITES]),
};

function dedupe(list) {
  return [...new Set(list)];
}

/**
 * Every Node suite on disk must belong to a group. Without this check a new
 * test file can be added, pass locally, and never run in CI — which is how the
 * suites named in finding H-8 came to sit outside the default gate.
 */
function assertNoOrphanSuites() {
  const claimed = new Set(GROUPS.all);
  const onDisk = fs
    .readdirSync(TESTS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => /\.(test\.(cjs|mjs)|test\.js)$/.test(n) || n === 'load-test.cjs')
    .filter((n) => !RUN_BY_OTHER_RUNNERS.has(n));

  const orphans = onDisk.filter((n) => !claimed.has(n));
  if (orphans.length > 0) {
    fail(
      `these suites exist in tests/ but are not listed in any group, so they ` +
      `would never run: ${orphans.join(', ')}`
    );
  }
}

function fail(message) {
  console.error(`\nrun-test-suites: ${message}`);
  process.exit(1);
}

function printList() {
  for (const [name, suites] of Object.entries(GROUPS)) {
    console.log(`\n${name} (${suites.length} suites)`);
    for (const suite of suites) console.log(`  ${suite}`);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    printList();
    return;
  }

  assertNoOrphanSuites();

  const bail = args.includes('--bail');
  const groupName = args.find((a) => !a.startsWith('--')) || 'core';
  const suites = GROUPS[groupName];

  if (!suites) {
    fail(`unknown group "${groupName}". Available: ${Object.keys(GROUPS).join(', ')}`);
  }

  // A suite that has been renamed or removed must break the build rather than
  // quietly stop protecting the control it covers.
  const missing = suites.filter((s) => !fs.existsSync(path.join(TESTS_DIR, s)));
  if (missing.length > 0) {
    fail(`these suites are listed in group "${groupName}" but missing from tests/: ${missing.join(', ')}`);
  }

  console.log(`Running ${suites.length} suites in group "${groupName}"\n`);

  const results = [];
  const startedAll = Date.now();

  for (const suite of suites) {
    const started = Date.now();
    process.stdout.write(`──── ${suite}\n`);

    const run = spawnSync(process.execPath, [path.join(TESTS_DIR, suite)], {
      stdio: 'inherit',
      env: process.env,
    });

    const durationMs = Date.now() - started;
    // A suite killed by a signal (segfault in a native module, OOM) has a null
    // exit code; treat that as a failure rather than a pass.
    const ok = run.status === 0;
    results.push({ suite, ok, status: run.status, signal: run.signal, durationMs });

    if (!ok && bail) break;
  }

  const failed = results.filter((r) => !r.ok);
  const totalMs = Date.now() - startedAll;

  console.log(`\n${'='.repeat(64)}`);
  console.log(`Suite summary — group "${groupName}"`);
  console.log('='.repeat(64));
  for (const r of results) {
    const status = r.ok ? 'PASS' : `FAIL${r.signal ? ` (${r.signal})` : ` (exit ${r.status})`}`;
    console.log(`${status.padEnd(16)} ${r.suite.padEnd(38)} ${(r.durationMs / 1000).toFixed(1)}s`);
  }

  const skipped = suites.length - results.length;
  console.log('-'.repeat(64));
  console.log(
    `${results.length - failed.length}/${suites.length} suites passed` +
    `${skipped > 0 ? `, ${skipped} not run (--bail)` : ''}` +
    ` in ${(totalMs / 1000).toFixed(1)}s`
  );

  if (failed.length > 0) {
    console.error(`\nFailed suites: ${failed.map((f) => f.suite).join(', ')}`);
    process.exit(1);
  }
}

main();
