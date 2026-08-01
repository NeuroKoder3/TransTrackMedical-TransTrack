/**
 * TransTrack — renderer-to-Electron bridge coverage.
 *
 * The bug this exists to prevent: `src/pages/DisasterRecovery.jsx` called
 * `api.recovery.createBackup()`, `verifyBackup()` and `restoreBackup()`. The
 * IPC handlers existed and `electron/preload.cjs` exposed all three, but
 * `createElectronClient()` in `src/api/localClient.js` only wired `getStatus`
 * and `listBackups`. So in the packaged desktop app the three methods were
 * `undefined` and every manual backup, verification and restore failed with a
 * TypeError surfaced as a toast. Backup and restore are HIPAA contingency
 * controls, so a silently broken button there is a compliance defect, not just
 * a UI bug.
 *
 * Nothing caught it because each layer was individually correct — only the
 * seam between them was wrong, and no test crossed that seam.
 *
 * This test crosses it: it finds every `api.<namespace>.<method>(` call in the
 * renderer and asserts the resolved desktop client actually provides that
 * method. It is deliberately a static scan of call sites rather than a curated
 * list of expected methods, because a curated list is precisely the thing that
 * goes stale.
 *
 * Run standalone: node tests/rendererBridgeCoverage.test.mjs
 */

import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'src');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

/** Recursively collect renderer source files. */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__snapshots__') continue;
      collectSources(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry) && !/\.test\.[jt]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Files that legitimately contain `api.` referring to something other than the
 * shared client (the client module itself, and the remote HTTP client).
 */
const NOT_CONSUMERS = new Set([
  join('src', 'api', 'localClient.js'),
  join('src', 'api', 'remoteClient.js'),
  join('src', 'api', 'client.js'),
  join('src', 'api', 'index.js'),
]);

/**
 * A file counts as a client consumer only if it imports the shared api client.
 * This keeps a local variable coincidentally named `api` in some unrelated
 * module from producing a false failure.
 */
function importsApiClient(text) {
  return /import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*['"][^'"]*api[^'"]*['"]/.test(text)
    || /from\s*['"]@\/api(\/[^'"]*)?['"]/.test(text);
}

const CALL_PATTERN = /\bapi\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;

const callSites = new Map(); // "ns.method" -> Set of "file:line"

for (const file of collectSources(srcRoot)) {
  const rel = relative(repoRoot, file);
  if (NOT_CONSUMERS.has(rel)) continue;

  const text = readFileSync(file, 'utf8');
  if (!importsApiClient(text)) continue;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(CALL_PATTERN)) {
      const key = `${m[1]}.${m[2]}`;
      if (!callSites.has(key)) callSites.set(key, new Set());
      callSites.get(key).add(`${rel.split(sep).join('/')}:${i + 1}`);
    }
  }
}

/**
 * Load the REAL preload surface rather than a hand-written stub.
 *
 * An auto-vivifying Proxy is not good enough here: `createElectronClient()`
 * builds some namespaces by enumerating `Object.keys(window.electronAPI.<ns>)`,
 * and a Proxy whose target starts empty enumerates to nothing, which produced
 * false "not wired" reports for methods that are in fact bridged. Using the
 * genuine preload object also means this test validates the real three-layer
 * seam (renderer → client → preload) instead of a fiction.
 *
 * `electron/preload.cjs` requires only the `electron` module and calls
 * `contextBridge.exposeInMainWorld`, so faking that one module is enough to
 * capture everything it exposes.
 */
function loadPreloadSurface() {
  const require_ = createRequire(import.meta.url);
  const electronPath = require_.resolve('electron');

  let exposed = null;
  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld: (_key, value) => { exposed = value; },
    },
    ipcRenderer: {
      invoke: async () => undefined,
      on: () => {},
      once: () => {},
      removeListener: () => {},
      removeAllListeners: () => {},
      send: () => {},
    },
  };

  const previous = require_.cache[electronPath];
  require_.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fakeElectron };
  try {
    delete require_.cache[require_.resolve('../electron/preload.cjs')];
    require_('../electron/preload.cjs');
  } finally {
    if (previous) require_.cache[electronPath] = previous;
    else delete require_.cache[electronPath];
  }

  if (!exposed) throw new Error('preload.cjs did not call contextBridge.exposeInMainWorld');
  return exposed;
}

const preloadSurface = loadPreloadSurface();

globalThis.window = { electronAPI: preloadSurface, location: { origin: 'app://' } };
if (typeof globalThis.navigator === 'undefined') globalThis.navigator = { onLine: true };

const { localClient } = await import('../src/api/localClient.js');

console.log('\nRenderer bridge coverage');

test('the renderer actually calls the api client (scan found call sites)', () => {
  assert.ok(
    callSites.size > 10,
    `expected to discover many api.<ns>.<method>() call sites, found ${callSites.size}. ` +
    'If the renderer was restructured, update this scan — a silently empty scan would ' +
    'make this whole suite vacuous.',
  );
});

test('the desktop client resolves to the Electron implementation', () => {
  // If this fails the stub is not being detected and every assertion below
  // would be checking the browser dev mock instead of the real bridge.
  assert.strictEqual(typeof localClient.recovery.createBackup, 'function');
});

test('every api.<namespace>.<method>() the renderer calls is wired in the desktop client', () => {
  const missing = [];

  for (const [key, sites] of [...callSites].sort()) {
    const [ns, method] = key.split('.');
    let namespace;
    try {
      namespace = localClient[ns];
    } catch (e) {
      missing.push(`api.${key} — namespace threw: ${e.message}`);
      continue;
    }
    if (!namespace || typeof namespace !== 'object') {
      missing.push(`api.${ns} is not exposed at all (needed by ${[...sites].join(', ')})`);
      continue;
    }
    if (typeof namespace[method] !== 'function') {
      missing.push(`api.${key} is not a function (called from ${[...sites].join(', ')})`);
    }
  }

  assert.deepStrictEqual(
    missing, [],
    `the renderer calls bridge methods the desktop client does not provide:\n  ${missing.join('\n  ')}\n\n` +
    'Wire them in createElectronClient() in src/api/localClient.js.',
  );
});

test('the preload exposes the disaster-recovery surface the client bridges to', () => {
  // The reverse direction of the same seam: the client can only forward to a
  // preload method that exists. A typo here would fail identically at runtime.
  for (const method of ['getStatus', 'listBackups', 'createBackup', 'verifyBackup', 'restoreBackup']) {
    assert.strictEqual(
      typeof preloadSurface.recovery?.[method], 'function',
      `electron/preload.cjs must expose recovery.${method}`,
    );
  }
});

test('the disaster-recovery mutations specifically are bridged', () => {
  // Called out explicitly because these are the HIPAA contingency controls and
  // the original regression: keep them locked down even if the scan changes.
  for (const method of ['getStatus', 'listBackups', 'createBackup', 'verifyBackup', 'restoreBackup']) {
    assert.strictEqual(
      typeof localClient.recovery[method], 'function',
      `api.recovery.${method} must be bridged to the desktop runtime`,
    );
  }
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
console.log(`(scanned ${callSites.size} distinct api.<ns>.<method>() call sites)\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.message}\n`);
  process.exit(1);
}
