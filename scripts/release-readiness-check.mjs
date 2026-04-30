#!/usr/bin/env node
/**
 * TransTrack — Release readiness gate.
 *
 * One command, one report. Anyone evaluating the build (engineering lead,
 * compliance officer, CareDx diligence team) should be able to run this and
 * know within ~3 minutes whether the working tree is releasable.
 *
 * Usage:
 *   npm run release:check
 *   node scripts/release-readiness-check.mjs --strict   # exit 1 on any soft-fail
 *
 * Output is a single table; the process exit code is non-zero if any
 * MANDATORY gate fails. Optional gates (e.g. signed installer present)
 * print yellow and only fail the gate when --strict is passed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const isStrict = process.argv.includes('--strict');

// -----------------------------------------------------------------------------
// Tiny ANSI helpers — no chalk dependency, ASCII-safe on Windows PowerShell.
// -----------------------------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = useColor
  ? { g: s => `\x1b[32m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`,
      r: s => `\x1b[31m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` }
  : { g: s => s, y: s => s, r: s => s, b: s => s };

const results = [];
function record(name, severity, status, detail = '') {
  results.push({ name, severity, status, detail });
}

async function runStep(name, severity, runner) {
  process.stdout.write(`  > ${name} ... `);
  const t0 = Date.now();
  try {
    let detail = runner();
    if (detail && typeof detail.then === 'function') detail = await detail;
    const ms = Date.now() - t0;
    record(name, severity, 'PASS', detail || `${ms}ms`);
    process.stdout.write(c.g('PASS') + ` ${detail || `${ms}ms`}\n`);
  } catch (err) {
    const ms = Date.now() - t0;
    const message = (err && err.message) || String(err);
    record(name, severity, 'FAIL', `${message} (${ms}ms)`);
    process.stdout.write(c.r('FAIL') + ` ${message}\n`);
  }
}

function runShell(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: repoRoot, stdio: 'pipe', shell: process.platform === 'win32',
    ...opts,
  });
  if (r.status !== 0) {
    const stderr = (r.stderr || '').toString().trim().split('\n').slice(-3).join(' | ');
    const stdout = (r.stdout || '').toString().trim().split('\n').slice(-3).join(' | ');
    throw new Error(`${cmd} ${args.join(' ')} → exit ${r.status}: ${stderr || stdout}`);
  }
  return (r.stdout || '').toString();
}

// -----------------------------------------------------------------------------
// Gates
// -----------------------------------------------------------------------------

async function main() {
console.log(c.b('\nTransTrack — Release Readiness Check'));
console.log(`  repo:   ${repoRoot}`);
console.log(`  strict: ${isStrict}\n`);

// --- 1. Working tree state ---------------------------------------------------
await runStep('Git working tree clean', 'optional', () => {
  const out = runShell('git', ['status', '--porcelain']).trim();
  if (out.length > 0) throw new Error(`uncommitted changes: ${out.split('\n').length} file(s)`);
  return 'clean';
});

await runStep('package.json version present', 'mandatory', () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  if (!pkg.version) throw new Error('no version field');
  return `v${pkg.version}`;
});

// --- 2. Static analysis ------------------------------------------------------
await runStep('ESLint (lint --quiet)', 'mandatory', () => {
  runShell('npm', ['run', 'lint', '--silent']);
  return 'clean';
});

await runStep('TypeScript check (tsc --noEmit)', 'mandatory', () => {
  runShell('npx', ['tsc', '-p', 'jsconfig.json', '--noEmit']);
  return 'clean';
});

// --- 3. Dependency hygiene ---------------------------------------------------
await runStep('npm audit (production, moderate+)', 'mandatory', () => {
  runShell('npm', ['audit', '--omit=dev', '--audit-level=moderate']);
  return '0 vulnerabilities';
});

await runStep('Dependency lockfile committed', 'mandatory', () => {
  if (!existsSync(resolve(repoRoot, 'package-lock.json'))) {
    throw new Error('package-lock.json missing');
  }
  return 'present';
});

// --- 4. Test suites ----------------------------------------------------------
await runStep('Core unit & integration tests (npm test)', 'mandatory', () => {
  runShell('npm', ['test', '--silent']);
  return 'all passing';
});

// --- 5. Renderer build -------------------------------------------------------
await runStep('Renderer production build (vite)', 'mandatory', () => {
  runShell('npm', ['run', 'build', '--silent']);
  return 'built';
});

await runStep('Build output emitted to dist/', 'mandatory', () => {
  const dist = resolve(repoRoot, 'dist', 'index.html');
  if (!existsSync(dist)) throw new Error('dist/index.html not present');
  const size = statSync(dist).size;
  return `${size} bytes`;
});

// --- 6. Compliance artefact presence ----------------------------------------
const requiredCompliance = [
  'docs/compliance/VALIDATION_PLAN.md',
  'docs/compliance/SYSTEM_REQUIREMENTS_SPECIFICATION.md',
  'docs/compliance/SOFTWARE_DESIGN_SPECIFICATION.md',
  'docs/compliance/TRACEABILITY_MATRIX.md',
  'docs/compliance/RISK_REGISTER.md',
  'docs/compliance/HIPAA_SECURITY_RULE_MAPPING.md',
  'docs/compliance/PART_11_CONTROL_MAPPING.md',
  'docs/compliance/policies/BAA_TEMPLATE.md',
  'docs/compliance/HECVAT_PREFILL.md',
  'docs/CODE_SIGNING.md',
  'docs/ENVIRONMENT_VARIABLES.md',
  'docs/PILOT_DEPLOYMENT_RUNBOOK.md',
];
for (const rel of requiredCompliance) {
  await runStep(`Compliance artefact: ${rel}`, 'mandatory', () => {
    if (!existsSync(resolve(repoRoot, rel))) throw new Error('missing');
    return 'present';
  });
}

// --- 7. Inactivation Risk Engine — sanity check -----------------------------
await runStep('Inactivation Risk Engine — model self-test', 'mandatory', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const engine = require(resolve(repoRoot, 'electron/services/inactivationRiskEngine.cjs'));
  const a = engine.assessInactivationRisk({
    lastEvaluationDateISO: new Date(Date.now() - 360 * 86400e3).toISOString(),
    openBarriers: [{ riskLevel: 'high' }],
    ahhqStatus: 'expired',
  }, { nowMs: Date.now() });
  if (typeof a.score !== 'number') throw new Error('invalid score');
  if (!a.modelVersion) throw new Error('no model version');
  if (!Array.isArray(a.factorContributions)) throw new Error('no factor decomposition');
  return `model ${a.modelVersion}, score=${a.score}`;
});

// --- 7b. Action Queue — pure-function self-test -----------------------------
await runStep('Action Queue — pure-function self-test', 'mandatory', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const queueSvc = require(resolve(repoRoot, 'electron/services/inactivationActionQueue.cjs'));
  const r = queueSvc.buildActionQueue([
    { patientId: 'P1', lastEvaluationDateISO: new Date(Date.now() - 380 * 86400e3).toISOString(),
      openBarriers: [{ riskLevel: 'high' }] },
  ], { nowMs: Date.now() });
  if (!r.queue || r.queue.length !== 1) throw new Error('queue not produced');
  if (!r.queue[0].recommendedAction) throw new Error('no recommended action');
  return `queue v${r.queueVersion}, model v${r.modelVersion}`;
});

// --- 7c. Alert Rules — catalog completeness ---------------------------------
await runStep('Alert Rules engine — catalog completeness', 'mandatory', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const rules = require(resolve(repoRoot, 'electron/services/inactivationAlertRules.cjs'));
  const cat = rules.getRuleCatalog();
  const expected = new Set([
    'PATIENT_ENTERED_CRITICAL', 'EVAL_EXPIRED', 'EVAL_EXPIRING_SOON',
    'HIGH_BARRIER_OPENED', 'SCORE_JUMPED', 'CONTACT_LAPSED', 'AHHQ_EXPIRED',
  ]);
  const got = new Set(cat.map((r) => r.id));
  for (const id of expected) {
    if (!got.has(id)) throw new Error(`missing rule: ${id}`);
  }
  return `${cat.length} rules`;
});

// --- 7d. Health check — never throws + standard envelope --------------------
// (Skipped in this runner because healthCheck mocks `electron`; covered
//  comprehensively in tests/healthCheck.test.cjs which is included in the
//  npm test suite.)

// --- 8. Optional release gates (signed installer, etc.) ---------------------
await runStep('Code-signed Windows installer present (release/enterprise)', 'optional', () => {
  const dir = resolve(repoRoot, 'release', 'enterprise');
  if (!existsSync(dir)) throw new Error('release/enterprise/ not built');
  // Find any version of the installer; we don't pin to a specific version
  // here so the gate keeps working across version bumps.
  const files = readdirSync(dir).filter(
    (f) => /^TransTrack-Enterprise-\d+\.\d+\.\d+-x64\.exe$/.test(f),
  );
  if (files.length === 0) throw new Error('no installer .exe present');
  const newest = files
    .map((f) => ({ f, mtime: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  return `${newest.f} (${(statSync(resolve(dir, newest.f)).size / 1024 / 1024).toFixed(1)} MB)`;
});

await runStep('Windows code-signing configured (any supported mode)', 'optional', () => {
  const mode = (process.env.TRANSTRACK_SIGN_MODE || '').toLowerCase();
  if (mode === 'ssl_esigner') {
    for (const k of ['ESIGNER_USERNAME', 'ESIGNER_PASSWORD', 'ESIGNER_CREDENTIAL_ID',
                     'ESIGNER_TOTP_SECRET', 'ESIGNER_TOOL_PATH']) {
      if (!process.env[k]) throw new Error(`${k} not set`);
    }
    return 'ssl_esigner mode';
  }
  if (mode === 'pfx' || (process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD)) {
    if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD) {
      throw new Error('CSC_LINK / CSC_KEY_PASSWORD missing');
    }
    return 'pfx mode';
  }
  if (process.env.ESIGNER_USERNAME && process.env.ESIGNER_PASSWORD &&
      process.env.ESIGNER_CREDENTIAL_ID && process.env.ESIGNER_TOTP_SECRET &&
      process.env.ESIGNER_TOOL_PATH) {
    return 'ssl_esigner mode (auto-detected)';
  }
  throw new Error('no code-signing credentials in environment');
});

await runStep('macOS notarization configured (APPLE_* env vars)', 'optional', () => {
  for (const k of ['APPLE_ID', 'APPLE_APP_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!process.env[k]) throw new Error(`${k} not set`);
  }
  return 'configured';
});

await runStep('@electron/notarize installed (afterSign hook)', 'optional', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  try {
    require.resolve('@electron/notarize');
    return 'installed';
  } catch {
    throw new Error('@electron/notarize missing — npm install --save-dev @electron/notarize');
  }
});
} // end main()

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

await main();

const colWidth = Math.max(...results.map(r => r.name.length), 36);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

console.log('\n' + c.b('Summary'));
console.log('  ' + pad('Gate', colWidth) + '  Severity   Result   Detail');
console.log('  ' + '-'.repeat(colWidth + 30));
for (const r of results) {
  const colorFn = r.status === 'PASS' ? c.g
                 : (r.severity === 'mandatory' ? c.r : c.y);
  console.log(
    '  ' + pad(r.name, colWidth) +
    '  ' + pad(r.severity, 9) +
    '  ' + colorFn(pad(r.status, 6)) +
    '   ' + r.detail
  );
}

const mandatoryFails = results.filter(r => r.severity === 'mandatory' && r.status !== 'PASS');
const optionalFails  = results.filter(r => r.severity === 'optional'  && r.status !== 'PASS');

console.log('');
console.log(`  mandatory failures: ${mandatoryFails.length}`);
console.log(`  optional  failures: ${optionalFails.length}`);

if (mandatoryFails.length > 0) {
  console.log(c.r('\nRELEASE GATE: BLOCKED — mandatory failures present.\n'));
  process.exit(1);
}

if (isStrict && optionalFails.length > 0) {
  console.log(c.y('\nRELEASE GATE: STRICT MODE — optional failures present, exiting non-zero.\n'));
  process.exit(2);
}

console.log(c.g('\nRELEASE GATE: PASSED — build is releasable for first-customer pilot.'));
if (optionalFails.length > 0) {
  console.log(c.y('  (close the optional items before broad commercial release: code-sign + notarize.)'));
}
console.log('');
process.exit(0);
