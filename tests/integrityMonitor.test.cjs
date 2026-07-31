/**
 * TransTrack — local tamper detection tests.
 *
 * Verifies electron/services/integrityMonitor.cjs detects modification of the
 * security-critical main-process files, and that the sealed baseline itself
 * cannot be quietly regenerated.
 *
 * A synthetic file tree stands in for electron/ so the real source is never
 * touched. The monitor is driven through explicit rootDir/manifestPath
 * overrides.
 *
 * Run standalone: node tests/integrityMonitor.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transtrack-integrity-'));
const userData = path.join(workDir, 'userData');
fs.mkdirSync(userData, { recursive: true });

// Mock electron: no safeStorage, so the monitor exercises its unkeyed-seal
// fallback path. A fixed version keeps version drift out of these assertions.
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: {
      getPath: () => userData,
      isPackaged: false,
      getVersion: () => '1.2.0-test',
    },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const monitor = require('../electron/services/integrityMonitor.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

// Build a fake electron/ tree containing every protected path.
const fakeRoot = path.join(workDir, 'electron');
function buildFakeTree() {
  fs.rmSync(fakeRoot, { recursive: true, force: true });
  for (const relativePath of monitor.PROTECTED_FILES) {
    const target = path.join(fakeRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `// original content of ${relativePath}\nmodule.exports = {};\n`);
  }
}

const manifestPath = path.join(userData, 'test-baseline.json');
const opts = { rootDir: fakeRoot, manifestPath };

function freshBaseline() {
  buildFakeTree();
  fs.rmSync(manifestPath, { force: true });
  return monitor.createBaseline(opts);
}

console.log('\n=== Protected file set ===');

test('protects the security-critical modules', () => {
  const required = [
    'main.cjs',
    'preload.cjs',
    'ipc/handlers.cjs',
    'ipc/shared.cjs',
    'ipc/senderValidation.cjs',
    'ipc/argValidation.cjs',
    'services/accessControl.cjs',
    'services/auditChain.cjs',
    'database/init.cjs',
    'database/schema.cjs',
  ];
  for (const relativePath of required) {
    assert.ok(
      monitor.PROTECTED_FILES.includes(relativePath),
      `${relativePath} must be integrity-protected`
    );
  }
});

test('every protected path exists in the real electron directory', () => {
  const realRoot = path.join(__dirname, '..', 'electron');
  const missing = monitor.PROTECTED_FILES.filter((p) => !fs.existsSync(path.join(realRoot, p)));
  assert.deepStrictEqual(missing, [], `protected files not found on disk: ${missing.join(', ')}`);
});

console.log('\n=== Baseline creation ===');

test('createBaseline writes a sealed manifest for every protected file', () => {
  const result = freshBaseline();
  assert.strictEqual(result.created, true, JSON.stringify(result));
  assert.strictEqual(result.fileCount, monitor.PROTECTED_FILES.length);
  assert.deepStrictEqual(result.missing, []);

  const manifest = monitor.readManifest(manifestPath);
  assert.strictEqual(manifest.appVersion, '1.2.0-test');
  assert.ok(manifest.seal && manifest.seal.value, 'manifest must be sealed');
  assert.strictEqual(Object.keys(manifest.files).length, monitor.PROTECTED_FILES.length);
});

test('digests are SHA-256 hex values', () => {
  const { files } = monitor.computeDigests(fakeRoot);
  for (const [name, digest] of Object.entries(files)) {
    assert.ok(/^[a-f0-9]{64}$/.test(digest), `${name} digest must be SHA-256 hex, got ${digest}`);
  }
});

console.log('\n=== Verification ===');

test('a clean tree verifies as ok', () => {
  freshBaseline();
  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'ok', JSON.stringify(result));
  assert.deepStrictEqual(result.modified, []);
  assert.deepStrictEqual(result.missing, []);
  assert.deepStrictEqual(result.added, []);
  assert.strictEqual(result.checked, monitor.PROTECTED_FILES.length);
});

test('detects a modified access control module', () => {
  freshBaseline();
  const target = path.join(fakeRoot, 'services', 'accessControl.cjs');
  fs.writeFileSync(target, 'module.exports = { hasPermission: () => true }; // backdoor\n');

  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'modified');
  assert.deepStrictEqual(result.modified, ['services/accessControl.cjs']);
});

test('detects a single changed byte', () => {
  freshBaseline();
  const target = path.join(fakeRoot, 'ipc', 'shared.cjs');
  const original = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, `${original} `);

  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'modified');
  assert.deepStrictEqual(result.modified, ['ipc/shared.cjs']);
});

test('detects a deleted protected file', () => {
  freshBaseline();
  fs.rmSync(path.join(fakeRoot, 'ipc', 'senderValidation.cjs'));

  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'modified');
  assert.deepStrictEqual(result.missing, ['ipc/senderValidation.cjs']);
});

test('reports multiple modifications at once', () => {
  freshBaseline();
  fs.appendFileSync(path.join(fakeRoot, 'main.cjs'), '// x\n');
  fs.appendFileSync(path.join(fakeRoot, 'preload.cjs'), '// y\n');

  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'modified');
  assert.strictEqual(result.modified.length, 2);
  assert.ok(result.modified.includes('main.cjs'));
  assert.ok(result.modified.includes('preload.cjs'));
});

test('reports a missing baseline rather than passing silently', () => {
  buildFakeTree();
  fs.rmSync(manifestPath, { force: true });
  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'baseline_missing');
});

console.log('\n=== Seal tamper resistance ===');

test('editing a digest inside the manifest invalidates the seal', () => {
  freshBaseline();

  // Simulate an attacker who edits a file and then rewrites the recorded
  // digest to match, without being able to re-seal the manifest.
  const target = path.join(fakeRoot, 'services', 'accessControl.cjs');
  fs.writeFileSync(target, '// backdoored\n');
  const newDigest = monitor.computeDigests(fakeRoot).files['services/accessControl.cjs'];

  const manifest = monitor.readManifest(manifestPath);
  manifest.files['services/accessControl.cjs'] = newDigest;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'baseline_untrusted', JSON.stringify(result));
  assert.strictEqual(result.reason, 'seal_mismatch');
});

test('removing the seal is rejected', () => {
  freshBaseline();
  const manifest = monitor.readManifest(manifestPath);
  delete manifest.seal;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'baseline_untrusted');
  assert.strictEqual(result.reason, 'missing_seal');
});

test('an unknown seal algorithm is rejected', () => {
  freshBaseline();
  const manifest = monitor.readManifest(manifestPath);
  manifest.seal = { algorithm: 'rot13', value: 'whatever' };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'baseline_untrusted');
  assert.strictEqual(result.reason, 'unknown_seal_algorithm');
});

test('a corrupt manifest is treated as missing, not as success', () => {
  buildFakeTree();
  fs.writeFileSync(manifestPath, 'not json at all');
  const result = monitor.verifyIntegrity(opts);
  assert.strictEqual(result.status, 'baseline_missing');
});

console.log('\n=== Startup initialization ===');

test('initializeIntegrityMonitor creates a baseline on first run', () => {
  buildFakeTree();
  fs.rmSync(manifestPath, { force: true });

  const result = monitor.initializeIntegrityMonitor(opts);
  assert.strictEqual(result.status, 'ok', JSON.stringify(result));
  assert.strictEqual(result.baselineCreated, true);
  assert.strictEqual(result.previousStatus, 'baseline_missing');
  assert.strictEqual(fs.existsSync(manifestPath), true);
});

test('initializeIntegrityMonitor verifies against an existing baseline', () => {
  freshBaseline();
  const result = monitor.initializeIntegrityMonitor(opts);
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.baselineCreated, undefined, 'must not re-baseline a clean install');
});

test('initializeIntegrityMonitor reports drift instead of silently re-baselining', () => {
  freshBaseline();
  fs.appendFileSync(path.join(fakeRoot, 'ipc', 'handlers.cjs'), '// tampered\n');

  const result = monitor.initializeIntegrityMonitor(opts);
  assert.strictEqual(result.status, 'modified', 'drift must be reported, not absorbed');
  assert.ok(result.modified.includes('ipc/handlers.cjs'));
  assert.strictEqual(result.baselineCreated, undefined);
});

test('a version change re-baselines instead of alarming on a legitimate upgrade', () => {
  freshBaseline();
  const manifest = monitor.readManifest(manifestPath);
  manifest.appVersion = '1.0.0-old';
  // Re-seal so the manifest stays trusted; only the version differs.
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const verify = monitor.verifyIntegrity(opts);
  assert.strictEqual(verify.status, 'version_changed', JSON.stringify(verify));

  const init = monitor.initializeIntegrityMonitor(opts);
  assert.strictEqual(init.status, 'ok');
  assert.strictEqual(init.baselineCreated, true);
  assert.strictEqual(init.previousStatus, 'version_changed');
});

test('initializeIntegrityMonitor never throws', () => {
  const result = monitor.initializeIntegrityMonitor({
    rootDir: path.join(workDir, 'does-not-exist'),
    manifestPath: path.join(workDir, 'nested', 'missing', 'baseline.json'),
  });
  assert.ok(typeof result.status === 'string', 'must always return a status');
});

// cleanup
try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
