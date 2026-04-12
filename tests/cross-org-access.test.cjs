/**
 * TransTrack - Cross-Organization Data Isolation Tests (Schema Level)
 * 
 * These tests verify that org-scoped SQL query patterns correctly
 * isolate data between organizations at the database schema level.
 * 
 * NOTE: These tests exercise local helper functions that mirror the
 * query patterns used in production IPC handlers. They do NOT invoke
 * actual ipcMain handlers. For end-to-end IPC isolation tests, see
 * tests/ipc-integration.test.cjs.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');

// Mock Electron's app module for testing
const mockUserDataPath = path.join(__dirname, '.test-data-' + Date.now());

// Create mock before requiring modules
const mockApp = {
  getPath: (type) => {
    if (type === 'userData') return mockUserDataPath;
    return mockUserDataPath;
  },
  isPackaged: false,
};

// Setup mock
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: { app: mockApp },
};

// Now we can require our modules
const { v4: uuidv4 } = require('uuid');

// Test Results
const testResults = {
  passed: 0,
  failed: 0,
  errors: [],
};

// =============================================================================
// TEST UTILITIES
// =============================================================================

function logTest(name, passed, error = null) {
  if (passed) {
    console.log(`  ✓ ${name}`);
    testResults.passed++;
  } else {
    console.log(`  ✗ ${name}`);
    testResults.failed++;
    if (error) {
      console.log(`    Error: ${error}`);
      testResults.errors.push({ test: name, error });
    }
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(`${message}: value was null or undefined`);
  }
}

function assertThrows(fn, expectedError, message) {
  let threw = false;
  let actualError = null;
  try {
    fn();
  } catch (e) {
    threw = true;
    actualError = e.message;
  }
  if (!threw) {
    throw new Error(`${message}: expected function to throw, but it didn't`);
  }
  if (expectedError && !actualError.includes(expectedError)) {
    throw new Error(`${message}: expected error "${expectedError}", got "${actualError}"`);
  }
}

// =============================================================================
// DATABASE SETUP (In-Memory for Testing)
// =============================================================================

let db = null;

function setupTestDatabase() {
  // Use better-sqlite3-multiple-ciphers which is already installed in the project
  const Database = require('better-sqlite3-multiple-ciphers');
  db = new Database(':memory:');
  
  // Create organizations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'TRANSPLANT_CENTER',
      status TEXT NOT NULL DEFAULT 'active',
      settings TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'coordinator',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(org_id, email),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);
  
  // Create patients table
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      blood_type TEXT,
      waitlist_status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(org_id, patient_id),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);
  
  // Create readiness_barriers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS readiness_barriers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      barrier_type TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      risk_level TEXT DEFAULT 'low',
      owning_role TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);
  
  // Create audit_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      user_email TEXT,
      user_role TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  // Create settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(org_id, key)
    )
  `);
  
  return db;
}

// =============================================================================
// TEST DATA SETUP
// =============================================================================

function createTestOrganizations() {
  const orgA = { id: uuidv4(), name: 'Hospital Alpha', type: 'TRANSPLANT_CENTER' };
  const orgB = { id: uuidv4(), name: 'Hospital Beta', type: 'TRANSPLANT_CENTER' };
  
  db.prepare('INSERT INTO organizations (id, name, type) VALUES (?, ?, ?)').run(orgA.id, orgA.name, orgA.type);
  db.prepare('INSERT INTO organizations (id, name, type) VALUES (?, ?, ?)').run(orgB.id, orgB.name, orgB.type);
  
  return { orgA, orgB };
}

function createTestUsers(orgA, orgB) {
  const userA = { id: uuidv4(), org_id: orgA.id, email: 'admin@alpha.com', full_name: 'Admin Alpha', role: 'admin' };
  const userB = { id: uuidv4(), org_id: orgB.id, email: 'admin@beta.com', full_name: 'Admin Beta', role: 'admin' };
  
  // Note: same email in different orgs should be allowed
  const userA2 = { id: uuidv4(), org_id: orgA.id, email: 'shared@example.com', full_name: 'Shared User A', role: 'coordinator' };
  const userB2 = { id: uuidv4(), org_id: orgB.id, email: 'shared@example.com', full_name: 'Shared User B', role: 'coordinator' };
  
  const stmt = db.prepare('INSERT INTO users (id, org_id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(userA.id, userA.org_id, userA.email, 'hash', userA.full_name, userA.role);
  stmt.run(userB.id, userB.org_id, userB.email, 'hash', userB.full_name, userB.role);
  stmt.run(userA2.id, userA2.org_id, userA2.email, 'hash', userA2.full_name, userA2.role);
  stmt.run(userB2.id, userB2.org_id, userB2.email, 'hash', userB2.full_name, userB2.role);
  
  return { userA, userB, userA2, userB2 };
}

function createTestPatients(orgA, orgB) {
  const patientA1 = { id: uuidv4(), org_id: orgA.id, patient_id: 'MRN-A001', first_name: 'John', last_name: 'Doe' };
  const patientA2 = { id: uuidv4(), org_id: orgA.id, patient_id: 'MRN-A002', first_name: 'Jane', last_name: 'Doe' };
  const patientB1 = { id: uuidv4(), org_id: orgB.id, patient_id: 'MRN-B001', first_name: 'Bob', last_name: 'Smith' };
  const patientB2 = { id: uuidv4(), org_id: orgB.id, patient_id: 'MRN-B002', first_name: 'Alice', last_name: 'Smith' };
  
  const stmt = db.prepare('INSERT INTO patients (id, org_id, patient_id, first_name, last_name) VALUES (?, ?, ?, ?, ?)');
  stmt.run(patientA1.id, patientA1.org_id, patientA1.patient_id, patientA1.first_name, patientA1.last_name);
  stmt.run(patientA2.id, patientA2.org_id, patientA2.patient_id, patientA2.first_name, patientA2.last_name);
  stmt.run(patientB1.id, patientB1.org_id, patientB1.patient_id, patientB1.first_name, patientB1.last_name);
  stmt.run(patientB2.id, patientB2.org_id, patientB2.patient_id, patientB2.first_name, patientB2.last_name);
  
  return { patientA1, patientA2, patientB1, patientB2 };
}

function createTestBarriers(orgA, orgB, patients) {
  const barrierA = { id: uuidv4(), org_id: orgA.id, patient_id: patients.patientA1.id, barrier_type: 'INSURANCE_CLEARANCE' };
  const barrierB = { id: uuidv4(), org_id: orgB.id, patient_id: patients.patientB1.id, barrier_type: 'TRANSPORTATION_PLAN' };
  
  const stmt = db.prepare('INSERT INTO readiness_barriers (id, org_id, patient_id, barrier_type) VALUES (?, ?, ?, ?)');
  stmt.run(barrierA.id, barrierA.org_id, barrierA.patient_id, barrierA.barrier_type);
  stmt.run(barrierB.id, barrierB.org_id, barrierB.patient_id, barrierB.barrier_type);
  
  return { barrierA, barrierB };
}

function createTestSettings(orgA, orgB) {
  const stmt = db.prepare('INSERT INTO settings (id, org_id, key, value) VALUES (?, ?, ?, ?)');
  stmt.run(uuidv4(), orgA.id, 'theme', 'dark');
  stmt.run(uuidv4(), orgA.id, 'timezone', 'America/New_York');
  stmt.run(uuidv4(), orgB.id, 'theme', 'light');
  stmt.run(uuidv4(), orgB.id, 'timezone', 'America/Los_Angeles');
}

// =============================================================================
// ORG-SCOPED QUERY FUNCTIONS (Simulating service layer)
// =============================================================================

function getPatientById(id, orgId) {
  if (!orgId) throw new Error('Organization context required');
  return db.prepare('SELECT * FROM patients WHERE id = ? AND org_id = ?').get(id, orgId);
}

function getPatientsByOrg(orgId) {
  if (!orgId) throw new Error('Organization context required');
  return db.prepare('SELECT * FROM patients WHERE org_id = ?').all(orgId);
}

function getBarrierById(id, orgId) {
  if (!orgId) throw new Error('Organization context required');
  return db.prepare('SELECT * FROM readiness_barriers WHERE id = ? AND org_id = ?').get(id, orgId);
}

function getBarriersByOrg(orgId) {
  if (!orgId) throw new Error('Organization context required');
  return db.prepare('SELECT * FROM readiness_barriers WHERE org_id = ?').all(orgId);
}

function getSettingByKey(orgId, key) {
  if (!orgId) throw new Error('Organization context required');
  return db.prepare('SELECT * FROM settings WHERE org_id = ? AND key = ?').get(orgId, key);
}

function getUserByEmail(email, orgId) {
  if (!orgId) throw new Error('Organization context required');
  return db.prepare('SELECT * FROM users WHERE email = ? AND org_id = ?').get(email, orgId);
}

// =============================================================================
// TEST CASES
// =============================================================================

function runTests() {
  console.log('\n========================================');
  console.log('Cross-Organization Data Isolation Tests (Schema Level)');
  console.log('========================================\n');
  
  // Setup
  setupTestDatabase();
  const { orgA, orgB } = createTestOrganizations();
  const { userA, userB, userA2, userB2 } = createTestUsers(orgA, orgB);
  const patients = createTestPatients(orgA, orgB);
  const barriers = createTestBarriers(orgA, orgB, patients);
  createTestSettings(orgA, orgB);
  
  // ==========================================================================
  // TEST SUITE 1: Patient Access Isolation
  // ==========================================================================
  console.log('Test Suite 1: Patient Access Isolation');
  console.log('--------------------------------------');
  
  // Test 1.1: User can access patients in their own org
  try {
    const result = getPatientsByOrg(orgA.id);
    assertEqual(result.length, 2, 'Org A should have 2 patients');
    logTest('1.1: User can access patients in their own org', true);
  } catch (e) {
    logTest('1.1: User can access patients in their own org', false, e.message);
  }
  
  // Test 1.2: User cannot access patients from other org via list
  try {
    const orgAPatients = getPatientsByOrg(orgA.id);
    const orgBPatients = getPatientsByOrg(orgB.id);
    
    // Verify no cross-contamination
    const orgAIds = new Set(orgAPatients.map(p => p.id));
    const orgBIds = new Set(orgBPatients.map(p => p.id));
    
    for (const id of orgAIds) {
      if (orgBIds.has(id)) {
        throw new Error('Found patient ID in both orgs!');
      }
    }
    logTest('1.2: Patient lists are properly isolated between orgs', true);
  } catch (e) {
    logTest('1.2: Patient lists are properly isolated between orgs', false, e.message);
  }
  
  // Test 1.3: Cannot access specific patient from other org
  try {
    const result = getPatientById(patients.patientB1.id, orgA.id);
    assertEqual(result, undefined, 'Should not find Org B patient when querying with Org A context');
    logTest('1.3: Cannot access specific patient from other org', true);
  } catch (e) {
    logTest('1.3: Cannot access specific patient from other org', false, e.message);
  }
  
  // Test 1.4: Query without org_id should fail
  try {
    assertThrows(
      () => getPatientsByOrg(null),
      'Organization context required',
      'Should throw without org context'
    );
    logTest('1.4: Query without org_id fails (fail-closed)', true);
  } catch (e) {
    logTest('1.4: Query without org_id fails (fail-closed)', false, e.message);
  }
  
  // ==========================================================================
  // TEST SUITE 2: Barrier Access Isolation
  // ==========================================================================
  console.log('\nTest Suite 2: Barrier Access Isolation');
  console.log('--------------------------------------');
  
  // Test 2.1: Can access barriers in own org
  try {
    const result = getBarriersByOrg(orgA.id);
    assertEqual(result.length, 1, 'Org A should have 1 barrier');
    logTest('2.1: Can access barriers in own org', true);
  } catch (e) {
    logTest('2.1: Can access barriers in own org', false, e.message);
  }
  
  // Test 2.2: Cannot access barrier from other org
  try {
    const result = getBarrierById(barriers.barrierB.id, orgA.id);
    assertEqual(result, undefined, 'Should not find Org B barrier with Org A context');
    logTest('2.2: Cannot access barrier from other org', true);
  } catch (e) {
    logTest('2.2: Cannot access barrier from other org', false, e.message);
  }
  
  // ==========================================================================
  // TEST SUITE 3: Settings Isolation
  // ==========================================================================
  console.log('\nTest Suite 3: Settings Isolation');
  console.log('--------------------------------');
  
  // Test 3.1: Settings are org-scoped
  try {
    const themeA = getSettingByKey(orgA.id, 'theme');
    const themeB = getSettingByKey(orgB.id, 'theme');
    assertEqual(themeA.value, 'dark', 'Org A theme should be dark');
    assertEqual(themeB.value, 'light', 'Org B theme should be light');
    logTest('3.1: Settings are properly org-scoped', true);
  } catch (e) {
    logTest('3.1: Settings are properly org-scoped', false, e.message);
  }
  
  // Test 3.2: Cannot access other org's settings
  try {
    const result = getSettingByKey(orgA.id, 'timezone');
    assertNotNull(result, 'Should find timezone for Org A');
    assertEqual(result.value, 'America/New_York', 'Org A timezone should be NY');
    
    // Org B should have different timezone
    const resultB = getSettingByKey(orgB.id, 'timezone');
    assertEqual(resultB.value, 'America/Los_Angeles', 'Org B timezone should be LA');
    logTest('3.2: Org settings are properly isolated', true);
  } catch (e) {
    logTest('3.2: Org settings are properly isolated', false, e.message);
  }
  
  // ==========================================================================
  // TEST SUITE 4: User Email Uniqueness Per Org
  // ==========================================================================
  console.log('\nTest Suite 4: User Email Uniqueness Per Org');
  console.log('-------------------------------------------');
  
  // Test 4.1: Same email can exist in different orgs
  try {
    const userInA = getUserByEmail('shared@example.com', orgA.id);
    const userInB = getUserByEmail('shared@example.com', orgB.id);
    
    assertNotNull(userInA, 'Should find user with shared email in Org A');
    assertNotNull(userInB, 'Should find user with shared email in Org B');
    
    // They should be different users
    if (userInA.id === userInB.id) {
      throw new Error('Same email in different orgs should be different users');
    }
    logTest('4.1: Same email can exist in different orgs', true);
  } catch (e) {
    logTest('4.1: Same email can exist in different orgs', false, e.message);
  }
  
  // Test 4.2: Cannot find user with email from wrong org
  try {
    const result = getUserByEmail('admin@alpha.com', orgB.id);
    assertEqual(result, undefined, 'Should not find Org A admin email in Org B context');
    logTest('4.2: User lookup requires correct org context', true);
  } catch (e) {
    logTest('4.2: User lookup requires correct org context', false, e.message);
  }
  
  // Test 4.3: Duplicate email in same org should fail
  try {
    const stmt = db.prepare('INSERT INTO users (id, org_id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?, ?)');
    let threw = false;
    try {
      stmt.run(uuidv4(), orgA.id, 'admin@alpha.com', 'hash', 'Duplicate', 'coordinator');
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error('Should have thrown on duplicate email in same org');
    }
    logTest('4.3: Duplicate email in same org is rejected', true);
  } catch (e) {
    logTest('4.3: Duplicate email in same org is rejected', false, e.message);
  }
  
  // ==========================================================================
  // TEST SUITE 5: Direct SQL Injection Attempts
  // ==========================================================================
  console.log('\nTest Suite 5: SQL Injection Prevention');
  console.log('--------------------------------------');
  
  // Test 5.1: Org ID injection attempt
  try {
    // Attempt to inject OR condition
    const maliciousOrgId = "' OR '1'='1";
    const result = db.prepare('SELECT * FROM patients WHERE org_id = ?').all(maliciousOrgId);
    assertEqual(result.length, 0, 'SQL injection should return no results');
    logTest('5.1: Org ID injection attempt blocked', true);
  } catch (e) {
    logTest('5.1: Org ID injection attempt blocked', false, e.message);
  }
  
  // Test 5.2: Patient ID injection attempt
  try {
    const maliciousId = "' OR org_id != 'blocked";
    const result = getPatientById(maliciousId, orgA.id);
    assertEqual(result, undefined, 'Injection should not return any patient');
    logTest('5.2: Patient ID injection attempt blocked', true);
  } catch (e) {
    logTest('5.2: Patient ID injection attempt blocked', false, e.message);
  }
  
  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`Passed: ${testResults.passed}`);
  console.log(`Failed: ${testResults.failed}`);
  console.log(`Total:  ${testResults.passed + testResults.failed}`);
  
  if (testResults.failed > 0) {
    console.log('\nFailed Tests:');
    testResults.errors.forEach(({ test, error }) => {
      console.log(`  - ${test}: ${error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✓ All cross-organization data isolation tests passed!');
    console.log('  Schema-level organization isolation is properly enforced.');
  }
  
  // Cleanup
  db.close();
}

// Run tests
runTests();
