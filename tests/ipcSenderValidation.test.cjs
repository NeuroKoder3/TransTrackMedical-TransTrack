/**
 * TransTrack — IPC sender validation tests.
 *
 * Electron's ipcMain answers any renderer frame that knows a channel name.
 * These tests pin the trust anchor behaviour that stops IPC from anything
 * other than the main window's top-level frame:
 *
 *   • fail closed before a trusted window is registered
 *   • reject a different WebContents (session riding / second window)
 *   • reject sub-frames (injected iframe reaching the PHI bridge)
 *   • reject non-allowlisted frame origins (remote http, data:, blob:)
 *   • accept file:// in packaged builds and localhost only in dev
 *
 * Run standalone: node tests/ipcSenderValidation.test.cjs
 */

'use strict';

const assert = require('assert');

// Mock electron before requiring the module under test.
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: { getPath: () => __dirname, isPackaged: false } },
};

const senderValidation = require('../electron/ipc/senderValidation.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try {
    senderValidation._resetForTests();
    fn();
    PASS++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    FAIL++;
    failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

/** Build a fake ipcMain event. */
function makeEvent({ senderId = 1, frameUrl = 'file:///C:/app/dist/index.html', parent = null, includeFrame = true } = {}) {
  const event = { sender: { id: senderId } };
  if (includeFrame) {
    event.senderFrame = { url: frameUrl, parent };
  }
  return event;
}

console.log('\n=== IPC sender validation ===');

// --- fail closed ---

test('rejects IPC when no trusted window has been registered', () => {
  const result = senderValidation.validateSender(makeEvent(), 'entity:list');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'no_trusted_window');
});

test('rejects a missing event object', () => {
  senderValidation._setStateForTests({ webContentsId: 1 });
  assert.strictEqual(senderValidation.validateSender(null, 'entity:list').ok, false);
  assert.strictEqual(senderValidation.validateSender(undefined, 'entity:list').reason, 'missing_event');
});

test('rejects an event with no sender', () => {
  senderValidation._setStateForTests({ webContentsId: 1 });
  const result = senderValidation.validateSender({}, 'entity:list');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'missing_sender');
});

// --- WebContents binding ---

test('accepts the registered WebContents', () => {
  senderValidation._setStateForTests({ webContentsId: 7 });
  const result = senderValidation.validateSender(makeEvent({ senderId: 7 }), 'entity:list');
  assert.strictEqual(result.ok, true, JSON.stringify(result));
});

test('rejects a different WebContents id', () => {
  senderValidation._setStateForTests({ webContentsId: 7 });
  const result = senderValidation.validateSender(makeEvent({ senderId: 8 }), 'entity:list');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'untrusted_webcontents');
});

// --- frame checks ---

test('rejects a sub-frame even from the trusted WebContents', () => {
  senderValidation._setStateForTests({ webContentsId: 7 });
  const event = makeEvent({ senderId: 7, parent: { url: 'file:///C:/app/dist/index.html' } });
  const result = senderValidation.validateSender(event, 'entity:get');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'subframe_sender');
});

test('rejects a remote https frame origin', () => {
  senderValidation._setStateForTests({ webContentsId: 7 });
  const event = makeEvent({ senderId: 7, frameUrl: 'https://evil.example.com/x' });
  const result = senderValidation.validateSender(event, 'entity:get');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'disallowed_frame_origin');
});

test('rejects data: and blob: frame origins', () => {
  senderValidation._setStateForTests({ webContentsId: 7 });
  for (const url of ['data:text/html,<script>1</script>', 'blob:file:///abc', 'about:blank']) {
    const result = senderValidation.validateSender(makeEvent({ senderId: 7, frameUrl: url }), 'entity:get');
    assert.strictEqual(result.ok, false, `expected rejection for ${url}`);
  }
});

test('rejects localhost when not in dev mode', () => {
  senderValidation._setStateForTests({ webContentsId: 7, isDev: false });
  const event = makeEvent({ senderId: 7, frameUrl: 'http://localhost:5173/' });
  assert.strictEqual(senderValidation.validateSender(event, 'entity:get').ok, false);
});

test('accepts localhost only in dev mode', () => {
  senderValidation._setStateForTests({ webContentsId: 7, isDev: true });
  for (const url of ['http://localhost:5173/', 'http://127.0.0.1:5173/index.html']) {
    const result = senderValidation.validateSender(makeEvent({ senderId: 7, frameUrl: url }), 'entity:get');
    assert.strictEqual(result.ok, true, `expected ${url} to be accepted in dev`);
  }
});

test('dev mode still rejects non-local http origins', () => {
  senderValidation._setStateForTests({ webContentsId: 7, isDev: true });
  const event = makeEvent({ senderId: 7, frameUrl: 'http://192.168.1.50:5173/' });
  assert.strictEqual(senderValidation.validateSender(event, 'entity:get').ok, false);
});

test('treats an unreadable senderFrame as untrusted', () => {
  senderValidation._setStateForTests({ webContentsId: 7 });
  const event = { sender: { id: 7 } };
  Object.defineProperty(event, 'senderFrame', {
    get() { throw new Error('frame was destroyed'); },
  });
  const result = senderValidation.validateSender(event, 'entity:get');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'sender_frame_unavailable');
});

// --- isAllowedFrameUrl unit behaviour ---

test('isAllowedFrameUrl rejects malformed and empty URLs', () => {
  senderValidation._setStateForTests({ webContentsId: 7 });
  for (const url of ['', null, undefined, 'not a url', 42]) {
    assert.strictEqual(senderValidation.isAllowedFrameUrl(url), false, `expected rejection for ${String(url)}`);
  }
});

test('isAllowedFrameUrl accepts file:// paths', () => {
  senderValidation._setStateForTests({ webContentsId: 7 });
  assert.strictEqual(senderValidation.isAllowedFrameUrl('file:///C:/Program%20Files/TransTrack/dist/index.html'), true);
});

// --- registration ---

test('registerTrustedWindow requires a BrowserWindow-like object', () => {
  assert.throws(() => senderValidation.registerTrustedWindow(null), /requires a BrowserWindow/);
  assert.throws(() => senderValidation.registerTrustedWindow({}), /requires a BrowserWindow/);
});

test('registerTrustedWindow binds the webContents id', () => {
  const listeners = {};
  const fakeWindow = {
    webContents: { id: 42 },
    on: (evt, cb) => { listeners[evt] = cb; },
  };
  const id = senderValidation.registerTrustedWindow(fakeWindow, { isDev: false });
  assert.strictEqual(id, 42);
  assert.strictEqual(senderValidation.getTrustedWebContentsId(), 42);

  const ok = senderValidation.validateSender(makeEvent({ senderId: 42 }), 'entity:list');
  assert.strictEqual(ok.ok, true);

  // Closing the window must drop the anchor so stale IPC fails closed.
  listeners.closed();
  assert.strictEqual(senderValidation.getTrustedWebContentsId(), null);
  assert.strictEqual(senderValidation.validateSender(makeEvent({ senderId: 42 }), 'entity:list').ok, false);
});

test('no channel is exempt from sender validation', () => {
  assert.strictEqual(
    senderValidation.PRE_REGISTRATION_CHANNELS.size, 0,
    'PRE_REGISTRATION_CHANNELS must stay empty — an exemption is an IPC bypass'
  );
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
