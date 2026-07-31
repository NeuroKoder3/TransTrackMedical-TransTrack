/**
 * TransTrack — Electron hardening assertions.
 *
 * Static source analysis of electron/main.cjs and electron/preload.cjs. These
 * settings cannot be asserted at runtime without launching a real Electron
 * process (that is what tests/e2e/*.spec.cjs does), but they are exactly the
 * kind of setting that gets silently regressed during a refactor, so they are
 * pinned here in the fast unit suite too.
 *
 * Requirements enforced:
 *   nodeIntegration: false, contextIsolation: true, sandbox: true
 *   on EVERY BrowserWindow — including the splash window.
 *
 * A sandboxed preload cannot require() local modules, so this file also
 * asserts the preload stays sandbox-compatible.
 *
 * Run standalone: node tests/electronHardening.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ELECTRON_DIR = path.join(__dirname, '..', 'electron');
const mainSource = fs.readFileSync(path.join(ELECTRON_DIR, 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(ELECTRON_DIR, 'preload.cjs'), 'utf8');
const handlersSource = fs.readFileSync(path.join(ELECTRON_DIR, 'ipc', 'handlers.cjs'), 'utf8');
const initSource = fs.readFileSync(path.join(ELECTRON_DIR, 'database', 'init.cjs'), 'utf8');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

/**
 * Extract each webPreferences block from the main process source, so every
 * window can be checked independently rather than trusting a global grep.
 */
function extractWebPreferencesBlocks(source) {
  const blocks = [];
  const marker = 'webPreferences: {';
  let index = source.indexOf(marker);

  while (index !== -1) {
    let depth = 0;
    let cursor = index + marker.length - 1; // position of the opening brace
    let end = -1;
    for (let i = cursor; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    blocks.push(source.slice(index, end + 1));
    index = source.indexOf(marker, end);
  }

  return blocks;
}

const webPrefBlocks = extractWebPreferencesBlocks(mainSource);

console.log('\n=== Electron window hardening ===');

test('every BrowserWindow declares webPreferences', () => {
  const windowCount = (mainSource.match(/new BrowserWindow\(/g) || []).length;
  assert.ok(windowCount >= 1, 'expected at least one BrowserWindow');
  assert.strictEqual(
    webPrefBlocks.length, windowCount,
    `found ${windowCount} BrowserWindow(s) but ${webPrefBlocks.length} webPreferences block(s)`
  );
});

test('nodeIntegration is false on every window', () => {
  webPrefBlocks.forEach((block, i) => {
    assert.ok(/nodeIntegration:\s*false/.test(block), `window #${i + 1} must set nodeIntegration: false`);
    assert.ok(!/nodeIntegration:\s*true/.test(block), `window #${i + 1} must not enable nodeIntegration`);
  });
});

test('contextIsolation is true on every window', () => {
  webPrefBlocks.forEach((block, i) => {
    assert.ok(/contextIsolation:\s*true/.test(block), `window #${i + 1} must set contextIsolation: true`);
    assert.ok(!/contextIsolation:\s*false/.test(block), `window #${i + 1} must not disable contextIsolation`);
  });
});

test('sandbox is true on every window', () => {
  webPrefBlocks.forEach((block, i) => {
    assert.ok(/sandbox:\s*true/.test(block), `window #${i + 1} must set sandbox: true`);
    assert.ok(!/sandbox:\s*false/.test(block), `window #${i + 1} must not disable the sandbox`);
  });
});

test('webSecurity is enabled and insecure content is blocked', () => {
  webPrefBlocks.forEach((block, i) => {
    assert.ok(/webSecurity:\s*true/.test(block), `window #${i + 1} must set webSecurity: true`);
    assert.ok(
      /allowRunningInsecureContent:\s*false/.test(block),
      `window #${i + 1} must set allowRunningInsecureContent: false`
    );
  });
});

test('enableRemoteModule is disabled on every window', () => {
  webPrefBlocks.forEach((block, i) => {
    assert.ok(/enableRemoteModule:\s*false/.test(block), `window #${i + 1} must disable the remote module`);
  });
});

console.log('\n=== Sandbox-compatible preload ===');

test('preload does not require any local module', () => {
  // require('./x') / require('../x') is unavailable in a sandboxed preload;
  // if one is reintroduced the renderer bridge breaks at startup.
  const localRequires = preloadSource.match(/require\(\s*['"]\.[^'"]*['"]\s*\)/g) || [];
  assert.deepStrictEqual(
    localRequires, [],
    `sandboxed preload cannot require local modules, found: ${localRequires.join(', ')}`
  );
});

test('preload only requires the electron module', () => {
  const allRequires = [...preloadSource.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const mod of allRequires) {
    assert.strictEqual(mod, 'electron', `preload must not require "${mod}" under sandbox`);
  }
});

test('preload receives the security policy through additionalArguments', () => {
  assert.ok(
    /additionalArguments:\s*\[/.test(mainSource),
    'main process must pass additionalArguments to the preload'
  );
  assert.ok(
    mainSource.includes('--transtrack-security-policy='),
    'main process must forward the security policy argument'
  );
  assert.ok(
    preloadSource.includes('--transtrack-security-policy='),
    'preload must read the security policy argument'
  );
});

test('preload exposes the bridge only through contextBridge', () => {
  assert.ok(preloadSource.includes('contextBridge.exposeInMainWorld'), 'must use contextBridge');
  assert.ok(
    !/window\.(electronAPI|transtrackConfig)\s*=/.test(preloadSource),
    'must not assign the bridge directly onto window'
  );
});

test('preload does not expose a generic invoke passthrough', () => {
  // A generic invoke(channel, ...args) would defeat the channel allowlist.
  assert.ok(
    !/invoke:\s*\(\s*channel/.test(preloadSource),
    'preload must not expose a generic channel passthrough'
  );
});

console.log('\n=== Navigation, popups, permissions ===');

test('external navigation is blocked', () => {
  assert.ok(mainSource.includes("'will-navigate'"), 'must handle will-navigate');
  assert.ok(mainSource.includes('event.preventDefault()'), 'must prevent blocked navigation');
});

test('popups are denied', () => {
  assert.ok(mainSource.includes('setWindowOpenHandler'), 'must set a window open handler');
  assert.ok(/action:\s*'deny'/.test(mainSource), 'window open handler must deny');
});

test('webview attachment is blocked', () => {
  assert.ok(mainSource.includes("'will-attach-webview'"), 'must handle will-attach-webview');
});

test('renderer permission requests are denied', () => {
  assert.ok(mainSource.includes('setPermissionRequestHandler'), 'must set a permission request handler');
  assert.ok(mainSource.includes('setPermissionCheckHandler'), 'must set a permission check handler');
  assert.ok(mainSource.includes('setDevicePermissionHandler'), 'must refuse device access');
});

test('certificate errors are rejected', () => {
  assert.ok(mainSource.includes("'certificate-error'"), 'must handle certificate-error');
  assert.ok(mainSource.includes('callback(false)'), 'must refuse invalid certificates');
});

test('a Content Security Policy is applied to responses', () => {
  assert.ok(mainSource.includes('Content-Security-Policy'), 'must set a CSP header');
  assert.ok(mainSource.includes("frame-ancestors 'none'"), 'CSP must deny framing');
  assert.ok(mainSource.includes("object-src 'none'"), 'CSP must deny plugins/objects');
  assert.ok(mainSource.includes("base-uri 'self'"), 'CSP must pin base-uri');
});

test('the production CSP forbids inline script', () => {
  // The relaxed policy must be reachable only in dev/test. This is asserted
  // statically because a packaged build cannot be exercised from a test run,
  // and it is the control that actually mitigates renderer XSS.
  assert.ok(
    mainSource.includes("? \"script-src 'self' 'unsafe-inline'\"") ||
    mainSource.includes("'unsafe-inline'\"\n      : \"script-src 'self'\""),
    "script-src 'unsafe-inline' must be gated behind a dev/test branch"
  );
  assert.ok(
    mainSource.includes(": \"script-src 'self'\""),
    "the non-dev branch must send script-src 'self' with no inline allowance"
  );
});

test('the production CSP narrows connect-src to the configured API origin', () => {
  // The wide connect-src list is required for Vite/HMR in dev. In production it
  // must collapse to 'self' plus the single configured API origin, which is how
  // remote/Epic mode keeps working without opening the renderer to any host.
  assert.ok(mainSource.includes('const connectSrc = isDev'), 'connect-src must branch on isDev');
  assert.ok(
    mainSource.includes(': ["\'self\'"]'),
    "the non-dev connect-src branch must start from 'self' only"
  );
  assert.ok(
    mainSource.includes('connectSrc.push(apiOrigin)'),
    'the configured API origin must be appended so Epic/remote mode still connects'
  );
});

console.log('\n=== Renderer document policy ===');

for (const htmlPath of [
  path.join(__dirname, '..', 'index.html'),
  path.join(__dirname, '..', 'src', 'index.html'),
]) {
  const label = path.relative(path.join(__dirname, '..'), htmlPath).replace(/\\/g, '/');

  test(`${label} declares a baseline CSP`, () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    assert.ok(match, 'a meta CSP must be present');

    const csp = match[1];
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      assert.ok(csp.includes(directive), `meta CSP must include: ${directive}`);
    }
  });
}

test('devtools are closed in packaged builds', () => {
  assert.ok(mainSource.includes("'devtools-opened'"), 'must react to devtools being opened');
  assert.ok(mainSource.includes('closeDevTools'), 'must close devtools outside dev');
});

console.log('\n=== Session lifecycle ===');

test('an OS screen lock or suspend ends the session', () => {
  // The idle timeout only covers inactivity; a deliberate workstation lock must
  // not leave a live session (and rendered PHI) behind the lock screen.
  assert.ok(
    mainSource.includes('screenLock.cjs'),
    'main must initialize the screen lock integration'
  );
  assert.ok(
    mainSource.includes('initializeScreenLock'),
    'the screen lock listeners must actually be registered'
  );
  assert.ok(
    preloadSource.includes("'session:locked'"),
    'the renderer must be able to observe the lock so PHI leaves the screen'
  );
});

console.log('\n=== IPC middleware ordering ===');

test('IPC middleware validates sender before invoking any handler', () => {
  const senderIndex = handlersSource.indexOf('validateSender');
  const handlerIndex = handlersSource.indexOf('await handler(event');
  assert.ok(senderIndex > -1, 'middleware must call validateSender');
  assert.ok(handlerIndex > -1, 'middleware must invoke the wrapped handler');
  assert.ok(senderIndex < handlerIndex, 'sender validation must run before the handler');
});

test('IPC middleware validates arguments before invoking any handler', () => {
  const argIndex = handlersSource.indexOf('validateArgs');
  const handlerIndex = handlersSource.indexOf('await handler(event');
  assert.ok(argIndex > -1, 'middleware must call validateArgs');
  assert.ok(argIndex < handlerIndex, 'argument validation must run before the handler');
});

test('IPC middleware still enforces rate limiting and session restrictions', () => {
  assert.ok(handlersSource.includes('checkRateLimit'), 'rate limiting must remain in the middleware');
  assert.ok(handlersSource.includes('sessionAllows'), 'session restriction gate must remain');
});

console.log('\n=== Storage-layer secure deletion ===');

test('database enables secure_delete so removed PHI is overwritten', () => {
  assert.ok(
    /secure_delete\s*=\s*ON/.test(initSource),
    'init.cjs must set PRAGMA secure_delete = ON'
  );
});

test('database still uses SQLCipher with authenticated AES-256 settings', () => {
  assert.ok(/cipher\s*=\s*'sqlcipher'/.test(initSource), 'must select the sqlcipher cipher');
  assert.ok(/kdf_iter\s*=\s*256000/.test(initSource), 'must keep 256000 KDF iterations');
  assert.ok(/cipher_hmac_algorithm\s*=\s*HMAC_SHA512/.test(initSource), 'must keep HMAC-SHA512 page auth');
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
