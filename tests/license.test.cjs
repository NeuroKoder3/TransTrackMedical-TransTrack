/**
 * TransTrack — License system end-to-end tests.
 *
 * Covers:
 *   - keypair → sign → verify happy path
 *   - signature tampering, payload tampering, swapped pubkey
 *   - expiry: active / in-grace / hard expired
 *   - machine binding: bound and matching / bound and mismatched / unbound
 *   - manager.activateLicense + storage round-trip
 *   - trial mode: starts, counts down, expires, does NOT reset
 *
 * Run standalone: node tests/license.test.cjs
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated userData per run.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-lic-'));
process.env.TRANSTRACK_USERDATA_DIR = tmp;

const { signLicense, verifyLicense } = require('../electron/license/issuance.cjs');
const verifier = require('../electron/license/verifier.cjs');
const { LICENSE_PROTOCOL_VERSION } = require('../electron/license/publisherPublicKey.cjs');
const { hashForBinding, getMachineFingerprint, _resetForTests: resetMachineId } = require('../electron/license/machineId.cjs');
const storage = require('../electron/license/storage.cjs');

let pass = 0; let fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ': ' + e.message + (e.stack ? '\n     ' + e.stack.split('\n')[1] : '')); fail++; }
}
async function atest(name, fn) {
  try { await fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ': ' + e.message); fail++; }
}

// Generate a private/public test keypair specific to this test run, so we
// don't depend on the dev keypair under keys/license/.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicSpkiDer = publicKey.export({ type: 'spki', format: 'der' });
const publicB64 = publicSpkiDer.subarray(publicSpkiDer.length - 32).toString('base64');

function makePayload(overrides = {}) {
  return {
    licenseId: 'lic_' + crypto.randomBytes(4).toString('hex'),
    protocolVersion: LICENSE_PROTOCOL_VERSION,
    customer: { name: 'Test Hospital', email: 'admin@test.org', orgId: 'test-org' },
    tier: 'enterprise',
    issuedAt: new Date(Date.now() - 86400e3).toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86400e3).toISOString(),
    maintenanceExpiresAt: new Date(Date.now() + 365 * 86400e3).toISOString(),
    limits: { maxPatients: 1000, maxUsers: 25, maxInstallations: 3 },
    features: ['fhir_import', 'fhir_export'],
    machineBindings: [],
    metadata: {},
    ...overrides,
  };
}

console.log('license — issuance & verifier');

test('signs and verifies a clean license', () => {
  const wire = signLicense(makePayload(), privatePem);
  const parsed = verifyLicense(wire, publicB64);
  assert.strictEqual(parsed.tier, 'enterprise');
});

test('flipped byte in signature fails verify', () => {
  const wire = signLicense(makePayload(), privatePem);
  const idx = wire.length - 5;
  const tampered = wire.slice(0, idx) + (wire[idx] === 'A' ? 'B' : 'A') + wire.slice(idx + 1);
  assert.throws(() => verifyLicense(tampered, publicB64), /Signature verification failed|Malformed|Bad signature/);
});

test('flipped byte in payload fails verify', () => {
  const wire = signLicense(makePayload(), privatePem);
  const dot = wire.indexOf('.', 5);
  const idx = Math.floor(dot / 2);
  const tampered = wire.slice(0, idx) + (wire[idx] === 'A' ? 'B' : 'A') + wire.slice(idx + 1);
  assert.throws(() => verifyLicense(tampered, publicB64));
});

test('different public key fails verify', () => {
  const other = crypto.generateKeyPairSync('ed25519').publicKey
    .export({ type: 'spki', format: 'der' });
  const wrongB64 = other.subarray(other.length - 32).toString('base64');
  const wire = signLicense(makePayload(), privatePem);
  assert.throws(() => verifyLicense(wire, wrongB64));
});

test('rejects payload missing required fields', () => {
  assert.throws(() => signLicense({}, privatePem), /payload|required/);
});

console.log('\nverifier — orchestration');

test('reports EXPIRED past the grace window', () => {
  const expired = makePayload({
    issuedAt: new Date(Date.now() - 400 * 86400e3).toISOString(),
    expiresAt: new Date(Date.now() - 100 * 86400e3).toISOString(),
  });
  const wire = signLicense(expired, privatePem);
  const res = verifier.verify(wire, { publicKeyOverride: publicB64 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'EXPIRED');
});

test('reports in_grace status during soft-expiry window', () => {
  const justExpired = makePayload({
    issuedAt: new Date(Date.now() - 200 * 86400e3).toISOString(),
    expiresAt: new Date(Date.now() - 3 * 86400e3).toISOString(),
  });
  const wire = signLicense(justExpired, privatePem);
  const res = verifier.verify(wire, { publicKeyOverride: publicB64 });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'in_grace');
});

test('rejects unsupported protocolVersion', () => {
  const futureProto = makePayload({ protocolVersion: LICENSE_PROTOCOL_VERSION + 1 });
  const wire = signLicense(futureProto, privatePem);
  const res = verifier.verify(wire, { publicKeyOverride: publicB64 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'PROTOCOL_MISMATCH');
});

test('machine-bound license rejects mismatched machine', () => {
  const mid = getMachineFingerprint();
  const otherMid = 'a'.repeat(64);
  const bound = makePayload({ machineBindings: [hashForBinding(otherMid)] });
  const wire = signLicense(bound, privatePem);
  const res = verifier.verify(wire, { publicKeyOverride: publicB64, machineId: mid });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'NOT_BOUND_TO_MACHINE');
});

test('machine-bound license accepts the bound machine', () => {
  const mid = getMachineFingerprint();
  const bound = makePayload({ machineBindings: [hashForBinding(mid)] });
  const wire = signLicense(bound, privatePem);
  const res = verifier.verify(wire, { publicKeyOverride: publicB64, machineId: mid });
  assert.strictEqual(res.ok, true);
});

test('unbound license works on any machine', () => {
  const wire = signLicense(makePayload({ machineBindings: [] }), privatePem);
  const res = verifier.verify(wire, { publicKeyOverride: publicB64, machineId: 'whatever' });
  assert.strictEqual(res.ok, true);
});

console.log('\nstorage — trial mode + activation');

test('trial state initializes and counts down', () => {
  // Use a fresh subdir so prior runs don't pollute.
  process.env.TRANSTRACK_USERDATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-trial1-'));
  const s1 = storage.getTrialState();
  assert.ok(s1.daysRemaining <= storage.TRIAL_DURATION_DAYS);
  assert.ok(s1.daysRemaining >= storage.TRIAL_DURATION_DAYS - 1);
  assert.strictEqual(s1.expired, false);
});

test('trial does NOT reset on subsequent calls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-trial2-'));
  process.env.TRANSTRACK_USERDATA_DIR = dir;
  const s1 = storage.getTrialState();
  const s2 = storage.getTrialState(Date.now() + 5 * 86400e3);
  assert.strictEqual(s1.startedAt, s2.startedAt);
  assert.ok(s2.daysRemaining < s1.daysRemaining);
});

test('trial is reported as expired after duration elapses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-trial3-'));
  process.env.TRANSTRACK_USERDATA_DIR = dir;
  storage.getTrialState();
  const future = Date.now() + (storage.TRIAL_DURATION_DAYS + 1) * 86400e3;
  const s = storage.getTrialState(future);
  assert.strictEqual(s.expired, true);
  assert.strictEqual(s.daysRemaining, 0);
});

test('M-21: deleting the trial file does not reset the window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-trial4-'));
  process.env.TRANSTRACK_USERDATA_DIR = dir;
  const s1 = storage.getTrialState();
  fs.unlinkSync(path.join(dir, '.transtrack-trial'));
  const s2 = storage.getTrialState(Date.now() + 2 * 86400e3);
  assert.strictEqual(s1.startedAt, s2.startedAt);
  assert.ok(s2.daysRemaining <= s1.daysRemaining);
});

test('M-21: clock rollback cannot extend the trial', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-trial5-'));
  process.env.TRANSTRACK_USERDATA_DIR = dir;
  const start = Date.now();
  storage.getTrialState(start);
  // Advance past expiry via high-water, then present an earlier wall clock.
  const afterExpiry = start + (storage.TRIAL_DURATION_DAYS + 2) * 86400e3;
  const expired = storage.getTrialState(afterExpiry);
  assert.strictEqual(expired.expired, true);
  const rolledBack = storage.getTrialState(start + 86400e3);
  assert.strictEqual(rolledBack.expired, true);
});

test('H-7: packaged builds refuse the development publisher key', () => {
  const { assertPublisherKeyAllowed, IS_DEV_KEY } = require('../electron/license/publisherPublicKey.cjs');
  assert.strictEqual(IS_DEV_KEY, true);
  assert.throws(
    () => assertPublisherKeyAllowed({ packaged: true, allowDevPublisher: false }),
    /development license publisher key/
  );
  assert.doesNotThrow(() => assertPublisherKeyAllowed({ packaged: false }));
});

(async () => {
  console.log('\nmanager — public surface');

  // Reset the machineId cache because the test changes userData dirs.
  resetMachineId();
  // Bypass the embedded publisher pubkey so the manager can verify
  // licenses we sign with our test keypair: monkey-patch publisherPublicKey.
  const pkMod = require('../electron/license/publisherPublicKey.cjs');
  pkMod.PUBLIC_KEY_BASE64 = publicB64;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-mgr-'));
  process.env.TRANSTRACK_USERDATA_DIR = dir;

  // Force the manager to re-read state next call.
  delete require.cache[require.resolve('../electron/license/manager.cjs')];
  const manager = require('../electron/license/manager.cjs');
  manager._invalidate();

  await atest('initial state is trial mode, full features', async () => {
    const info = manager.getLicenseInfo();
    assert.strictEqual(info.mode, 'trial');
    assert.strictEqual(info.isLicensed, true);
    assert.ok(info.features.length > 5);
  });

  await atest('activate happy path stores license and flips to active', async () => {
    const payload = makePayload();
    const wire = signLicense(payload, privatePem);
    const res = await manager.activateLicense(wire);
    assert.strictEqual(res.success, true);
    const info = manager.getLicenseInfo();
    assert.strictEqual(info.mode, 'active');
    assert.strictEqual(info.orgId, 'test-org');
  });

  await atest('activate rejects tampered license without persisting', async () => {
    const wire = signLicense(makePayload({ customer: { name: 'X', email: 'x@x', orgId: 'x' } }), privatePem);
    const idx = wire.length - 3;
    const tampered = wire.slice(0, idx) + 'XX' + wire.slice(idx + 2);
    manager.removeLicense();
    const res = await manager.activateLicense(tampered);
    assert.strictEqual(res.success, false);
    const info = manager.getLicenseInfo();
    assert.strictEqual(info.mode, 'trial');
  });

  await atest('checkLimit enforces maxPatients from license', async () => {
    const wire = signLicense(makePayload({ limits: { maxPatients: 50, maxUsers: 10, maxInstallations: 1 } }), privatePem);
    await manager.activateLicense(wire);
    const ok = manager.checkLimit('patients', 25);
    const over = manager.checkLimit('patients', 60);
    assert.strictEqual(ok.withinLimit, true);
    assert.strictEqual(over.withinLimit, false);
  });

  await atest('checkFeature respects features array', async () => {
    const wire = signLicense(makePayload({ features: ['fhir_import'] }), privatePem);
    await manager.activateLicense(wire);
    assert.strictEqual(manager.checkFeature('fhir_import').enabled, true);
    assert.strictEqual(manager.checkFeature('bulk_operations').enabled, false);
  });

  await atest('removeLicense reverts to trial', async () => {
    manager.removeLicense();
    const info = manager.getLicenseInfo();
    assert.ok(info.mode === 'trial' || info.mode === 'trial_expired');
  });

  console.log('\nfeatureGate — enforcement (H-6)');

  delete require.cache[require.resolve('../electron/license/featureGate.cjs')];
  const featureGate = require('../electron/license/featureGate.cjs');

  await atest('requireWriteAccess allows active trial', async () => {
    manager._invalidate();
    assert.doesNotThrow(() => featureGate.requireWriteAccess());
  });

  await atest('requireWriteAccess blocks trial_expired', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-fg-'));
    process.env.TRANSTRACK_USERDATA_DIR = dir2;
    manager._invalidate();
    // Seed an already-expired trial via the clock/trial files.
    const started = new Date(Date.now() - (storage.TRIAL_DURATION_DAYS + 5) * 86400e3).toISOString();
    fs.writeFileSync(path.join(dir2, '.transtrack-trial'), JSON.stringify({ startedAt: started }));
    fs.writeFileSync(
      path.join(dir2, '.transtrack-clock'),
      JSON.stringify({ trialStartedAt: started, lastSeenAtMs: Date.now() })
    );
    manager._invalidate();
    assert.throws(() => featureGate.requireWriteAccess(), /read-only|expired/i);
  });

  await atest('shared.requireFeature consults the license manager', async () => {
    const shared = require('../electron/ipc/shared.cjs');
    // Restore a usable userdata dir with active license from earlier tests.
    const wire = signLicense(makePayload({ features: ['fhir_import'] }), privatePem);
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-shared-'));
    process.env.TRANSTRACK_USERDATA_DIR = dir3;
    manager._invalidate();
    await manager.activateLicense(wire);
    assert.strictEqual(shared.sessionHasFeature('fhir_import'), true);
    assert.strictEqual(shared.sessionHasFeature('bulk_operations'), false);
    assert.throws(() => shared.requireFeature('bulk_operations'), /not available/);
  });

  console.log(`\n${pass} passed, ${fail} failed`);

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

  process.exit(fail > 0 ? 1 : 0);
})();
