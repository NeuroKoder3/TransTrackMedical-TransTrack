/**
 * TransTrack — Password history & expiration tests.
 * Run with: node tests/passwordHistory.test.cjs
 */

'use strict';

const assert = require('assert');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3-multiple-ciphers');
const initModule = require('../electron/database/init.cjs');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    password_changed_at TEXT
  );
  CREATE TABLE user_password_history (
    id TEXT PRIMARY KEY, user_id TEXT, password_hash TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO users VALUES ('U1', NULL);
`);
initModule.getDatabase = () => db;

const ph = require('../electron/services/passwordHistory.cjs');

let PASS = 0, FAIL = 0; const failures = [];
function test(n, fn) {
  try { fn(); PASS++; console.log(`  PASS  ${n}`); }
  catch (e) { FAIL++; failures.push({ n, e }); console.log(`  FAIL  ${n}\n        ${e.message}`); }
}

console.log('\n=== Password history ===');

test('recordPassword inserts history row and updates users.password_changed_at', () => {
  const hash = bcrypt.hashSync('Secret123!', 10);
  ph.recordPassword('U1', hash);
  const rows = db.prepare('SELECT * FROM user_password_history WHERE user_id = ?').all('U1');
  assert.strictEqual(rows.length, 1);
  const u = db.prepare('SELECT password_changed_at FROM users WHERE id = ?').get('U1');
  assert.ok(u.password_changed_at);
});

test('hasReusedPassword returns true for matching prior password', () => {
  assert.strictEqual(ph.hasReusedPassword('U1', 'Secret123!'), true);
});

test('hasReusedPassword returns false for unique new password', () => {
  assert.strictEqual(ph.hasReusedPassword('U1', 'BrandNewPass456!'), false);
});

test('isPasswordExpired returns true when password_changed_at is null', () => {
  assert.strictEqual(ph.isPasswordExpired({ password_changed_at: null }), true);
});

test('isPasswordExpired returns false for recent change', () => {
  assert.strictEqual(ph.isPasswordExpired({ password_changed_at: new Date().toISOString() }), false);
});

test('isPasswordExpired returns true after default max age (90 days)', () => {
  const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(ph.isPasswordExpired({ password_changed_at: old }), true);
});

test('history depth: only last N passwords are checked', () => {
  // Insert 12 distinct passwords beyond the original Secret123!
  for (let i = 0; i < 12; i++) {
    ph.recordPassword('U1', bcrypt.hashSync('Pwd' + i + '!Aa', 10));
  }
  // The very first password should now be outside the default window of 10
  assert.strictEqual(ph.hasReusedPassword('U1', 'Secret123!', 10), false);
  // It IS still in the table though, so a depth of 50 catches it
  assert.strictEqual(ph.hasReusedPassword('U1', 'Secret123!', 50), true);
});

console.log(`\nResults: ${PASS} passed, ${FAIL} failed.`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.n}:\n${f.e.stack || f.e.message}`);
  process.exit(1);
}
