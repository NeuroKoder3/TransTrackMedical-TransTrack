#!/usr/bin/env node
/**
 * TransTrack — committed-secret scanner.
 *
 * .gitignore has referenced `gitleaks-report.json` since the repository was
 * created, but no secret-scanning job ever existed (finding M-18): a private
 * key, a database URL with a password, or a signing credential could be
 * committed and nothing would notice.
 *
 * This is deliberately a committed script rather than a third-party action:
 *   • it runs identically in CI, in a pre-commit hook, and on a workstation,
 *     with no network access and no marketplace action to pin or trust;
 *   • it cannot silently no-op. `--self-test` scans a set of synthetic secrets
 *     that every rule must detect and fails if any rule has stopped matching,
 *     so a scanner that has been broken or gutted fails the build instead of
 *     reporting a clean tree. CI runs the self-test before the real scan.
 *
 * Exceptions live in security/secret-scan-allowlist.json and carry the same
 * discipline as the vulnerability exceptions: a justification, an owner, and a
 * reviewBy date after which the build fails again. An allowlist entry that no
 * longer matches anything is reported as stale, so the file cannot accumulate
 * blanket permissions.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs                 # tracked working tree
 *   node scripts/scan-secrets.mjs --history       # every blob reachable from any ref
 *   node scripts/scan-secrets.mjs --self-test     # prove the rules still fire
 *   node scripts/scan-secrets.mjs --json
 *   node scripts/scan-secrets.mjs --report=<path> # write a JSON report
 *
 * Exit codes: 0 clean · 1 findings · 2 configuration or self-test failure.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = resolve(repoRoot, 'security', 'secret-scan-allowlist.json');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const selfTestOnly = args.includes('--self-test');
const scanHistory = args.includes('--history');
const reportArg = args.find((a) => a.startsWith('--report='));

const useColor = process.stdout.isTTY && !process.env.NO_COLOR && !asJson;
const c = useColor
  ? { g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`,
      r: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` }
  : { g: (s) => s, y: (s) => s, r: (s) => s, b: (s) => s, d: (s) => s };

// ---------------------------------------------------------------------------
// Rules
//
// Every rule needs a `sample` that it must match and that no other rule may
// need; --self-test asserts on those, which is what stops a rule from being
// quietly weakened into never matching. `severity: 'critical'` marks a match
// that is a credential on its face, as opposed to a pattern that needs the
// value to look random before it means anything.
// ---------------------------------------------------------------------------

/** Shannon entropy in bits per character. */
function entropy(value) {
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Values that look like a secret's shape but are documentation, a template, or
 * a deliberate test fixture. Kept narrow: anything rejected here is a real
 * secret this scanner would miss.
 */
const PLACEHOLDER_PATTERNS = [
  /^\s*$/,
  /\$\{/,                       // ${VAR} interpolation
  /\$\(/,                       // $(openssl rand -hex 16) in a shell snippet
  /process\.env/,
  // A documentation table or connection-string example spelling out the role of
  // each component rather than a value.
  /^(?:user|username|pass|password|secret|token|key|apikey|api_key|host|hostname|db|dbname|database)$/i,
  /^<.*>$/,                     // <your-token-here>
  /^\.\.\.$/,
  /\bxxx+\b/i,
  /\*{3,}/,
  /^0+$/,
  /^(?:changeme|placeholder|redacted|example|sample|dummy|unset|none|null|undefined|todo|tbd)$/i,
  // Substring, not word-bounded: templates are written as REPLACE_ME_WITH_YOUR_KEY
  // and MY-SECRET-HERE, where the surrounding underscores defeat \b.
  /(?:your|my)[-_]?(?:secret|password|token|key|api[-_]?key)/i,
  /(?:example|sample|dummy|fake|placeholder|redacted|changeme|replace[-_]?(?:me|with)|test[-_]?only|not[-_]?a[-_]?real|do[-_]?not[-_]?use)/i,
  /^\[REDACTED\]$/,
  /^(.)\1+$/,                   // aaaaaaaa
];

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(value));
}

const SECRET_WORD = '(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|encryption[_-]?key|signing[_-]?key|jwt[_-]?secret)';

/**
 * Test suites are full of literals that look exactly like credentials because
 * that is what they are for: a password strong enough to pass validation, a
 * signing key long enough to be accepted. The two heuristic rules below — which
 * fire on "a secret-named field holds a random-looking string" rather than on a
 * recognisable credential format — are not applied to them.
 *
 * This scoping is deliberately limited to the heuristic rules. Every rule that
 * matches a real provider's credential format (AWS, GitHub, Slack, Stripe,
 * Google, npm, Azure, a PEM private key, a PKCS#12 store, a non-loopback
 * database URL) still applies to test files, because none of those has any
 * business being in one.
 */
const TEST_FIXTURE_PATHS = [
  /(?:^|\/)tests?\//,
  /(?:^|\/)__tests__\//,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)sample-data\//,
  /(?:^|\/)demo-evidence\//,
];

/**
 * Every rule below carries a `sample` that --self-test scans, which is how a
 * rule that has stopped matching is caught. Those samples are assembled from
 * fragments rather than written as literals: a file containing a well-formed
 * Slack token or Stripe key is rejected by GitHub's own push protection, so a
 * literal sample would make this scanner unpushable. Assembling at runtime keeps
 * the self-test scanning the exact string the rule is meant to catch.
 */
const RULES = [
  {
    id: 'private-key-block',
    description: 'PEM private key block',
    severity: 'critical',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
    sample: `-----${'BEGIN'} RSA ${'PRIVATE KEY'}-----`,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key id',
    severity: 'critical',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    sample: 'AKIAIOSFODNN7EXAMPLE'.replace('EXAMPLE', 'QQQQQQQ'),
  },
  {
    id: 'github-token',
    description: 'GitHub personal access / app token',
    severity: 'critical',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
    sample: `ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`,
  },
  {
    id: 'slack-token',
    description: 'Slack API token',
    severity: 'critical',
    pattern: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}\b/,
    sample: ['xoxb', '123456789012', 'abcdefghijklmnop'].join('-'),
  },
  {
    id: 'slack-webhook',
    description: 'Slack incoming webhook URL',
    severity: 'critical',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]+/,
    sample: `https://hooks.slack.com/services/${'T'}00000000/${'B'}00000000/abcdefghijklmnopqrstuvwx`,
  },
  {
    id: 'stripe-key',
    description: 'Stripe secret or restricted key',
    severity: 'critical',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/,
    sample: ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_'),
  },
  {
    id: 'google-api-key',
    description: 'Google API key',
    severity: 'critical',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    sample: `AIza${'Sy'}${'a'.repeat(33)}`,
  },
  {
    id: 'npm-token',
    description: 'npm publish token',
    severity: 'critical',
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
    sample: `npm_${'z'.repeat(36)}`,
  },
  {
    id: 'azure-storage-key',
    description: 'Azure storage account key',
    severity: 'critical',
    pattern: /AccountKey=[A-Za-z0-9+/]{60,}={0,2}/,
    sample: `AccountKey=${'A'.repeat(86)}==`,
  },
  {
    id: 'jwt',
    description: 'signed JWT',
    severity: 'high',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}/,
    sample: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.'),
  },
  {
    id: 'db-url-with-password',
    description: 'database or broker URL carrying an inline password',
    severity: 'critical',
    // Captures user, password and host so a placeholder or a loopback
    // development default can be discounted.
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|amqps?|rediss?|mssql):\/\/([^\s'":/@]+):([^\s'"@/]{4,})@([^\s'"/:]+)/,
    sample: `postgres://svc:${'Hunter2'.repeat(2)}@db.internal:5432/prod`,
    valueFromGroup: 2,
    // `postgres://transtrack:transtrack@localhost` is the documented local
    // development connection string, not a credential: it grants nothing that
    // is not already reachable from the developer's own machine. A password
    // that differs from the username, or a non-loopback host, is a real finding.
    filter: (m) => {
      const [, user, password, host] = m;
      const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|postgres|db)$/i.test(host);
      return !(loopback && password === user);
    },
  },
  {
    id: 'pkcs12-material',
    description: 'PKCS#12 / PFX certificate store committed to the tree',
    severity: 'critical',
    // Path-based rather than content-based; see scanPath().
    pathPattern: /\.(?:pfx|p12|jks|keystore)$/i,
    sample: null,
  },
  {
    id: 'high-entropy-secret-assignment',
    description: 'secret-named field assigned a high-entropy literal',
    severity: 'high',
    pattern: new RegExp(`${SECRET_WORD}["']?\\s*[:=]\\s*["']([^"'\\n]{12,120})["']`, 'i'),
    sample: `const ${'api'}${'Key'} = 'kJ8vQ2mZ4pR7tY1wA6sD9fG3hL5nB0xC'`,
    valueFromGroup: 1,
    requireEntropy: 3.2,
    skipPaths: TEST_FIXTURE_PATHS,
  },
  {
    id: 'hardcoded-bearer-token',
    description: 'Authorization header with a literal bearer token',
    severity: 'high',
    pattern: /authorization["']?\s*[:=]\s*["']\s*(?:Bearer|Basic)\s+([A-Za-z0-9._\-+/=]{16,})["']/i,
    sample: `headers: { authorization: '${'Bearer'} aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL' }`,
    valueFromGroup: 1,
    requireEntropy: 3.0,
    skipPaths: TEST_FIXTURE_PATHS,
  },
];

// Path-scoped rules do not need a text body; keep them separate so the file
// walk does not have to read the contents of a 4 MB keystore to reject it.
const PATH_RULES = RULES.filter((r) => r.pathPattern);
const CONTENT_RULES = RULES.filter((r) => r.pattern);

// ---------------------------------------------------------------------------
// What to scan
// ---------------------------------------------------------------------------

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.svg',
  '.pdf', '.zip', '.gz', '.tgz', '.7z', '.exe', '.dll', '.so', '.dylib',
  '.node', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.wav',
  '.db', '.sqlite', '.sqlite3', '.asar', '.blockmap',
]);

/**
 * Paths whose *contents* are excluded from content rules.
 *
 * This scanner's own rule table necessarily contains one sample per rule, and
 * the allowlist file necessarily quotes what it is allowing. Both are still
 * scanned by the path rules, and both are covered by --self-test, which is what
 * proves the rules work. Nothing else is excluded by path: an exclusion here is
 * a place a real secret could hide, so it is not a knob for silencing findings.
 */
const CONTENT_SCAN_EXCLUSIONS = [
  'scripts/scan-secrets.mjs',
  'security/secret-scan-allowlist.json',
];

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function git(argv, opts = {}) {
  const r = spawnSync('git', argv, {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`git ${argv.slice(0, 3).join(' ')} failed: ${(r.stderr || '').trim().slice(0, 300)}`);
  }
  return r.stdout;
}

/** Tracked files in the working tree. */
function trackedFiles() {
  return git(['ls-files', '-z']).split('\0').filter(Boolean);
}

/**
 * Every distinct blob reachable from any ref, with a path it was stored under.
 * A secret that was committed and then deleted is still in the history and
 * still has to be rotated, so `--history` is what a real audit needs.
 */
function historyBlobs() {
  const out = git(['rev-list', '--objects', '--all']);
  const blobs = new Map();
  for (const line of out.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp === -1) continue;
    const sha = line.slice(0, sp);
    const path = line.slice(sp + 1).trim();
    if (!path || blobs.has(sha)) continue;
    blobs.set(sha, path);
  }
  return blobs;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

const ALLOWLIST_REQUIRED = ['rule', 'path', 'justification', 'assessedBy', 'assessedOn', 'reviewBy'];
const ALLOWLIST_MODES = ['any', 'working-tree', 'history'];

/**
 * Load the allowlist entries that could apply to the scan mode in force.
 *
 * `mode` matters because history is immutable: a credential that was committed
 * in 2026 and has since been rotated and removed from HEAD cannot be deleted
 * from the object database without rewriting every downstream clone, so it needs
 * a recorded decision. Such an entry is scoped to `history` so it cannot also
 * silence a fresh secret appearing at the same path in the working tree — which
 * is exactly the mistake a path-based allowlist invites.
 */
function loadAllowlist(mode) {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`security/secret-scan-allowlist.json is not valid JSON: ${err.message}`);
  }
  const list = Array.isArray(parsed.allowed) ? parsed.allowed : [];
  const ruleIds = new Set(RULES.map((r) => r.id));

  list.forEach((e, i) => {
    const missing = ALLOWLIST_REQUIRED.filter((k) => !e[k]);
    if (missing.length > 0) {
      throw new Error(
        `allowlist entry #${i + 1} is missing required field(s): ${missing.join(', ')}. ` +
        'An entry without a rationale, an owner and a review date is not reviewable.',
      );
    }
    if (!ruleIds.has(e.rule)) {
      throw new Error(`allowlist entry #${i + 1} names unknown rule "${e.rule}"`);
    }
    if (Number.isNaN(Date.parse(e.reviewBy))) {
      throw new Error(`allowlist entry #${i + 1}: reviewBy "${e.reviewBy}" is not a parseable date`);
    }
    if (e.mode !== undefined && !ALLOWLIST_MODES.includes(e.mode)) {
      throw new Error(
        `allowlist entry #${i + 1}: unknown mode "${e.mode}". Known: ${ALLOWLIST_MODES.join(', ')}`,
      );
    }
  });

  return list.filter((e) => {
    const entryMode = e.mode || 'any';
    return entryMode === 'any' || entryMode === mode;
  });
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Never print the secret itself; a CI log is not a safe place for it. */
function fingerprint(value) {
  const head = value.slice(0, 3);
  return `${head}…${value.length} chars`;
}

function scanPath(path) {
  const findings = [];
  for (const rule of PATH_RULES) {
    if (rule.pathPattern.test(path)) {
      findings.push({ rule: rule.id, description: rule.description, severity: rule.severity, path, line: 0, evidence: `file extension ${extname(path)}` });
    }
  }
  return findings;
}

function scanText(path, text) {
  const findings = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue; // minified bundle or embedded data blob

    for (const rule of CONTENT_RULES) {
      if (rule.skipPaths && rule.skipPaths.some((re) => re.test(path))) continue;

      const m = rule.pattern.exec(line);
      if (!m) continue;
      if (rule.filter && !rule.filter(m)) continue;

      const value = rule.valueFromGroup ? m[rule.valueFromGroup] : m[0];
      if (rule.valueFromGroup) {
        if (isPlaceholder(value)) continue;
        if (rule.requireEntropy && entropy(value) < rule.requireEntropy) continue;
      }

      findings.push({
        rule: rule.id,
        description: rule.description,
        severity: rule.severity,
        path,
        line: i + 1,
        evidence: fingerprint(value),
      });
    }
  }
  return findings;
}

function scanWorkingTree() {
  const findings = [];
  let scanned = 0;

  for (const path of trackedFiles()) {
    findings.push(...scanPath(path));

    if (SKIP_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    if (CONTENT_SCAN_EXCLUSIONS.includes(path)) continue;

    const abs = resolve(repoRoot, path);
    if (!existsSync(abs)) continue;

    let buf;
    try {
      buf = readFileSync(abs);
    } catch {
      continue;
    }
    if (buf.length > MAX_FILE_BYTES || looksBinary(buf)) continue;

    scanned++;
    findings.push(...scanText(path, buf.toString('utf8')));
  }
  return { findings, scanned };
}

function scanFullHistory() {
  const findings = [];
  const blobs = historyBlobs();
  let scanned = 0;

  for (const [sha, path] of blobs) {
    findings.push(...scanPath(path));

    if (SKIP_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    if (CONTENT_SCAN_EXCLUSIONS.includes(path)) continue;

    const r = spawnSync('git', ['cat-file', '-p', sha], {
      cwd: repoRoot, maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0 || !r.stdout) continue;
    if (r.stdout.length > MAX_FILE_BYTES || looksBinary(r.stdout)) continue;

    scanned++;
    findings.push(...scanText(`${path} (blob ${sha.slice(0, 10)})`, r.stdout.toString('utf8')));
  }
  return { findings, scanned };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * Prove every rule still fires, and that the placeholder filter still lets an
 * obvious template through. A scanner that reports a clean tree because its
 * rules no longer match is worse than no scanner at all, so this runs first in
 * CI and its failure is a build failure.
 */
function selfTest() {
  const problems = [];

  for (const rule of RULES) {
    if (rule.pathPattern) {
      const probe = `secrets/site.${rule.pathPattern.source.match(/[a-z0-9]{2,}/i)?.[0] || 'pfx'}`;
      const hits = scanPath('secrets/site.pfx').map((f) => f.rule);
      if (!hits.includes(rule.id)) {
        problems.push(`rule "${rule.id}" did not match its path sample (${probe})`);
      }
      continue;
    }
    const hits = scanText('self-test', rule.sample).map((f) => f.rule);
    if (!hits.includes(rule.id)) {
      problems.push(`rule "${rule.id}" no longer matches its own sample — the rule is dead`);
    }
  }

  // The placeholder filter must not be so permissive that a real credential is
  // discounted, nor so strict that documentation is reported forever.
  const templates = [
    "const apiKey = process.env.API_KEY",
    'DATABASE_URL=postgres://user:<your-password>@localhost:5432/db',
    "password: 'changeme'",
    "api_key = 'REPLACE_ME_WITH_YOUR_KEY'",
  ];
  for (const t of templates) {
    const hits = scanText('self-test', t);
    if (hits.length > 0) {
      problems.push(`placeholder "${t}" was reported as a secret by ${hits.map((h) => h.rule).join(', ')}`);
    }
  }

  // And the counter-case: a genuine credential in the same shape must be found.
  const realish = "const apiKey = 'kJ8vQ2mZ4pR7tY1wA6sD9fG3hL5nB0xC'";
  if (scanText('src/api/client.js', realish).length === 0) {
    problems.push('a high-entropy secret assignment was not detected in application code');
  }

  // The test-fixture scoping must apply to the heuristic rules and to nothing
  // else, or it becomes a place to hide a real credential.
  if (scanText('tests/example.test.cjs', realish).length !== 0) {
    problems.push('the heuristic rule fired inside a test fixture — the scoping is not applied');
  }
  const providerCredentialInTest = `const token = 'ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}'`;
  if (scanText('tests/example.test.cjs', providerCredentialInTest).length === 0) {
    problems.push('a provider credential inside a test file was not reported — the scoping is too broad');
  }

  // The loopback development connection string is not a credential; a
  // non-loopback one, or a loopback one with a distinct password, is.
  if (scanText('self-test', 'postgres://transtrack:transtrack@localhost:5432/transtrack').length !== 0) {
    problems.push('the documented loopback development URL was reported as a secret');
  }
  if (scanText('self-test', 'postgres://transtrack:R7wQ2kL9pM4x@localhost:5432/transtrack').length === 0) {
    problems.push('a real password on a loopback database URL was not reported');
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const selfTestProblems = selfTest();
  if (selfTestProblems.length > 0) {
    console.error(c.r('\nsecret scanner SELF-TEST FAILED — the rules below are not working:'));
    for (const p of selfTestProblems) console.error(`  - ${p}`);
    console.error('\nRefusing to report on the repository with a scanner that cannot detect its own samples.\n');
    process.exit(2);
  }

  if (selfTestOnly) {
    console.log(c.g(`secret scanner self-test passed — ${RULES.length} rules active`));
    process.exit(0);
  }

  const mode = scanHistory ? 'history' : 'working-tree';
  const allowlist = loadAllowlist(mode);
  const { findings: raw, scanned } = scanHistory ? scanFullHistory() : scanWorkingTree();

  const today = new Date();
  const blocking = [];
  const accepted = [];
  const expired = [];
  const matched = new Set();

  for (const f of raw) {
    const entry = allowlist.find(
      (e) => e.rule === f.rule && (f.path === e.path || f.path.startsWith(`${e.path} `)),
    );
    if (!entry) {
      blocking.push(f);
      continue;
    }
    matched.add(`${entry.rule}|${entry.path}`);
    if (new Date(entry.reviewBy) < today) {
      expired.push({ finding: f, entry });
      continue;
    }
    accepted.push({ finding: f, entry });
  }

  const stale = allowlist.filter((e) => !matched.has(`${e.rule}|${e.path}`));

  const summary = {
    mode,
    filesScanned: scanned,
    rules: RULES.length,
    blocking: blocking.length,
    accepted: accepted.length,
    expired: expired.length,
    stale: stale.length,
    ok: blocking.length === 0 && expired.length === 0 && stale.length === 0,
  };

  const report = {
    ...summary,
    generatedAt: new Date().toISOString(),
    blockingItems: blocking,
    acceptedItems: accepted.map(({ finding, entry }) => ({ ...finding, justification: entry.justification, reviewBy: entry.reviewBy })),
    expiredItems: expired.map(({ finding, entry }) => ({ ...finding, reviewBy: entry.reviewBy })),
    staleItems: stale,
  };

  if (reportArg) {
    const out = resolve(process.cwd(), reportArg.split('=').slice(1).join('='));
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (!asJson) console.log(c.d(`  report written to ${relative(process.cwd(), out) || out}`));
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(summary.ok ? 0 : 1);
  }

  console.log(c.b('\nCommitted-secret scan'));
  console.log(`  mode:          ${summary.mode}`);
  console.log(`  files scanned: ${summary.filesScanned}`);
  console.log(`  rules active:  ${summary.rules}\n`);

  for (const f of blocking) {
    console.log(`  ${c.r('SECRET')} [${f.severity}] ${f.rule}  ${f.path}:${f.line}`);
    console.log(c.d(`      ${f.description} — ${f.evidence}`));
  }
  for (const { finding, entry } of accepted) {
    console.log(`  ${c.y('ALLOWED')} ${finding.rule}  ${finding.path}:${finding.line}`);
    console.log(c.d(`      ${entry.justification} — review by ${entry.reviewBy}`));
  }
  for (const { finding, entry } of expired) {
    console.log(`  ${c.r('EXPIRED')} ${finding.rule}  ${finding.path}:${finding.line}`);
    console.log(c.d(`      allowlist entry lapsed on ${entry.reviewBy} — re-assess it`));
  }
  for (const e of stale) {
    console.log(`  ${c.r('STALE')} ${e.rule}  ${e.path}`);
    console.log(c.d('      no longer matches anything — remove this allowlist entry'));
  }

  console.log('');
  if (summary.ok) {
    const suffix = accepted.length > 0 ? ` (${accepted.length} documented exception(s))` : '';
    console.log(c.g(`PASS — no committed secrets detected${suffix}`));
    process.exit(0);
  }

  const reasons = [];
  if (blocking.length) reasons.push(`${blocking.length} secret(s)`);
  if (expired.length) reasons.push(`${expired.length} expired exception(s)`);
  if (stale.length) reasons.push(`${stale.length} stale exception(s)`);
  console.log(c.r(`FAIL — ${reasons.join(', ')}`));
  console.log('  A detected credential must be treated as compromised: rotate it, then remove it');
  console.log('  from the tree (and from history if it was ever pushed).');
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`\nscan-secrets: ${err.message}\n`);
  process.exit(2);
}
