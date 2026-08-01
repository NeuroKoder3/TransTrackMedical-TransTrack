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
  'auditChain.test.cjs',
  'siemRedaction.test.cjs',
  'phiLeakage.test.cjs',
  'restoreDatabase.test.cjs',
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
];

const GROUPS = {
  security: SECURITY_SUITES,
  hardening: HARDENING_SUITES,
  functional: FUNCTIONAL_SUITES,
  // The default `npm test` group: everything that runs under plain Node without
  // a build step, a display, or a database server.
  core: dedupe([...SECURITY_SUITES, ...HARDENING_SUITES, ...FUNCTIONAL_SUITES]),
};

function dedupe(list) {
  return [...new Set(list)];
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
