/**
 * Production npm audit gate with allowlisted advisories.
 *
 * GHSA-qwww-vcr4-c8h2 — patched in react-router-dom >=7.18.2 (backport via
 * remix-run/react-router#15353). The fix only affects unstable RSC APIs;
 * TransTrack uses Declarative Mode (HashRouter) in an Electron SPA and does
 * not enable RSC. The allowlist entry remains until the GHSA database range
 * update propagates to npm. See:
 *   https://github.com/remix-run/react-router/security/advisories/GHSA-qwww-vcr4-c8h2
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const ALLOWED = new Set([
  'GHSA-qwww-vcr4-c8h2',
]);

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 20 * 1024 * 1024,
});

const stdout = result.stdout || '';
let report;
try {
  report = JSON.parse(stdout);
} catch {
  console.error('npm audit failed and did not return JSON');
  if (stdout) console.error(stdout.slice(0, 2000));
  if (result.stderr) console.error(result.stderr.slice(0, 2000));
  process.exit(1);
}

if (!report.vulnerabilities || Object.keys(report.vulnerabilities).length === 0) {
  console.log('npm audit: no production vulnerabilities');
  process.exit(0);
}

const blocking = [];

for (const [name, info] of Object.entries(report.vulnerabilities)) {
  const via = Array.isArray(info.via) ? info.via : [];
  for (const entry of via) {
    if (typeof entry !== 'object' || entry === null) continue;
    const sev = String(entry.severity || '').toLowerCase();
    if (sev !== 'high' && sev !== 'critical') continue;
    const url = entry.url || '';
    const ghsa = (url.match(/GHSA-[\w-]+/) || [])[0] || '';
    if (ghsa && ALLOWED.has(ghsa)) {
      console.log(`allowlisted: ${ghsa} (${name})`);
      continue;
    }
    blocking.push({
      name,
      severity: entry.severity,
      title: entry.title,
      url,
      ghsa,
    });
  }
}

if (blocking.length) {
  console.error('Blocking production audit findings:');
  for (const b of blocking) {
    console.error(`- [${b.severity}] ${b.name}: ${b.title} ${b.url || b.ghsa}`);
  }
  process.exit(1);
}

console.log('npm audit: no blocking production vulnerabilities (allowlist applied)');
process.exit(0);
