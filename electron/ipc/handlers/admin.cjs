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
  getOrgLicense,
  getPatientCount,
  getUserCount,
} = require('../../database/init.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  // ===== APP INFO =====
  ipcMain.handle('app:getInfo', () => ({
    name: 'TransTrack',
    version: '1.0.0',
    compliance: ['HIPAA', 'FDA 21 CFR Part 11', 'AATB'],
    encryptionEnabled: isEncryptionEnabled(),
  }));

  ipcMain.handle('app:getVersion', () => '1.0.0');

  // ===== ENCRYPTION STATUS =====
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

  // ===== ORGANIZATION MANAGEMENT =====
  ipcMain.handle('organization:getCurrent', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    if (!org) throw new Error('Organization not found');

    const license = getOrgLicense(orgId);
    const patientCount = getPatientCount(orgId);
    const userCount = getUserCount(orgId);

    return {
      ...org,
      license: license ? {
        tier: license.tier,
        maxPatients: license.max_patients,
        maxUsers: license.max_users,
        expiresAt: license.license_expires_at,
        maintenanceExpiresAt: license.maintenance_expires_at,
      } : null,
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

  // ===== SETTINGS (Org-Scoped) =====
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
