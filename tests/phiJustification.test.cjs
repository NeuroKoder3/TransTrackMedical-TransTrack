/**
 * TransTrack — PHI justification access control tests.
 *
 * Exercises authorizeAndLogPhiAccess: short justification must be rejected,
 * valid justification with correct role must be granted.
 *
 * Run standalone: node tests/phiJustification.test.cjs
 */

'use strict';

const assert = require('assert');

// Stub electron before requiring accessControl (which uses getDatabase).
const mockApp = {
  getPath: () => __dirname,
  isPackaged: false,
};
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: mockApp },
};

// Stub init.cjs with a noop DB so the optional audit INSERT doesn't crash.
const initPath = require.resolve('../electron/database/init.cjs');
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: {
    getDatabase: () => ({
      prepare() {
        return {
          get() { return { org_id: 'ORG1' }; },
          run() {},
        };
      },
    }),
  },
};

const ac = require('../electron/services/accessControl.cjs');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const validUser = {
  id: 'u1',
  email: 'coord@example.com',
  role: 'coordinator',
};

console.log('phiJustification — authorizeAndLogPhiAccess behavioral tests');

test('rejects when justification is too short (< 10 chars)', () => {
  const result = ac.authorizeAndLogPhiAccess({
    permission: ac.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: 'p1',
    justification: 'short',
    user: validUser,
  });
  assert.strictEqual(result.granted, false);
  assert.ok(result.reason.includes('10 characters'), `Expected "10 characters" in reason, got "${result.reason}"`);
});

test('rejects when justification is missing', () => {
  const result = ac.authorizeAndLogPhiAccess({
    permission: ac.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: 'p1',
    justification: null,
    user: validUser,
  });
  assert.strictEqual(result.granted, false);
});

test('rejects when justification is empty string', () => {
  const result = ac.authorizeAndLogPhiAccess({
    permission: ac.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: 'p1',
    justification: '   ',
    user: validUser,
  });
  assert.strictEqual(result.granted, false);
});

test('rejects when user role lacks permission', () => {
  const result = ac.authorizeAndLogPhiAccess({
    permission: ac.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: 'p1',
    justification: 'Reviewing transplant candidacy for patient treatment plan',
    user: { id: 'u2', email: 'viewer@example.com', role: 'viewer' },
  });
  assert.strictEqual(result.granted, false);
  assert.ok(result.reason.includes('Permission denied'));
});

test('grants access on valid justification with correct role', () => {
  const result = ac.authorizeAndLogPhiAccess({
    permission: ac.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: 'p1',
    justification: 'Reviewing transplant candidacy for patient treatment plan',
    user: validUser,
  });
  assert.strictEqual(result.granted, true);
  assert.ok(result.grantId, 'Must return a grantId');
  assert.ok(result.expiresAt, 'Must return expiresAt');
});

test('grants access for admin role', () => {
  const result = ac.authorizeAndLogPhiAccess({
    permission: ac.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: 'p2',
    justification: 'Compliance audit review for annual inspection',
    user: { id: 'u3', email: 'admin@example.com', role: 'admin' },
  });
  assert.strictEqual(result.granted, true);
});

test('rejects when required parameters are missing', () => {
  const result = ac.authorizeAndLogPhiAccess({
    permission: ac.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: null,
    entityId: 'p1',
    justification: 'Valid justification text here',
    user: validUser,
  });
  assert.strictEqual(result.granted, false);
  assert.ok(result.reason.includes('Missing'));
});

test('hasValidPhiGrant returns true after grant', () => {
  ac.authorizeAndLogPhiAccess({
    permission: ac.PERMISSIONS.PATIENT_VIEW_PHI,
    entityType: 'Patient',
    entityId: 'p-grant-check',
    justification: 'Testing grant validity check for patient access',
    user: validUser,
  });
  const hasGrant = ac.hasValidPhiGrant(validUser.id, 'Patient', 'p-grant-check');
  assert.strictEqual(hasGrant, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
