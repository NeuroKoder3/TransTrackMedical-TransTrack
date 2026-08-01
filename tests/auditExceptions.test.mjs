/**
 * TransTrack — dependency vulnerability exception gate.
 *
 * `scripts/audit-with-exceptions.mjs` is the only thing standing between "a
 * finding was reviewed and judged unreachable" and "a finding was quietly
 * ignored". Its value is entirely in the cases where it must FAIL, so those are
 * what this suite exercises: an undocumented finding, a lapsed review date, an
 * exception that no longer matches reality, and a finding whose severity rose
 * after it was assessed.
 *
 * The gate is driven through its `--json` output against a synthetic npm audit
 * report and a synthetic exceptions file, so the assertions do not depend on
 * whatever the real dependency tree happens to contain today.
 *
 * Run standalone: node tests/auditExceptions.test.mjs
 */

import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(repoRoot, 'scripts', 'audit-with-exceptions.mjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const ADVISORY = 'GHSA-test-1111-aaaa';

/** A synthetic `npm audit --json` report shaped like npm's real output. */
function auditReport({ severity = 'high', pkg = 'demo-pkg', dependent = 'demo-pkg-dom' } = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      [pkg]: {
        name: pkg,
        severity,
        isDirect: false,
        via: [{
          source: 1234567,
          name: pkg,
          dependency: pkg,
          title: 'Synthetic advisory for gate testing',
          url: `https://github.com/advisories/${ADVISORY}`,
          severity,
          range: '1.0.0 - 2.0.0',
        }],
        effects: [dependent],
        range: '1.0.0 - 2.0.0',
        nodes: [`node_modules/${pkg}`],
        fixAvailable: false,
      },
      [dependent]: {
        name: dependent,
        severity,
        isDirect: true,
        via: [pkg],
        effects: [],
        range: '>=1.0.0',
        nodes: [`node_modules/${dependent}`],
        fixAvailable: false,
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  };
}

function exception(overrides = {}) {
  return {
    advisory: ADVISORY,
    package: 'demo-pkg',
    title: 'Synthetic advisory for gate testing',
    severity: 'high',
    vulnerableRange: '1.0.0 - 2.0.0',
    status: 'not_affected',
    justification: 'vulnerable_code_not_present',
    analysis: ['Synthetic entry used only by tests/auditExceptions.test.mjs.'],
    remediationPlan: 'n/a',
    assessedBy: 'test',
    assessedOn: '2026-01-01',
    reviewBy: '2099-01-01',
    ...overrides,
  };
}

/**
 * Run the gate in a sandbox whose `npm` resolves to a stub that prints our
 * synthetic report. This exercises the real script end to end — argument
 * handling, parsing, decision logic and exit code — without touching the
 * repository's own dependency tree or exceptions file.
 */
function runGate({ report, exceptions, extraArgs = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'tt-audit-gate-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'security'), { recursive: true });
    mkdirSync(join(dir, 'bin'), { recursive: true });

    cpSync(SCRIPT, join(dir, 'scripts', 'audit-with-exceptions.mjs'));
    writeFileSync(
      join(dir, 'security', 'vulnerability-exceptions.json'),
      JSON.stringify({ severityThreshold: 'moderate', exceptions }, null, 2),
    );

    // Stub `npm` on PATH. The script invokes `npm audit --omit=dev --json`; the
    // stub ignores arguments and emits the synthetic report on stdout with a
    // non-zero exit, exactly as npm does when findings exist.
    const payload = JSON.stringify(report);
    writeFileSync(join(dir, 'bin', 'npm-report.json'), payload);
    const runner =
      `#!/usr/bin/env node\n` +
      `const fs=require('fs');const path=require('path');\n` +
      `process.stdout.write(fs.readFileSync(path.join(__dirname,'npm-report.json'),'utf8'));\n` +
      `process.exit(1);\n`;
    writeFileSync(join(dir, 'bin', 'npm-stub.cjs'), runner);
    if (process.platform === 'win32') {
      writeFileSync(join(dir, 'bin', 'npm.cmd'), `@echo off\r\nnode "%~dp0npm-stub.cjs" %*\r\n`);
    } else {
      writeFileSync(join(dir, 'bin', 'npm'), `#!/bin/sh\nexec node "$(dirname "$0")/npm-stub.cjs" "$@"\n`, { mode: 0o755 });
    }

    // No `shell: true` here: process.execPath is "C:\Program Files\nodejs\node.exe"
    // on Windows and a shell concatenates arguments without quoting, so the space
    // in "Program Files" would split the command. The gate itself still uses a
    // shell where it needs one (to reach npm.cmd).
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'audit-with-exceptions.mjs'), '--json', ...extraArgs], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, PATH: `${join(dir, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, NO_COLOR: '1' },
    });

    const stdout = (r.stdout || '').toString();
    let json = null;
    try { json = JSON.parse(stdout); } catch { /* non-JSON means the script bailed */ }
    return { status: r.status, json, stdout, stderr: (r.stderr || '').toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nThe gate passes only when a finding is properly documented');

test('a finding covered by a valid exception passes', () => {
  const r = runGate({ report: auditReport(), exceptions: [exception()] });
  assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.accepted, 1);
  assert.strictEqual(r.json.unresolved, 0);
});

test('the accepted item reports its status, justification and review date', () => {
  const r = runGate({ report: auditReport(), exceptions: [exception()] });
  const [item] = r.json.acceptedItems;
  assert.strictEqual(item.advisory, ADVISORY);
  assert.strictEqual(item.status, 'not_affected');
  assert.strictEqual(item.justification, 'vulnerable_code_not_present');
  assert.strictEqual(item.reviewBy, '2099-01-01');
});

test('transitively affected packages are attributed to the advisory', () => {
  // Blast radius must not be understated: demo-pkg-dom is affected via demo-pkg
  // and appears in npm's output only as a plain string.
  const r = runGate({ report: auditReport(), exceptions: [] });
  const [finding] = r.json.unresolvedItems;
  assert.deepStrictEqual(finding.affectedPackages, ['demo-pkg', 'demo-pkg-dom']);
});

console.log('\nThe gate fails when a decision is missing, lapsed, or outdated');

test('an undocumented finding fails', () => {
  const r = runGate({ report: auditReport(), exceptions: [] });
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.json.ok, false);
  assert.strictEqual(r.json.unresolved, 1);
  assert.strictEqual(r.json.unresolvedItems[0].advisory, ADVISORY);
});

test('an exception past its reviewBy date fails', () => {
  const r = runGate({ report: auditReport(), exceptions: [exception({ reviewBy: '2020-01-01' })] });
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.json.expired, 1);
  assert.strictEqual(r.json.accepted, 0);
});

test('an exception that no longer matches any finding fails as stale', () => {
  const r = runGate({
    report: { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } },
    exceptions: [exception()],
  });
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.json.stale, 1);
  assert.strictEqual(r.json.staleItems[0].advisory, ADVISORY);
});

test('a severity increase since assessment invalidates the exception', () => {
  const r = runGate({
    report: auditReport({ severity: 'critical' }),
    exceptions: [exception({ severity: 'high' })],
  });
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.json.accepted, 0);
  assert.strictEqual(r.json.unresolved, 1);
  assert.match(r.json.unresolvedItems[0].note, /severity increased/);
});

test('an exception for a different package does not cover the finding', () => {
  const r = runGate({ report: auditReport(), exceptions: [exception({ package: 'some-other-pkg' })] });
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.json.unresolved, 1);
});

test('an exception for a different advisory does not cover the finding', () => {
  const r = runGate({ report: auditReport(), exceptions: [exception({ advisory: 'GHSA-zzzz-9999-bbbb' })] });
  assert.strictEqual(r.status, 1);
  // Also stale, since the listed advisory matches nothing.
  assert.ok(r.json.unresolved >= 1);
});

test('an exception missing a required field is rejected outright', () => {
  for (const field of ['analysis', 'assessedBy', 'reviewBy', 'justification', 'status']) {
    const incomplete = exception();
    delete incomplete[field];
    const r = runGate({ report: auditReport(), exceptions: [incomplete] });
    assert.strictEqual(r.status, 2, `missing "${field}" should be a hard configuration error`);
    assert.match(r.stderr, /missing required field/);
  }
});

console.log('\nSeverity threshold');

test('a finding below the threshold is not required to be documented', () => {
  const r = runGate({ report: auditReport({ severity: 'low' }), exceptions: [] });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.json.atOrAboveThreshold, 0);
});

test('--severity raises the bar', () => {
  const r = runGate({
    report: auditReport({ severity: 'moderate' }),
    exceptions: [],
    extraArgs: ['--severity=critical'],
  });
  assert.strictEqual(r.status, 0, 'a moderate finding is below a critical threshold');
});

console.log("\nThe repository's own exceptions file");

test('the committed exceptions file is valid and fully documented', () => {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'security', 'vulnerability-exceptions.json'), 'utf8'));
  assert.ok(Array.isArray(raw.exceptions), 'exceptions must be an array');
  for (const e of raw.exceptions) {
    for (const field of ['advisory', 'package', 'severity', 'status', 'justification', 'analysis', 'assessedBy', 'assessedOn', 'reviewBy', 'remediationPlan']) {
      assert.ok(e[field], `exception ${e.advisory}: missing ${field}`);
    }
    assert.ok(
      Array.isArray(e.analysis) ? e.analysis.join(' ').length > 200 : String(e.analysis).length > 200,
      `exception ${e.advisory}: analysis must be a substantive reachability argument, not a one-liner`,
    );
    assert.ok(
      new Date(e.reviewBy) > new Date(e.assessedOn),
      `exception ${e.advisory}: reviewBy must be after assessedOn`,
    );
  }
});

test('no committed exception has already lapsed', () => {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'security', 'vulnerability-exceptions.json'), 'utf8'));
  const lapsed = raw.exceptions.filter((e) => new Date(e.reviewBy) < new Date());
  assert.deepStrictEqual(
    lapsed.map((e) => `${e.advisory} (due ${e.reviewBy})`), [],
    'these exceptions need re-assessment',
  );
});

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.stack}\n`);
  process.exit(1);
}
