/**
 * TransTrack — Session validation fail-closed test.
 *
 * Proves that validateSession returns false (denying access) when the
 * underlying DB lookup throws, rather than silently granting a session.
 *
 * Run standalone: node tests/sessionFailClosed.test.cjs
 */

'use strict';

const assert = require('assert');

// Provide security-policy constants before shared.cjs is required.
const mockApp = {
  getPath: () => __dirname,
  isPackaged: false,
};
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: mockApp },
};

const securityPolicy = require('../electron/config/securityPolicy.cjs');

// We need to satisfy the rateLimiter import inside shared.cjs.
// Provide a minimal stub if not already cached.
try { require('../electron/ipc/rateLimiter.cjs'); } catch {
  const rlPath = require.resolve('../electron/ipc/rateLimiter.cjs');
  require.cache[rlPath] = {
    id: rlPath, filename: rlPath, loaded: true,
    exports: { checkRateLimit: () => ({ allowed: true }) },
  };
}

// Provide a mock init.cjs whose getDatabase() we can swap.
const initPath = require.resolve('../electron/database/init.cjs');
let _mockDb = {};
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: {
    getDatabase: () => _mockDb,
    getDatabasePath: () => ':memory:',
    getDatabaseEncryptionKey: () => 'aa'.repeat(32),
  },
};

const shared = require('../electron/ipc/shared.cjs');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('sessionFailClosed — validateSession must deny when DB throws');

test('returns false when no session is set', () => {
  shared.clearSession();
  assert.strictEqual(shared.validateSession(), false);
});

test('returns false when DB prepare() throws', () => {
  shared.clearSession();
  const futureExpiry = Date.now() + 60 * 60 * 1000;
  shared.setSessionState('sess-1', { id: 'u1', org_id: 'org1' }, futureExpiry, null);

  _mockDb = {
    prepare() {
      throw new Error('DB is locked');
    },
  };

  const result = shared.validateSession();
  assert.strictEqual(result, false, 'Must fail closed when DB throws');
});

test('returns false when DB returns no matching session row', () => {
  shared.clearSession();
  const futureExpiry = Date.now() + 60 * 60 * 1000;
  shared.setSessionState('sess-2', { id: 'u2', org_id: 'org2' }, futureExpiry, null);

  _mockDb = {
    prepare() {
      return {
        get() { return undefined; },
      };
    },
  };

  const result = shared.validateSession();
  assert.strictEqual(result, false, 'Must deny when session row missing in DB');
});

test('returns true when DB confirms session and user active', () => {
  shared.clearSession();
  const futureExpiry = Date.now() + 60 * 60 * 1000;
  shared.setSessionState('sess-3', { id: 'u3', org_id: 'org3' }, futureExpiry, null);

  let callCount = 0;
  _mockDb = {
    prepare(sql) {
      return {
        get() {
          callCount++;
          if (sql.includes('sessions')) return { id: 'sess-3' };
          if (sql.includes('users')) return { is_active: 1 };
          return undefined;
        },
      };
    },
  };

  const result = shared.validateSession();
  assert.strictEqual(result, true, 'Must pass when DB confirms session');
  assert.ok(callCount >= 1, 'Must have queried the DB');
});

test('returns false when user account is deactivated', () => {
  shared.clearSession();
  const futureExpiry = Date.now() + 60 * 60 * 1000;
  shared.setSessionState('sess-4', { id: 'u4', org_id: 'org4' }, futureExpiry, null);

  _mockDb = {
    prepare(sql) {
      return {
        get() {
          if (sql.includes('sessions')) return { id: 'sess-4' };
          if (sql.includes('users')) return { is_active: 0 };
          return undefined;
        },
      };
    },
  };

  const result = shared.validateSession();
  assert.strictEqual(result, false, 'Must deny when user deactivated');
});

test('returns false when session has expired', () => {
  shared.clearSession();
  const pastExpiry = Date.now() - 1000;
  shared.setSessionState('sess-5', { id: 'u5', org_id: 'org5' }, pastExpiry, null);

  const result = shared.validateSession();
  assert.strictEqual(result, false, 'Must deny expired session');
});

test('returns false when user has no org_id', () => {
  shared.clearSession();
  const futureExpiry = Date.now() + 60 * 60 * 1000;
  shared.setSessionState('sess-6', { id: 'u6', org_id: null }, futureExpiry, null);

  const result = shared.validateSession();
  assert.strictEqual(result, false, 'Must deny when org_id missing');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
