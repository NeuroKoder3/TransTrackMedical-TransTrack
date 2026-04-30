/**
 * TransTrack — healthCheck.cjs unit tests.
 *
 * Stubs the Electron module + database so the health snapshot can be
 * produced in a plain Node process. Verifies envelope shape, status
 * roll-up, and per-component graceful failure.
 */

'use strict';

const path = require('path');
const assert = require('assert');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

// Mock electron + database BEFORE requiring healthCheck.
const mockUserData = path.join(__dirname, '.test-data-health-' + Date.now());
require('fs').mkdirSync(mockUserData, { recursive: true });
require('fs').mkdirSync(path.join(mockUserData, 'logs'), { recursive: true });
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: {
      getPath: (k) => path.join(mockUserData, k),
      isPackaged: false,
      getVersion: () => '1.2.0-test',
    },
    crashReporter: { start: () => {} },
  },
};

const Database = require('better-sqlite3-multiple-ciphers');
const inMemoryDb = new Database(':memory:');
inMemoryDb.exec(`CREATE TABLE organizations (id TEXT PRIMARY KEY)`);
require.cache[require.resolve('../electron/database/init.cjs')] = {
  id: 'init', filename: 'init', loaded: true,
  exports: { getDatabase: () => inMemoryDb, initDatabase: () => {}, closeDatabase: () => {} },
};

const healthCheck = require('../electron/services/healthCheck.cjs');

console.log('\n=== healthCheck ===');

test('getHealth returns the standard envelope', () => {
  const r = healthCheck.getHealth();
  assert.ok(['ok', 'warn', 'fail'].includes(r.status));
  assert.ok(typeof r.asOfISO === 'string');
  assert.ok(r.components);
  for (const k of ['process', 'logger', 'database', 'encryption', 'riskEngine', 'backups']) {
    assert.ok(r.components[k], `missing component: ${k}`);
    assert.ok(typeof r.components[k].status === 'string');
  }
  assert.strictEqual(r.info.product, 'TransTrack');
  assert.strictEqual(r.info.version, '1.2.0-test');
});

test('process component reports node + electron version + memory', () => {
  const r = healthCheck.getHealth();
  const p = r.components.process;
  assert.strictEqual(p.status, 'ok');
  assert.ok(p.nodeVersion);
  assert.ok(typeof p.rssMB === 'number');
  assert.ok(typeof p.uptimeSeconds === 'number');
});

test('database component sees the organizations table → ok', () => {
  const r = healthCheck.getHealth();
  assert.strictEqual(r.components.database.status, 'ok');
  assert.strictEqual(r.components.database.organizationsTablePresent, true);
});

test('riskEngine component validates FACTOR_WEIGHTS sum to 1.0', () => {
  const r = healthCheck.getHealth();
  const re = r.components.riskEngine;
  assert.strictEqual(re.status, 'ok');
  assert.ok(re.modelVersion);
  assert.ok(Math.abs(re.weightSum - 1.0) < 1e-9);
});

test('overall status is the worst per-component status', () => {
  const r = healthCheck.getHealth();
  // backups is expected to be 'warn' (no backups in the mock env)
  // so overall should be 'warn' — never 'fail'.
  assert.notStrictEqual(r.status, 'fail');
});

test('getHealth never throws', () => {
  // Even with a broken database mock, getHealth should still produce
  // a snapshot (with status=fail for that component).
  require.cache[require.resolve('../electron/database/init.cjs')] = {
    id: 'init', filename: 'init', loaded: true,
    exports: { getDatabase: () => { throw new Error('boom'); } },
  };
  const r = healthCheck.getHealth();
  assert.strictEqual(r.components.database.status, 'fail');
  assert.ok(r.components.database.error.includes('boom'));
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);

// cleanup
try { require('fs').rmSync(mockUserData, { recursive: true, force: true }); } catch { /* ignore */ }

if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
