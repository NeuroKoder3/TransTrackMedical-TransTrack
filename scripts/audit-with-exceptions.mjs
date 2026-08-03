#!/usr/bin/env node
/**
 * TransTrack — dependency vulnerability gate with documented exceptions.
 *
 * `npm audit` is pass/fail on the whole dependency tree, which leaves two bad
 * options when a finding is real but unreachable in this product: lower the
 * severity threshold (which also hides genuine findings), or take on an
 * unrelated major upgrade under release pressure. Neither is defensible to a
 * customer's security review.
 *
 * This gate adds the third option that enterprise vulnerability management
 * actually expects: an explicit, reviewed, expiring exception record, checked
 * mechanically. It is strictly stricter than plain `npm audit` in three ways:
 *
 *   • An exception covers exactly one advisory on one package. A new advisory
 *     on the same package, or a severity increase, is not covered and fails.
 *   • Every exception has a reviewBy date. Once it passes, the gate fails, so a
 *     decision cannot be silently inherited by a future release.
 *   • A stale exception — one that no longer matches any finding, e.g. because
 *     the dependency was patched — fails too, so the file cannot accumulate
 *     entries that quietly grant more latitude than anyone reviewed.
 *
 * Accepted findings are always printed. Nothing is suppressed from the report;
 * only the exit code is affected.
 *
 * This is the ONLY vulnerability allowlist in the repository. There used to be a
 * second one — a hardcoded `ALLOWED` set in scripts/production-audit.mjs, which
 * is what CI actually ran (finding M-19). Two allowlists drift, and the one on
 * the CI path was the one with no reviewBy expiry check, so an accepted
 * advisory could be inherited indefinitely without anyone re-deciding it. That
 * script has been removed and CI runs this gate.
 *
 * Each npm workspace in the repository is audited separately because they have
 * separate lockfiles. An exception declares which workspace it applies to via
 * its optional `scope` field ("root" by default); an exception written for one
 * workspace does not silently cover the other.
 *
 * Usage:
 *   node scripts/audit-with-exceptions.mjs
 *   node scripts/audit-with-exceptions.mjs --json      # machine-readable summary
 *   node scripts/audit-with-exceptions.mjs --severity=high
 *   node scripts/audit-with-exceptions.mjs --scope=server
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTIONS_PATH = resolve(repoRoot, 'security', 'vulnerability-exceptions.json');

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const severityArg = args.find((a) => a.startsWith('--severity='));
const scopeArg = args.find((a) => a.startsWith('--scope='));

/**
 * npm workspaces with their own lockfile, and therefore their own audit.
 * `dir` is relative to the repository root.
 */
const SCOPES = {
  root: { dir: '.', label: 'desktop application' },
  server: { dir: 'server', label: 'multi-tenant server' },
};

const DEFAULT_SCOPE = 'root';
const scope = scopeArg ? scopeArg.split('=')[1] : DEFAULT_SCOPE;
if (!SCOPES[scope]) {
  console.error(`\naudit-with-exceptions: unknown scope "${scope}". Known: ${Object.keys(SCOPES).join(', ')}\n`);
  process.exit(2);
}
const auditCwd = resolve(repoRoot, SCOPES[scope].dir);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR && !asJson;
const c = useColor
  ? { g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`,
      r: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` }
  : { g: (s) => s, y: (s) => s, r: (s) => s, b: (s) => s, d: (s) => s };

function atOrAbove(severity, threshold) {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(threshold);
}

/** Extract a GHSA identifier from an advisory URL. */
function advisoryIdFrom(via) {
  if (via && typeof via.url === 'string') {
    const m = via.url.match(/(GHSA-[a-z0-9-]+)/i);
    if (m) return m[1];
  }
  if (via && via.source != null) return String(via.source);
  return null;
}

// --- exceptions --------------------------------------------------------------

function loadExceptions() {
  if (!existsSync(EXCEPTIONS_PATH)) {
    return { severityThreshold: 'moderate', exceptions: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`security/vulnerability-exceptions.json is not valid JSON: ${err.message}`);
  }

  const REQUIRED = ['advisory', 'package', 'severity', 'status', 'justification', 'analysis', 'assessedBy', 'assessedOn', 'reviewBy'];
  const list = Array.isArray(parsed.exceptions) ? parsed.exceptions : [];

  list.forEach((e, i) => {
    const missing = REQUIRED.filter((k) => e[k] === undefined || e[k] === null || e[k] === '');
    if (missing.length > 0) {
      throw new Error(
        `exception #${i + 1} (${e.advisory || 'unnamed'}) is missing required field(s): ${missing.join(', ')}. ` +
        'An exception without a documented rationale, owner and review date is not reviewable.',
      );
    }
    if (!SEVERITY_ORDER.includes(e.severity)) {
      throw new Error(`exception ${e.advisory}: unknown severity "${e.severity}"`);
    }
    if (Number.isNaN(Date.parse(e.reviewBy))) {
      throw new Error(`exception ${e.advisory}: reviewBy "${e.reviewBy}" is not a parseable date`);
    }
    if (e.scope !== undefined && !SCOPES[e.scope]) {
      throw new Error(
        `exception ${e.advisory}: unknown scope "${e.scope}". Known: ${Object.keys(SCOPES).join(', ')}`,
      );
    }
  });

  return {
    severityThreshold: parsed.severityThreshold || 'moderate',
    // An entry without an explicit scope belongs to the desktop application,
    // which is what every entry meant before the server was audited by this
    // gate. Scoping is applied here so the decision logic below only ever sees
    // exceptions that could legitimately cover the workspace being audited.
    exceptions: list.filter((e) => (e.scope || DEFAULT_SCOPE) === scope),
  };
}

// --- npm audit ---------------------------------------------------------------

function runAudit() {
  const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: auditCwd, stdio: 'pipe', shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  });

  const stdout = (r.stdout || '').toString();
  // npm audit exits non-zero when findings exist, so a non-zero status is
  // expected and not itself an error. Unparseable output is the real failure.
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    const stderr = (r.stderr || '').toString().trim();
    throw new Error(`could not parse npm audit --json output. stderr: ${stderr.slice(0, 500)}`);
  }
  if (report.error) {
    throw new Error(`npm audit reported an error: ${report.error.summary || JSON.stringify(report.error)}`);
  }
  return report;
}

/**
 * Flatten the audit report into one entry per distinct advisory.
 *
 * npm nests findings: a package's `via` array holds advisory objects for direct
 * findings and plain package-name strings for packages that are only affected
 * transitively. Only the objects carry advisory identity, so those are the unit
 * of decision; the string entries are downstream effects of the same advisory.
 */
function collectFindings(report) {
  const byAdvisory = new Map();

  for (const vuln of Object.values(report.vulnerabilities || {})) {
    for (const via of vuln.via || []) {
      if (typeof via === 'string') continue;
      const id = advisoryIdFrom(via);
      if (!id) continue;

      if (!byAdvisory.has(id)) {
        byAdvisory.set(id, {
          advisory: id,
          package: via.name || vuln.name,
          title: via.title || '(no title)',
          severity: via.severity || vuln.severity || 'info',
          vulnerableRange: via.range || vuln.range || '',
          url: via.url || '',
          affectedPackages: new Set(),
        });
      }
      byAdvisory.get(id).affectedPackages.add(vuln.name);
    }
  }

  // Second pass: attribute transitively-affected packages. A package whose `via`
  // is the plain string "react-router" is affected by react-router's advisories
  // without restating them, so without this the report would understate blast
  // radius (react-router-dom would not be listed at all). Iterated to a fixed
  // point because these chains can be more than one level deep.
  const advisoriesOf = (pkgName) =>
    [...byAdvisory.values()].filter((f) => f.package === pkgName);

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 10) {
    changed = false;
    for (const vuln of Object.values(report.vulnerabilities || {})) {
      for (const via of vuln.via || []) {
        if (typeof via !== 'string') continue;
        for (const finding of advisoriesOf(via)) {
          if (!finding.affectedPackages.has(vuln.name)) {
            finding.affectedPackages.add(vuln.name);
            changed = true;
          }
        }
      }
    }
  }

  return [...byAdvisory.values()].map((f) => ({
    ...f,
    affectedPackages: [...f.affectedPackages].sort(),
  }));
}

// --- main --------------------------------------------------------------------

function main() {
  const { severityThreshold: fileThreshold, exceptions } = loadExceptions();
  const threshold = severityArg ? severityArg.split('=')[1] : fileThreshold;
  if (!SEVERITY_ORDER.includes(threshold)) {
    throw new Error(`unknown severity threshold "${threshold}"`);
  }

  const report = runAudit();
  const allFindings = collectFindings(report);
  const findings = allFindings.filter((f) => atOrAbove(f.severity, threshold));

  const today = new Date();
  const accepted = [];
  const unresolved = [];
  const expired = [];
  const matchedAdvisories = new Set();

  for (const finding of findings) {
    const exception = exceptions.find(
      (e) => e.advisory === finding.advisory && e.package === finding.package,
    );

    if (!exception) {
      unresolved.push(finding);
      continue;
    }

    matchedAdvisories.add(exception.advisory);

    // A severity increase since the assessment invalidates it: the decision was
    // made about a less serious issue than the one now reported.
    if (SEVERITY_ORDER.indexOf(finding.severity) > SEVERITY_ORDER.indexOf(exception.severity)) {
      unresolved.push({
        ...finding,
        note: `severity increased from "${exception.severity}" at assessment to "${finding.severity}"; the exception no longer covers it`,
      });
      continue;
    }

    if (new Date(exception.reviewBy) < today) {
      expired.push({ finding, exception });
      continue;
    }

    accepted.push({ finding, exception });
  }

  // An exception matching nothing means the dependency was fixed or removed.
  const stale = exceptions.filter((e) => !matchedAdvisories.has(e.advisory));

  const summary = {
    scope,
    threshold,
    totalFindings: allFindings.length,
    atOrAboveThreshold: findings.length,
    accepted: accepted.length,
    unresolved: unresolved.length,
    expired: expired.length,
    stale: stale.length,
    ok: unresolved.length === 0 && expired.length === 0 && stale.length === 0,
  };

  if (asJson) {
    console.log(JSON.stringify({
      ...summary,
      acceptedItems: accepted.map(({ finding, exception }) => ({
        advisory: finding.advisory, package: finding.package,
        severity: finding.severity, status: exception.status,
        justification: exception.justification, reviewBy: exception.reviewBy,
      })),
      unresolvedItems: unresolved,
      expiredItems: expired.map(({ finding, exception }) => ({
        advisory: finding.advisory, reviewBy: exception.reviewBy,
      })),
      staleItems: stale.map((e) => ({ advisory: e.advisory, package: e.package })),
    }, null, 2));
    process.exit(summary.ok ? 0 : 1);
  }

  console.log(c.b('\nDependency vulnerability gate (production dependencies)'));
  console.log(`  scope: ${scope} — ${SCOPES[scope].label} (${SCOPES[scope].dir})`);
  console.log(`  severity threshold: ${threshold}`);
  console.log(`  findings at/above threshold: ${findings.length}\n`);

  for (const { finding, exception } of accepted) {
    console.log(`  ${c.y('ACCEPTED')} ${finding.advisory}  ${finding.package}  (${finding.severity})`);
    console.log(c.d(`      ${finding.title}`));
    console.log(c.d(`      ${exception.status} / ${exception.justification} — review by ${exception.reviewBy}`));
    console.log(c.d(`      affects: ${finding.affectedPackages.join(', ')}`));
  }

  for (const finding of unresolved) {
    console.log(`  ${c.r('UNRESOLVED')} ${finding.advisory}  ${finding.package}  (${finding.severity})`);
    console.log(c.d(`      ${finding.title}`));
    if (finding.note) console.log(c.d(`      ${finding.note}`));
    if (finding.url) console.log(c.d(`      ${finding.url}`));
  }

  for (const { finding, exception } of expired) {
    console.log(`  ${c.r('EXPIRED')} ${finding.advisory}  ${finding.package}`);
    console.log(c.d(`      exception lapsed on ${exception.reviewBy} — re-assess and update security/vulnerability-exceptions.json`));
  }

  for (const e of stale) {
    console.log(`  ${c.r('STALE')} ${e.advisory}  ${e.package}`);
    console.log(c.d('      no longer reported by npm audit — remove this exception'));
  }

  console.log('');
  if (summary.ok) {
    const suffix = accepted.length > 0 ? ` (${accepted.length} documented exception(s))` : '';
    console.log(c.g(`PASS — no unresolved vulnerabilities at ${threshold}+ in scope "${scope}"${suffix}`));
    process.exit(0);
  }

  const reasons = [];
  if (unresolved.length) reasons.push(`${unresolved.length} unresolved`);
  if (expired.length) reasons.push(`${expired.length} expired exception(s)`);
  if (stale.length) reasons.push(`${stale.length} stale exception(s)`);
  console.log(c.r(`FAIL — ${reasons.join(', ')}`));
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`\naudit-with-exceptions: ${err.message}\n`);
  process.exit(2);
}
