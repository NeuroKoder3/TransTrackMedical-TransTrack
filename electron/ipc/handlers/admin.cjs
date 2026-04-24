/**
 * TransTrack - Admin IPC Handlers
 * Handles: app:*, organization:*, settings:*, encryption:*
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const {
  getDatabase,
  isEncryptionEnabled,
  verifyDatabaseIntegrity,
  getEncryptionStatus,
  getPatientCount,
  getUserCount,
} = require('../../database/init.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  ipcMain.handle('app:getInfo', () => ({
    name: 'TransTrack',
    version: '1.0.0',
    designAlignment: ['HIPAA Security Rule', '21 CFR Part 11', 'AATB Standards'],
    certificationDisclaimer: 'Design alignment statements describe product controls only and are not certifications.',
    encryptionEnabled: isEncryptionEnabled(),
  }));

  ipcMain.handle('app:getVersion', () => '1.0.0');

  // Encryption status
  ipcMain.handle('encryption:getStatus', async () => getEncryptionStatus());

  ipcMain.handle('encryption:verifyIntegrity', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw new Error('Admin access required');

    const result = verifyDatabaseIntegrity();
    shared.logAudit('encryption_verify', 'System', null, null,
      `Database integrity check: ${result.valid ? 'PASSED' : 'FAILED'}`,
      currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('encryption:isEnabled', async () => isEncryptionEnabled());

  // --- organization ---
  ipcMain.handle('organization:getCurrent', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    if (!org) throw new Error('Organization not found');

    const patientCount = getPatientCount(orgId);
    const userCount = getUserCount(orgId);

    return {
      ...org,
      usage: { patients: patientCount, users: userCount },
    };
  });

  ipcMain.handle('organization:update', async (event, updates) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw new Error('Admin access required');

    const orgId = shared.getSessionOrgId();
    const now = new Date().toISOString();
    const allowedFields = ['name', 'address', 'phone', 'email', 'settings'];
    const safeUpdates = {};

    for (const field of allowedFields) {
      if (updates[field] !== undefined) safeUpdates[field] = updates[field];
    }
    if (Object.keys(safeUpdates).length === 0) throw new Error('No valid fields to update');

    if (safeUpdates.settings && typeof safeUpdates.settings === 'object') {
      safeUpdates.settings = JSON.stringify(safeUpdates.settings);
    }

    const setClause = Object.keys(safeUpdates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(safeUpdates), now, orgId];
    db.prepare(`UPDATE organizations SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values);

    shared.logAudit('update', 'Organization', orgId, null, 'Organization settings updated', currentUser.email, currentUser.role);
    return { success: true };
  });

  // Settings
  ipcMain.handle('settings:get', async (event, key) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const setting = db.prepare('SELECT value FROM settings WHERE org_id = ? AND key = ?').get(orgId, key);
    if (!setting) return null;
    try { return JSON.parse(setting.value); } catch { return setting.value; }
  });

  ipcMain.handle('settings:set', async (event, key, value) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw new Error('Admin access required');

    const orgId = shared.getSessionOrgId();
    const now = new Date().toISOString();
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const existing = db.prepare('SELECT id FROM settings WHERE org_id = ? AND key = ?').get(orgId, key);

    if (existing) {
      db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE id = ?').run(valueStr, now, existing.id);
    } else {
      db.prepare('INSERT INTO settings (id, org_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(), orgId, key, valueStr, now
      );
    }

    shared.logAudit('settings_update', 'Settings', key, null, `Setting '${key}' updated`, currentUser.email, currentUser.role);
    return { success: true };
  });

  // Account-lockout report (admin-only). Returns currently locked accounts
  // and accounts with elevated failure counts. Used for security dashboards
  // and compliance audits per HIPAA §164.308(a)(5)(ii)(C) (login monitoring).
  ipcMain.handle('admin:lockoutReport', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    const orgId = shared.getSessionOrgId();
    // login_attempts is keyed by email, not org. We scope to emails that match users in this org.
    const orgEmails = db.prepare('SELECT email FROM users WHERE org_id = ?').all(orgId).map(r => r.email);
    if (!orgEmails.length) return { locked: [], elevated: [] };
    const placeholders = orgEmails.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT email, attempt_count, last_attempt_at, locked_until, ip_address
         FROM login_attempts WHERE email IN (${placeholders})
         ORDER BY (CASE WHEN locked_until IS NULL THEN 1 ELSE 0 END) ASC, locked_until DESC, attempt_count DESC`
    ).all(...orgEmails);
    const now = Date.now();
    const locked = rows.filter(r => r.locked_until && new Date(r.locked_until).getTime() > now);
    const elevated = rows.filter(r => r.attempt_count >= 3 && !(r.locked_until && new Date(r.locked_until).getTime() > now));
    return { locked, elevated, generatedAt: new Date().toISOString() };
  });

  // Manual unlock of a specific account (admin-only). Records an audit row
  // including the actor for forensic traceability.
  ipcMain.handle('admin:unlockAccount', async (_event, email) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    if (!email) throw new Error('email is required');
    const orgId = shared.getSessionOrgId();
    const target = db.prepare('SELECT id, email FROM users WHERE email = ? AND org_id = ?').get(email, orgId);
    if (!target) throw new Error('User not found in your organization');
    db.prepare(
      "UPDATE login_attempts SET attempt_count = 0, locked_until = NULL, updated_at = datetime('now') WHERE email = ?"
    ).run(email.toLowerCase().trim());
    shared.logAudit('account_unlock', 'User', target.id, null,
      'Account manually unlocked by admin', currentUser.email, currentUser.role);
    return { success: true };
  });

  ipcMain.handle('settings:getAll', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const settings = db.prepare('SELECT key, value FROM settings WHERE org_id = ?').all(orgId);
    const result = {};
    for (const setting of settings) {
      try { result[setting.key] = JSON.parse(setting.value); } catch { result[setting.key] = setting.value; }
    }
    return result;
  });
}

module.exports = { register };
