/**
 * TransTrack — source entry integrity.
 *
 * The bug this exists to prevent: the repository's source `index.html` was
 * overwritten with the *built* `dist/index.html`. The built file references
 * hashed bundles (`./assets/index-CiEKGgNG.js`) instead of the source entry
 * module (`/src/main.jsx`), so `vite build` failed with
 *
 *     Error: Failed to resolve ./assets/index-CiEKGgNG.js from index.html
 *
 * which meant the product could not be built for distribution at all. It is an
 * easy mistake to repeat — copying `dist/index.html` back over the source, or
 * committing after inspecting a build output directory — and the failure appears
 * as an obscure resolve error rather than "you clobbered the entry point".
 *
 * This check is intentionally independent of running a build: it is fast enough
 * to sit in the normal unit-test group and fails with a message that names the
 * actual cause.
 *
 * Run standalone: node tests/buildEntryIntegrity.test.mjs
 */

import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtmlPath = join(repoRoot, 'index.html');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('\nSource entry integrity');

const html = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, 'utf8') : null;

test('the Vite entry index.html exists at the repo root', () => {
  assert.ok(html !== null, 'index.html is missing from the repository root');
});

test('index.html loads the source entry module, not a built bundle', () => {
  assert.match(
    html,
    /<script[^>]+src=["']\/src\/main\.jsx["']/,
    'index.html must load /src/main.jsx. If this fails, index.html was probably '
    + 'overwritten with dist/index.html — restore it with: git checkout HEAD -- index.html',
  );
});

test('index.html contains no hashed build-output references', () => {
  // A hashed asset name (index-CiEKGgNG.js) only ever appears in build output.
  const hashed = [...html.matchAll(/["'][^"']*\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.(?:js|css)["']/g)]
    .map((m) => m[0]);
  assert.deepStrictEqual(
    hashed, [],
    'index.html references hashed build artefacts, so it is a build output rather than the source '
    + `entry: ${hashed.join(', ')}. Restore with: git checkout HEAD -- index.html`,
  );
});

test('index.html declares no modulepreload links', () => {
  // Vite injects modulepreload into the *output*; their presence in the source
  // entry is another fingerprint of a clobbered file.
  assert.ok(
    !/rel=["']modulepreload["']/.test(html),
    'index.html contains <link rel="modulepreload">, which Vite only emits into build output',
  );
});

test('index.html still carries the Content-Security-Policy meta tag', () => {
  // Guards the opposite mistake: restoring the entry but dropping the CSP that
  // the packaged app relies on as a second layer behind the main-process header.
  assert.match(
    html,
    /http-equiv=["']Content-Security-Policy["']/,
    'the CSP meta tag must remain in index.html',
  );
  assert.match(html, /object-src 'none'/, "CSP must keep object-src 'none'");
  assert.match(html, /frame-ancestors 'none'/, "CSP must keep frame-ancestors 'none'");
});

test('the referenced entry module actually exists on disk', () => {
  assert.ok(
    existsSync(join(repoRoot, 'src', 'main.jsx')),
    'src/main.jsx is referenced by index.html but does not exist',
  );
});

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.message}\n`);
  process.exit(1);
}
