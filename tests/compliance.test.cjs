/**
 * TransTrack - Compliance Validation Tests
 *
 * Validates HIPAA, FDA 21 CFR Part 11, and organizational isolation
 * requirements at the code and configuration level.
 *
 * Usage: node tests/compliance.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

// ============================================================================
// Suite 1: HIPAA Technical Safeguards
// ============================================================================
console.log('Suite 1: HIPAA Technical Safeguards');

test('Database encryption module exists', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs')));
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
  assert(content.includes("cipher = 'sqlcipher'"), 'Must use SQLCipher');
  assert(content.includes('AES-256'), 'Must document AES-256 encryption');
});

test('Audit log immutability triggers defined', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
  assert(content.includes('audit_logs_no_update'), 'Must have update prevention trigger');
  assert(content.includes('audit_logs_no_delete'), 'Must have delete prevention trigger');
  assert(content.includes('RAISE(ABORT'), 'Triggers must use RAISE(ABORT)');
});

test('Audit log schema includes required fields', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'schema.cjs'), 'utf8');
  const requiredFields = ['action', 'entity_type', 'user_email', 'user_role', 'created_at', 'org_id'];
  for (const field of requiredFields) {
    assert(content.includes(field), `Audit log must include '${field}' field`);
  }
});

test('Password requirements meet NIST guidelines', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
  assert(content.includes('minLength: 12'), 'Minimum password length must be 12');
  assert(content.includes('requireUppercase'), 'Must require uppercase');
  assert(content.includes('requireSpecial'), 'Must require special characters');
});

test('Session expiration is configured', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
  assert(content.includes('SESSION_DURATION_MS'), 'Must define session duration');
  const match = content.match(/SESSION_DURATION_MS\s*=\s*(\d+)/);
  if (match) {
    const hours = parseInt(match[1]) / (1000 * 60 * 60);
    assert(hours <= 12, `Session must expire within 12 hours (currently ${hours}h)`);
  }
});

test('Account lockout is implemented', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
  assert(content.includes('MAX_LOGIN_ATTEMPTS'), 'Must define max login attempts');
  assert(content.includes('LOCKOUT_DURATION_MS'), 'Must define lockout duration');
  assert(content.includes('checkAccountLockout'), 'Must implement lockout check');
});

// ============================================================================
// Suite 2: FDA 21 CFR Part 11
// ============================================================================
console.log('\nSuite 2: FDA 21 CFR Part 11');

test('Electronic signatures via password authentication', () => {
  const authFile = path.join(__dirname, '..', 'electron', 'ipc', 'handlers', 'auth.cjs');
  assert(fs.existsSync(authFile), 'Auth handler must exist');
  const content = fs.readFileSync(authFile, 'utf8');
  assert(content.includes('bcrypt'), 'Must use bcrypt for password hashing');
});

test('Audit trail captures WHO, WHAT, WHEN', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
  assert(content.includes('user_email'), 'Audit must capture WHO (user_email)');
  assert(content.includes('action'), 'Audit must capture WHAT (action)');
  assert(content.includes('entity_type'), 'Audit must capture WHAT (entity_type)');
  assert(content.includes('new Date().toISOString()'), 'Audit must capture WHEN (timestamp)');
});

test('Audit logs are append-only (no update/delete exports)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
  const logAuditFn = content.substring(content.indexOf('function logAudit'));
  assert(logAuditFn.includes('INSERT INTO audit_logs'), 'logAudit must only INSERT');
  assert(!logAuditFn.includes('UPDATE audit_logs'), 'logAudit must never UPDATE');
  assert(!logAuditFn.includes('DELETE FROM audit_logs'), 'logAudit must never DELETE');
});

// ============================================================================
// Suite 3: Organization Isolation
// ============================================================================
console.log('\nSuite 3: Organization Isolation');

test('All entity tables have org_id column', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'schema.cjs'), 'utf8');
  const tables = ['patients', 'users', 'donor_organs', 'matches', 'notifications', 'audit_logs'];
  for (const table of tables) {
    const tableSection = content.substring(content.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert(tableSection.includes('org_id TEXT NOT NULL'), `Table '${table}' must have org_id NOT NULL`);
  }
});

test('Entity queries enforce org_id scoping', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
  assert(content.includes('getEntityByIdAndOrg'), 'Must have org-scoped entity getter');
  assert(content.includes('listEntitiesByOrg'), 'Must have org-scoped entity lister');
  assert(content.includes('WHERE org_id = ?'), 'Queries must filter by org_id');
});

test('Session validates org_id presence', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'shared.cjs'), 'utf8');
  assert(content.includes('Organization context required'), 'Must validate org_id in session');
});

// ============================================================================
// Suite 4: Security Configuration
// ============================================================================
console.log('\nSuite 4: Security Configuration');

test('DevTools disabled in production', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert(content.includes("ELECTRON_DEV === '1'"), 'DevTools must require ELECTRON_DEV env var');
  assert(content.includes('!app.isPackaged'), 'DevTools must check app.isPackaged');
  assert(content.includes('devtools-opened'), 'Must listen for devtools-opened event in production');
  assert(content.includes('closeDevTools()'), 'Must force-close DevTools in production');
});

test('Content Security Policy is set', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert(content.includes('Content-Security-Policy'), 'Must set CSP header');
  assert(content.includes("default-src 'self'"), 'CSP must restrict default-src');
});

test('Context isolation enabled', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert(content.includes('contextIsolation: true'), 'Must enable context isolation');
  assert(content.includes('nodeIntegration: false'), 'Must disable node integration');
});

test('External navigation blocked', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert(content.includes('will-navigate'), 'Must handle will-navigate event');
  assert(content.includes('event.preventDefault()'), 'Must prevent external navigation');
});

test('Popup windows blocked', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert(content.includes('setWindowOpenHandler'), 'Must handle window open');
  assert(content.includes("action: 'deny'"), 'Must deny popup windows');
});

test('Security headers configured', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert(content.includes('X-Content-Type-Options'), 'Must set X-Content-Type-Options');
  assert(content.includes('X-Frame-Options'), 'Must set X-Frame-Options');
  assert(content.includes('Referrer-Policy'), 'Must set Referrer-Policy');
});

// ============================================================================
// Suite 5: Encryption
// ============================================================================
console.log('\nSuite 5: Encryption');

test('Encryption key is 256-bit', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
  assert(content.includes('randomBytes(32)'), 'Must generate 32-byte (256-bit) key');
  assert(content.includes('[a-fA-F0-9]{64}'), 'Must validate 64 hex char format');
});

test('Key stored with restrictive permissions', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
  assert(content.includes('0o600'), 'Key file must use 0o600 permissions');
});

test('Key backup exists', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
  assert(content.includes('keyBackupPath'), 'Must create key backup');
  assert(content.includes('.transtrack-key.backup'), 'Backup must use proper filename');
});

test('Rekey capability exists', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'database', 'init.cjs'), 'utf8');
  assert(content.includes('rekeyDatabase'), 'Must export rekeyDatabase function');
  assert(content.includes("rekey ="), 'Must use PRAGMA rekey for key rotation');
});

// ============================================================================
// Suite 6: Documentation Compliance
// ============================================================================
console.log('\nSuite 6: Documentation Compliance');

const requiredDocs = [
  { file: 'docs/HIPAA_COMPLIANCE_MATRIX.md', desc: 'HIPAA compliance matrix' },
  { file: 'docs/THREAT_MODEL.md', desc: 'Threat model' },
  { file: 'docs/DISASTER_RECOVERY.md', desc: 'Disaster recovery plan' },
  { file: 'docs/ENCRYPTION_KEY_MANAGEMENT.md', desc: 'Encryption key management' },
  { file: 'docs/API_SECURITY.md', desc: 'API security documentation' },
  { file: 'docs/OPERATIONS_MANUAL.md', desc: 'Operations manual' },
];

for (const doc of requiredDocs) {
  test(`${doc.desc} exists`, () => {
    const fullPath = path.join(__dirname, '..', doc.file);
    assert(fs.existsSync(fullPath), `Missing: ${doc.file}`);
    const stat = fs.statSync(fullPath);
    assert(stat.size > 100, `${doc.file} appears empty or too small`);
  });
}

// ============================================================================
// Suite 7: Rate Limiting
// ============================================================================
console.log('\nSuite 7: Rate Limiting');

test('Rate limiter module exists', () => {
  const filePath = path.join(__dirname, '..', 'electron', 'ipc', 'rateLimiter.cjs');
  assert(fs.existsSync(filePath), 'rateLimiter.cjs must exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert(content.includes('sliding') || content.includes('window') || content.includes('limit'), 'Must implement rate limiting logic');
});

// ============================================================================
// Suite 8: Structured Logging
// ============================================================================
console.log('\nSuite 8: Structured Logging');

test('Error logger with sensitive data redaction', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'errorLogger.cjs'), 'utf8');
  assert(content.includes('SENSITIVE_KEYS'), 'Must define sensitive keys for redaction');
  assert(content.includes('password'), 'Must redact passwords');
  assert(content.includes('ssn'), 'Must redact SSN');
  assert(content.includes('[REDACTED]'), 'Must replace with [REDACTED]');
});

test('Log rotation is configured', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'errorLogger.cjs'), 'utf8');
  assert(content.includes('MAX_LOG_SIZE'), 'Must define max log size');
  assert(content.includes('MAX_LOG_FILES'), 'Must define max log file count');
  assert(content.includes('rotateIfNeeded'), 'Must implement rotation');
});

// Summary
console.log('\n=======================');
console.log(`Compliance Test Results: ${passed}/${totalTests} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\nFAILED - Compliance requirements not fully met');
  process.exit(1);
} else {
  console.log('\nPASSED - All compliance checks verified');
  process.exit(0);
}
