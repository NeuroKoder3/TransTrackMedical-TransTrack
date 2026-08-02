/**
 * TransTrack — macOS notarization hook.
 *
 * The hook cannot be exercised end to end without an Apple Developer account,
 * so what is tested here is the decision it makes before calling Apple: whether
 * a missing credential is a warning or a failure.
 *
 * That distinction is the whole point. The hook used to warn and return in every
 * failure case, which meant the most likely way to ship an un-notarized DMG was
 * to believe you had notarized it — the build went green, the warning scrolled
 * past in a few thousand lines of electron-builder output, and Gatekeeper
 * rejected the download on the customer's machine.
 *
 * Run standalone: node tests/notarize.test.cjs
 */

'use strict';

const assert = require('assert');

const { __testing__: t } = require('../scripts/notarize.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const FULL = Object.freeze({
  APPLE_ID: 'dev@example.org',
  APPLE_APP_PASSWORD: 'abcd-efgh-ijkl-mnop',
  APPLE_TEAM_ID: 'ABCDE12345',
});

console.log('\nWhen is notarization mandatory');

test('a public release requires notarization', () => {
  assert.strictEqual(t.notarizationRequired({ TRANSTRACK_RELEASE_CHANNEL: 'public' }), true);
});

test('the explicit flag requires notarization on its own', () => {
  assert.strictEqual(t.notarizationRequired({ TRANSTRACK_REQUIRE_NOTARIZATION: '1' }), true);
  assert.strictEqual(t.notarizationRequired({ TRANSTRACK_REQUIRE_NOTARIZATION: 'true' }), true);
});

test('a developer build does not', () => {
  assert.strictEqual(t.notarizationRequired({}), false);
  assert.strictEqual(t.notarizationRequired({ TRANSTRACK_RELEASE_CHANNEL: 'internal' }), false);
  assert.strictEqual(t.notarizationRequired({ TRANSTRACK_REQUIRE_NOTARIZATION: '0' }), false);
});

console.log('\nCredential inspection');

test('a complete credential set reports nothing missing', () => {
  assert.deepStrictEqual(t.inspectCredentials(FULL), { missing: [], hints: [] });
});

test('each required variable is reported when absent', () => {
  for (const key of t.REQUIRED) {
    const env = { ...FULL };
    delete env[key];
    const { missing } = t.inspectCredentials(env);
    assert.deepStrictEqual(missing, [key], `expected ${key} to be reported missing`);
  }
});

test("Apple's own name for the password is diagnosed, not reported as absent", () => {
  // Apple calls it an "app-specific password" and docs/DEPLOYMENT_PRODUCTION.md
  // said APPLE_APP_SPECIFIC_PASSWORD, while the hook reads APPLE_APP_PASSWORD.
  // Anyone who followed that doc got a silent skip; naming the mistake turns a
  // twenty-minute puzzle into a one-line fix.
  const env = { ...FULL };
  delete env.APPLE_APP_PASSWORD;
  env.APPLE_APP_SPECIFIC_PASSWORD = 'abcd-efgh-ijkl-mnop';

  const { missing, hints } = t.inspectCredentials(env);
  assert.deepStrictEqual(missing, ['APPLE_APP_PASSWORD']);
  assert.strictEqual(hints.length, 1);
  assert.match(hints[0], /APPLE_APP_SPECIFIC_PASSWORD is set/);
  assert.match(hints[0], /rename it/);
});

test('a misspelled team id is diagnosed too', () => {
  const env = { ...FULL };
  delete env.APPLE_TEAM_ID;
  env.APPLE_TEAMID = 'ABCDE12345';

  const { hints } = t.inspectCredentials(env);
  assert.strictEqual(hints.length, 1);
  assert.match(hints[0], /APPLE_TEAMID is set/);
});

test('no hint is offered when nothing resembling the variable is present', () => {
  const env = { ...FULL };
  delete env.APPLE_APP_PASSWORD;
  const { missing, hints } = t.inspectCredentials(env);
  assert.deepStrictEqual(missing, ['APPLE_APP_PASSWORD']);
  assert.deepStrictEqual(hints, []);
});

console.log('\nHook behaviour');

/** Minimal electron-builder afterSign context. */
function context(platform) {
  return {
    electronPlatformName: platform,
    appOutDir: '/tmp/out',
    packager: { appInfo: { productFilename: 'TransTrack Enterprise' }, config: { appId: 'com.x' } },
  };
}

const hook = require('../scripts/notarize.cjs').default;

async function withEnv(env, body) {
  const original = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('APPLE_') || k.startsWith('TRANSTRACK_')) delete process.env[k];
  }
  Object.assign(process.env, env);
  try { return await body(); }
  finally { process.env = original; }
}

const queue = [];
function asyncTest(name, fn) {
  queue.push(async () => {
    try { await fn(); PASS++; console.log(`  ok  ${name}`); }
    catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
  });
}

asyncTest('a non-macOS build returns without doing anything', async () => {
  await withEnv({ TRANSTRACK_RELEASE_CHANNEL: 'public' }, async () => {
    // Even on a release, there is nothing to notarize when the platform is not
    // darwin, so this must not throw.
    await hook(context('win32'));
  });
});

asyncTest('a release build with no credentials fails rather than skipping', async () => {
  await withEnv({ TRANSTRACK_RELEASE_CHANNEL: 'public' }, async () => {
    await assert.rejects(() => hook(context('darwin')), /Cannot notarize/);
  });
});

asyncTest('the failure names the missing variables', async () => {
  await withEnv({ TRANSTRACK_RELEASE_CHANNEL: 'public' }, async () => {
    await assert.rejects(() => hook(context('darwin')), (e) => {
      assert.match(e.message, /APPLE_ID/);
      assert.match(e.message, /APPLE_APP_PASSWORD/);
      assert.match(e.message, /APPLE_TEAM_ID/);
      return true;
    });
  });
});

asyncTest('a developer build with no credentials still skips quietly', async () => {
  await withEnv({}, async () => {
    await hook(context('darwin'));
  });
});

(async () => {
  for (const run of queue) await run();

  console.log(`\n${PASS} passed, ${FAIL} failed\n`);
  if (FAIL > 0) {
    for (const f of failures) console.error(`${f.name}\n${f.error.stack || f.error.message}\n`);
    process.exit(1);
  }
})();
