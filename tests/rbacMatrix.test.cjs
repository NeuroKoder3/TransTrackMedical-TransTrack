/**
 * TransTrack — RBAC least-privilege matrix.
 *
 * Pins the complete role x permission matrix so privilege creep cannot happen
 * silently. Every assertion here is a deliberate policy statement: if a role
 * legitimately needs a new permission, this file must be updated in the same
 * commit, which makes the change visible in review.
 *
 * Also asserts the structural least-privilege properties that must hold no
 * matter how the matrix evolves:
 *   • only admin holds destructive and system permissions
 *   • read-only roles hold no write permission at all
 *   • regulators can read the audit trail but cannot alter clinical data
 *   • sensitive permissions require a justification
 *   • unknown roles are denied everything (fail closed)
 *
 * Run standalone: node tests/rbacMatrix.test.cjs
 */

'use strict';

const assert = require('assert');

// accessControl requires the database module at load; stub it since none of the
// pure permission functions touch the database.
const initPath = require.resolve('../electron/database/init.cjs');
require.cache[initPath] = {
  id: initPath, filename: initPath, loaded: true,
  exports: { getDatabase: () => { throw new Error('database must not be used by permission checks'); } },
};

const accessControl = require('../electron/services/accessControl.cjs');
const { PERMISSIONS, ROLES, hasPermission, requiresJustification, validateAccessRequest } = accessControl;

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const ALL_ROLES = Object.keys(ROLES);
const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/**
 * The authoritative expected matrix. Keys are roles, values are the exact set
 * of permissions that role may hold — nothing more.
 */
const EXPECTED_MATRIX = {
  admin: ALL_PERMISSIONS,
  coordinator: [
    'patient:view', 'patient:view_phi', 'patient:create', 'patient:update',
    'donor:view', 'donor:create', 'donor:update',
    'match:view', 'match:create', 'match:update',
    'report:generate', 'risk:view',
  ],
  physician: [
    'patient:view', 'patient:view_phi', 'patient:update',
    'donor:view', 'match:view', 'match:approve',
    'report:generate', 'risk:view',
  ],
  user: [
    'patient:view', 'patient:create', 'patient:update',
    'donor:view', 'match:view',
  ],
  viewer: ['patient:view', 'donor:view', 'match:view'],
  regulator: [
    'patient:view', 'donor:view', 'match:view',
    'audit:view', 'compliance:view', 'compliance:regulator', 'report:generate',
  ],
};

/** Permissions that only an administrator may ever hold. */
const ADMIN_ONLY = [
  'patient:delete', 'donor:delete',
  'user:manage', 'settings:manage', 'audit:export',
  'system:backup', 'system:restore', 'system:configure',
  'risk:configure', 'report:export',
];

/** Roles that must never hold a permission that changes data. */
const READ_ONLY_ROLES = ['viewer', 'regulator'];

const WRITE_PERMISSION_PATTERN = /:(create|update|delete|manage|approve|configure|restore|backup)$/;

console.log('\n=== Exact role x permission matrix ===');

for (const role of ALL_ROLES) {
  test(`${role} holds exactly its documented permission set`, () => {
    const expected = EXPECTED_MATRIX[role];
    assert.ok(expected, `no expected matrix entry for role "${role}" — update rbacMatrix.test.cjs`);

    const granted = ALL_PERMISSIONS.filter((p) => hasPermission(role, p)).sort();
    const wanted = [...expected].sort();

    const unexpected = granted.filter((p) => !wanted.includes(p));
    const missing = wanted.filter((p) => !granted.includes(p));

    assert.deepStrictEqual(
      unexpected, [],
      `${role} has UNEXPECTED permissions (privilege creep): ${unexpected.join(', ')}`
    );
    assert.deepStrictEqual(
      missing, [],
      `${role} is MISSING expected permissions: ${missing.join(', ')}`
    );
  });
}

test('the expected matrix covers every defined role', () => {
  const undocumented = ALL_ROLES.filter((r) => !EXPECTED_MATRIX[r]);
  assert.deepStrictEqual(undocumented, [], `roles missing from the matrix: ${undocumented.join(', ')}`);
});

test('the matrix references no unknown permission', () => {
  for (const [role, permissions] of Object.entries(EXPECTED_MATRIX)) {
    for (const permission of permissions) {
      assert.ok(
        ALL_PERMISSIONS.includes(permission),
        `${role} references unknown permission "${permission}"`
      );
    }
  }
});

console.log('\n=== Structural least-privilege invariants ===');

test('only admin holds destructive and system permissions', () => {
  for (const permission of ADMIN_ONLY) {
    assert.ok(
      ALL_PERMISSIONS.includes(permission),
      `ADMIN_ONLY lists unknown permission "${permission}"`
    );
    for (const role of ALL_ROLES) {
      if (role === 'admin') {
        assert.strictEqual(hasPermission(role, permission), true, `admin must hold ${permission}`);
      } else {
        assert.strictEqual(
          hasPermission(role, permission), false,
          `${role} must NOT hold the admin-only permission ${permission}`
        );
      }
    }
  }
});

test('read-only roles hold no write permission', () => {
  for (const role of READ_ONLY_ROLES) {
    const writes = ALL_PERMISSIONS.filter(
      (p) => WRITE_PERMISSION_PATTERN.test(p) && hasPermission(role, p)
    );
    assert.deepStrictEqual(writes, [], `${role} must be read-only but holds: ${writes.join(', ')}`);
  }
});

test('viewer cannot see PHI', () => {
  assert.strictEqual(hasPermission('viewer', PERMISSIONS.PATIENT_VIEW_PHI), false);
});

test('regulator can read the audit trail but not export it unilaterally', () => {
  assert.strictEqual(hasPermission('regulator', PERMISSIONS.AUDIT_VIEW), true);
  assert.strictEqual(hasPermission('regulator', PERMISSIONS.AUDIT_EXPORT), false);
});

test('regulator cannot modify clinical data (separation of duties)', () => {
  for (const permission of [
    PERMISSIONS.PATIENT_CREATE, PERMISSIONS.PATIENT_UPDATE, PERMISSIONS.PATIENT_DELETE,
    PERMISSIONS.DONOR_CREATE, PERMISSIONS.MATCH_CREATE, PERMISSIONS.MATCH_APPROVE,
  ]) {
    assert.strictEqual(
      hasPermission('regulator', permission), false,
      `regulator must not hold ${permission}`
    );
  }
});

test('regulator cannot see PHI without a justified grant', () => {
  assert.strictEqual(hasPermission('regulator', PERMISSIONS.PATIENT_VIEW_PHI), false);
});

test('only physicians and admins may approve a match', () => {
  const approvers = ALL_ROLES.filter((r) => hasPermission(r, PERMISSIONS.MATCH_APPROVE));
  assert.deepStrictEqual(approvers.sort(), ['admin', 'physician']);
});

test('only admin may manage users', () => {
  const managers = ALL_ROLES.filter((r) => hasPermission(r, PERMISSIONS.USER_MANAGE));
  assert.deepStrictEqual(managers, ['admin']);
});

test('only admin may restore the database', () => {
  const restorers = ALL_ROLES.filter((r) => hasPermission(r, PERMISSIONS.SYSTEM_RESTORE));
  assert.deepStrictEqual(restorers, ['admin']);
});

test('no non-admin role holds every permission', () => {
  for (const role of ALL_ROLES) {
    if (role === 'admin') continue;
    const granted = ALL_PERMISSIONS.filter((p) => hasPermission(role, p));
    assert.ok(
      granted.length < ALL_PERMISSIONS.length,
      `${role} effectively has admin rights (${granted.length}/${ALL_PERMISSIONS.length})`
    );
  }
});

console.log('\n=== Fail-closed behaviour ===');

test('unknown roles are denied every permission', () => {
  for (const role of ['superadmin', 'root', '', 'ADMIN', 'Admin', 'guest']) {
    for (const permission of ALL_PERMISSIONS) {
      assert.strictEqual(
        hasPermission(role, permission), false,
        `unknown role "${role}" must not hold ${permission}`
      );
    }
  }
});

test('null, undefined, and non-string roles are denied', () => {
  for (const role of [null, undefined, 0, {}, [], true]) {
    assert.strictEqual(hasPermission(role, PERMISSIONS.PATIENT_VIEW), false);
  }
});

test('unknown permissions are denied even for admin', () => {
  for (const permission of ['patient:destroy', 'system:root', '', '*']) {
    assert.strictEqual(
      hasPermission('admin', permission), false,
      `admin must not hold the undefined permission "${permission}"`
    );
  }
});

test('prototype keys are not treated as roles', () => {
  // Guards against a lookup like ROLES[userRole] resolving to Object.prototype.
  for (const role of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.strictEqual(
      hasPermission(role, PERMISSIONS.PATIENT_VIEW), false,
      `"${role}" must not resolve to a role`
    );
  }
});

console.log('\n=== Justification requirements ===');

test('sensitive permissions require a justification', () => {
  for (const permission of [
    PERMISSIONS.PATIENT_VIEW_PHI, PERMISSIONS.PATIENT_DELETE, PERMISSIONS.DONOR_DELETE,
    PERMISSIONS.MATCH_APPROVE, PERMISSIONS.AUDIT_EXPORT, PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.SYSTEM_RESTORE,
  ]) {
    assert.strictEqual(requiresJustification(permission), true, `${permission} must require justification`);
  }
});

test('routine reads do not require a justification', () => {
  for (const permission of [PERMISSIONS.PATIENT_VIEW, PERMISSIONS.DONOR_VIEW, PERMISSIONS.MATCH_VIEW]) {
    assert.strictEqual(requiresJustification(permission), false);
  }
});

test('a sensitive request without justification is refused', () => {
  const result = validateAccessRequest('coordinator', PERMISSIONS.PATIENT_VIEW_PHI, null);
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.requiresJustification, true);
  assert.ok(Array.isArray(result.justificationReasons) && result.justificationReasons.length > 0);
});

test('a sensitive request with a valid justification is allowed', () => {
  const result = validateAccessRequest('coordinator', PERMISSIONS.PATIENT_VIEW_PHI, { reason: 'treatment' });
  assert.strictEqual(result.allowed, true, JSON.stringify(result));
  assert.strictEqual(result.justificationLogged, true);
});

test('an invalid justification reason is refused', () => {
  const result = validateAccessRequest('coordinator', PERMISSIONS.PATIENT_VIEW_PHI, { reason: 'because' });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /Invalid justification reason/);
});

test('"other" justification requires details', () => {
  const withoutDetails = validateAccessRequest('coordinator', PERMISSIONS.PATIENT_VIEW_PHI, { reason: 'other' });
  assert.strictEqual(withoutDetails.allowed, false);
  assert.match(withoutDetails.reason, /Details required/);

  const withDetails = validateAccessRequest(
    'coordinator', PERMISSIONS.PATIENT_VIEW_PHI,
    { reason: 'other', details: 'Responding to an OPTN inquiry' }
  );
  assert.strictEqual(withDetails.allowed, true);
});

test('justification cannot substitute for a missing permission', () => {
  // A viewer must not gain PHI access merely by supplying a reason.
  const result = validateAccessRequest('viewer', PERMISSIONS.PATIENT_VIEW_PHI, { reason: 'treatment' });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /Permission denied/);
});

test('an unknown role is refused even with a valid justification', () => {
  const result = validateAccessRequest('superuser', PERMISSIONS.PATIENT_VIEW_PHI, { reason: 'treatment' });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /Permission denied/);
});

console.log(`\n${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
  process.exit(1);
}
