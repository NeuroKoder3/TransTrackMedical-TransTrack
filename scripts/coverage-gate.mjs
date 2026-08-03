#!/usr/bin/env node
/**
 * Renderer coverage gate — finding H-8.
 *
 * What this replaces: the gate lived inline in .github/workflows/ci.yml and
 * enforced `hardMin = 19` for lines and branches, while the 60% "target" only
 * emitted a `::warning::`. A warning does not stop a merge, so in practice the
 * renderer was protected at 19% — and five IPC-bound PHI pages were excluded
 * from the measurement altogether, so even that number was flattering.
 *
 * How the floors are chosen. They are a ratchet: raise, never lower.
 *   • They sit a few points below measured coverage so that an unrelated change
 *     which happens to move a percentage by a fraction does not fail an
 *     otherwise good PR. Anything larger than that margin is a real regression.
 *   • Branches are floored lower than lines because the renderer is full of
 *     defensive `?.` and `|| []` guards on IPC payloads. Those are worth having
 *     and are not all worth a test, so a branch floor equal to the line floor
 *     would push people to delete guards to make CI green.
 *   • Per-file floors (see scripts/coverage-floor.json) are what actually keep
 *     the PHI-handling screens honest. A global floor alone can be met by
 *     covering easy code, and this application's risk is concentrated in a small
 *     number of files.
 *
 * Raising the floors: run `npx vitest run --coverage`, then edit
 * scripts/coverage-floor.json. The ratchet check below fails the build when
 * measured coverage has climbed `ratchet.failAt` points above a floor, so the
 * floors cannot drift permanently behind reality.
 *
 * The same JSON is read by vite.config.js as Vitest's own thresholds, so a
 * local `npx vitest run --coverage` fails for exactly the same reasons CI does.
 * This script runs afterwards and adds three things Vitest does not: the
 * ratchet, a readable job summary, and an independent re-check of the floors so
 * that a `--coverage.thresholds.*` command-line override cannot quietly disable
 * the gate.
 *
 * Usage:
 *   node scripts/coverage-gate.mjs
 *   node scripts/coverage-gate.mjs --summary=coverage/coverage-summary.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const METRICS = ['lines', 'statements', 'functions', 'branches'];

function parseArgs(argv) {
  const opts = { summary: path.join(REPO_ROOT, 'coverage', 'coverage-summary.json') };
  for (const arg of argv) {
    if (arg.startsWith('--summary=')) opts.summary = path.resolve(arg.slice('--summary='.length));
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      console.error(`coverage-gate: unknown argument "${arg}"`);
      process.exit(2);
    }
  }
  return opts;
}

function readJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`coverage-gate: cannot read ${what} at ${file}`);
    console.error(`  ${error.message}`);
    if (what === 'the coverage summary') {
      console.error('  Run `npx vitest run --coverage` first — the json-summary reporter writes it.');
    }
    process.exit(2);
  }
}

/** coverage-summary.json keys are absolute paths; the floor keys are relative. */
function findEntry(summary, relativePath) {
  const suffix = `/${relativePath}`;
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total') continue;
    if (key === relativePath || key.replaceAll('\\', '/').endsWith(suffix)) return value;
  }
  return null;
}

function pct(entry, metric) {
  const value = entry?.[metric]?.pct;
  // v8 reports 100 for a file with nothing measurable ("Unknown" in some
  // versions). Treat a non-numeric percentage as 0 so it cannot pass a floor.
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/coverage-gate.mjs [--summary=<coverage-summary.json>]');
    return;
  }

  const floor = readJson(path.join(__dirname, 'coverage-floor.json'), 'the coverage floor');
  const summary = readJson(opts.summary, 'the coverage summary');
  const total = summary.total;

  if (!total) {
    console.error('coverage-gate: the summary has no "total" entry — it is not a v8/istanbul json-summary report');
    process.exit(2);
  }

  const warnAt = floor.ratchet?.warnAt ?? 3;
  const failAt = floor.ratchet?.failAt ?? 10;

  const failures = [];
  const ratchetDue = [];
  const rows = [];

  for (const metric of METRICS) {
    const required = floor.global[metric];
    if (typeof required !== 'number') {
      console.error(`coverage-gate: no global floor configured for "${metric}"`);
      process.exit(2);
    }
    const actual = pct(total, metric);
    const covered = total[metric]?.covered ?? 0;
    const all = total[metric]?.total ?? 0;
    rows.push({ metric, actual, required, covered, all });

    if (actual < required) {
      failures.push(
        `${metric}: ${actual.toFixed(2)}% is below the floor of ${required}% ` +
        `(${covered}/${all})`
      );
    } else if (actual - required >= failAt) {
      ratchetDue.push(
        `${metric}: ${actual.toFixed(2)}% is ${(actual - required).toFixed(2)} points above its ` +
        `floor of ${required}% — raise it in scripts/coverage-floor.json`
      );
    } else if (actual - required >= warnAt) {
      console.log(
        `::warning::Coverage ratchet: ${metric} is at ${actual.toFixed(2)}% against a floor of ` +
        `${required}%. Raise the floor in scripts/coverage-floor.json to lock the gain in.`
      );
    }
  }

  // Per-file floors. A file that has been renamed or deleted is a hard error:
  // silently dropping its floor is how a covered file becomes an uncovered one.
  const perFileFailures = [];
  for (const [file, thresholds] of Object.entries(floor.perFile ?? {})) {
    const entry = findEntry(summary, file);
    if (!entry) {
      perFileFailures.push(
        `${file}: has a per-file coverage floor but does not appear in the report — ` +
        `it was renamed, deleted, or excluded from coverage. Update scripts/coverage-floor.json deliberately.`
      );
      continue;
    }
    for (const [metric, required] of Object.entries(thresholds)) {
      const actual = pct(entry, metric);
      if (actual < required) {
        perFileFailures.push(`${file}: ${metric} ${actual.toFixed(2)}% is below its floor of ${required}%`);
      }
    }
  }

  const width = 12;
  const lines = [];
  lines.push('');
  lines.push('Renderer coverage gate');
  lines.push('─'.repeat(58));
  lines.push(`${'metric'.padEnd(width)}${'actual'.padStart(10)}${'floor'.padStart(10)}${'covered'.padStart(14)}`);
  for (const row of rows) {
    const verdict = row.actual < row.required ? 'FAIL' : 'ok';
    lines.push(
      `${row.metric.padEnd(width)}${`${row.actual.toFixed(2)}%`.padStart(10)}` +
      `${`${row.required}%`.padStart(10)}${`${row.covered}/${row.all}`.padStart(14)}  ${verdict}`
    );
  }
  lines.push('─'.repeat(58));
  lines.push(`per-file floors checked: ${Object.keys(floor.perFile ?? {}).length}`);
  console.log(lines.join('\n'));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      '### Renderer coverage gate',
      '',
      '| metric | actual | floor | covered | verdict |',
      '| --- | --- | --- | --- | --- |',
      ...rows.map((r) => {
        const verdict = r.actual < r.required ? ':x: below floor' : ':white_check_mark:';
        return `| ${r.metric} | ${r.actual.toFixed(2)}% | ${r.required}% | ${r.covered}/${r.all} | ${verdict} |`;
      }),
      '',
      `Per-file floors checked: ${Object.keys(floor.perFile ?? {}).length}`,
      '',
    ];
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);
    } catch {
      // A summary is a convenience; never fail the gate over it.
    }
  }

  if (perFileFailures.length > 0) {
    console.error('\nPer-file coverage floors not met:');
    for (const f of perFileFailures) console.error(`  ✗ ${f}`);
  }

  if (failures.length > 0) {
    console.error('\nGlobal coverage floors not met:');
    for (const f of failures) console.error(`  ✗ ${f}`);
  }

  if (failures.length > 0 || perFileFailures.length > 0) {
    console.error('\nCOVERAGE GATE: FAILED');
    process.exit(1);
  }

  if (ratchetDue.length > 0) {
    console.error('\nCoverage has outgrown its floor by more than the ratchet tolerance:');
    for (const r of ratchetDue) console.error(`  ✗ ${r}`);
    console.error(
      '\nThe floor is what protects the code, and a floor far below reality protects nothing.\n' +
      'Raise the values in scripts/coverage-floor.json to at most the measured percentages.'
    );
    console.error('\nCOVERAGE GATE: FAILED (ratchet)');
    process.exit(1);
  }

  console.log('\nCOVERAGE GATE: PASSED');
}

main();
