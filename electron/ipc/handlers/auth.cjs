/**
 * TransTrack - Authentication IPC Handlers
 * Handles: auth:login, auth:logout, auth:me, auth:isAuthenticated,
 *          auth:register, auth:changePassword, auth:createUser,
 *          auth:listUsers, auth:updateUser, auth:deleteUser
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const {
  getDatabase,
  getDefaultOrganization,
  getOrgLicense,
  getUserCount,
} = require('../../database/init.cjs');
const { LICENSE_TIER, checkDataLimit } = require('../../license/tiers.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  ipcMain.handle('auth:login', async (event, { email, password }) => {
    try {
      const lockoutStatus = shared.checkAccountLockout(email);
      if (lockoutStatus.locked) {
        shared.logAudit('login_blocked', 'User', null, null, `Login blocked: account locked for ${lockoutStatus.remainingTime} more minutes`, email, null);
        throw new Error(`Account temporarily locked due to too many failed attempts. Try again in ${lockoutStatus.remainingTime} minutes.`);
      }

      const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
      if (!user) {
        shared.recordFailedLogin(email);
        shared.logAudit('login_failed', 'User', null, null, 'Login failed: user not found', email, null);
        throw new Error('Invalid credentials');
      }

      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        shared.recordFailedLogin(email);
        shared.logAudit('login_failed', 'User', null, null, 'Login failed: invalid password', email, null);
        throw new Error('Invalid credentials');
      }

      if (!user.org_id) {
        const defaultOrg = getDefaultOrganization();
        if (defaultOrg) {
          db.prepare('UPDATE users SET org_id = ? WHERE id = ?').run(defaultOrg.id, user.id);
          user.org_id = defaultOrg.id;
        } else {
          throw new Error('No organization configured. Please contact administrator.');
        }
      }

      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
      if (!org || org.status !== 'ACTIVE') {
        throw new Error('Your organization is not active. Please contact administrator.');
      }

      const license = getOrgLicense(user.org_id);
      const licenseTier = license?.tier || LICENSE_TIER.EVALUATION;

      shared.clearFailedLogins(email);

      const sessionId = uuidv4();
      const expiresAtDate = new Date(Date.now() + shared.SESSION_DURATION_MS);
      db.prepare('INSERT INTO sessions (id, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)').run(
        sessionId, user.id, user.org_id, expiresAtDate.toISOString()
      );

      db.prepare("UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(user.id);

      const currentUser = {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        org_id: user.org_id,
        org_name: org.name,
        license_tier: licenseTier,
      };

      shared.setSessionState(sessionId, currentUser, expiresAtDate.getTime());
      shared.logAudit('login', 'User', user.id, null, 'User logged in successfully', user.email, user.role);

      return { success: true, user: currentUser };
    } catch (error) {
      const safeMessage =
        error.message.includes('locked') ||
        error.message === 'Invalid credentials' ||
        error.message.includes('organization')
          ? error.message
          : 'Authentication failed';
      throw new Error(safeMessage);
    }
  });

  ipcMain.handle('auth:logout', async () => {
    const { currentSession, currentUser } = shared.getSessionState();
    if (currentSession) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(currentSession);
      shared.logAudit('logout', 'User', currentUser?.id, null, 'User logged out', currentUser?.email, currentUser?.role);
    }
    shared.clearSession();
    return { success: true };
  });

  ipcMain.handle('auth:me', async () => {
    if (!shared.validateSession()) {
      shared.clearSession();
      throw new Error('Session expired. Please log in again.');
    }
    return shared.getSessionState().currentUser;
  });

  ipcMain.handle('auth:isAuthenticated', async () => shared.validateSession());

  ipcMain.handle('auth:register', async (event, userData) => {
    let defaultOrg = getDefaultOrganization();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const { currentUser } = shared.getSessionState();

    if (userCount.count > 0 && (!currentUser || currentUser.role !== 'admin')) {
      throw new Error('Registration not allowed. Please contact administrator.');
    }

    if (!defaultOrg) {
      const { createDefaultOrganization } = require('../../database/init.cjs');
      defaultOrg = createDefaultOrganization();
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
      throw new Error('Invalid email format');
    }

    const passwordValidation = shared.validatePasswordStrength(userData.password);
    if (!passwordValidation.valid) {
      throw new Error(`Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }

    if (!userData.full_name || userData.full_name.trim().length < 2) {
      throw new Error('Full name must be at least 2 characters');
    }

    const hashedPassword = await bcrypt.hash(userData.password, 12);
    const userId = uuidv4();
    const now = new Date().toISOString();
    const orgId = currentUser?.org_id || defaultOrg.id;

    db.prepare(
      'INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, orgId, userData.email, hashedPassword, userData.full_name.trim(), userData.role || 'admin', 1, now, now);

    shared.logAudit('create', 'User', userId, null, 'User registered', userData.email, userData.role || 'admin');
    return { success: true, id: userId };
  });

  ipcMain.handle('auth:changePassword', async (event, { currentPassword, newPassword }) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();

    const passwordValidation = shared.validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      throw new Error(`Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUser.id);
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) throw new Error('Current password is incorrect');

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hashedPassword, currentUser.id);

    shared.logAudit('update', 'User', currentUser.id, null, 'Password changed', currentUser.email, currentUser.role);
    return { success: true };
  });

  ipcMain.handle('auth:createUser', async (event, userData) => {
    const { currentUser } = shared.getSessionState();
    if (!shared.validateSession() || currentUser.role !== 'admin') {
      throw new Error('Unauthorized: Admin access required');
    }

    const orgId = shared.getSessionOrgId();
    const userCount = getUserCount(orgId);
    const tier = shared.getSessionTier();
    const limitCheck = checkDataLimit(tier, 'maxUsers', userCount);
    if (!limitCheck.allowed) {
      throw new Error(`User limit reached (${limitCheck.limit}). Please upgrade your license to add more users.`);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
      throw new Error('Invalid email format');
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE org_id = ? AND email = ?').get(orgId, userData.email);
    if (existingUser) {
      throw new Error('A user with this email already exists in your organization.');
    }

    const passwordValidation = shared.validatePasswordStrength(userData.password);
    if (!passwordValidation.valid) {
      throw new Error(`Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }

    const hashedPassword = await bcrypt.hash(userData.password, 12);
    const userId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(
      'INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, orgId, userData.email, hashedPassword, userData.full_name, userData.role || 'user', 1, now, now);

    shared.logAudit('create', 'User', userId, null, 'User created', currentUser.email, currentUser.role);
    return { success: true, id: userId };
  });

  ipcMain.handle('auth:listUsers', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return db.prepare('SELECT id, email, full_name, role, is_active, created_at, last_login FROM users WHERE org_id = ? ORDER BY created_at DESC').all(orgId);
  });

  ipcMain.handle('auth:updateUser', async (event, id, userData) => {
    const { currentUser } = shared.getSessionState();
    if (!shared.validateSession() || (currentUser.role !== 'admin' && currentUser.id !== id)) {
      throw new Error('Unauthorized');
    }

    const updates = [];
    const values = [];

    if (userData.full_name !== undefined) {
      updates.push('full_name = ?');
      values.push(userData.full_name);
    }
    if (userData.role !== undefined && currentUser.role === 'admin') {
      const validRoles = ['admin', 'coordinator', 'physician', 'user', 'viewer', 'regulator'];
      if (!validRoles.includes(userData.role)) throw new Error('Invalid role specified');
      updates.push('role = ?');
      values.push(userData.role);
    }
    if (userData.is_active !== undefined && currentUser.role === 'admin') {
      updates.push('is_active = ?');
      values.push(userData.is_active ? 1 : 0);
      if (!userData.is_active) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        shared.logAudit('session_invalidated', 'User', id, null, 'User sessions invalidated due to account deactivation', currentUser.email, currentUser.role);
      }
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      shared.logAudit('update', 'User', id, null, 'User updated', currentUser.email, currentUser.role);
    }
    return { success: true };
  });

  ipcMain.handle('auth:deleteUser', async (event, id) => {
    const { currentUser } = shared.getSessionState();
    if (!shared.validateSession() || currentUser.role !== 'admin') {
      throw new Error('Unauthorized: Admin access required');
    }
    if (id === currentUser.id) throw new Error('Cannot delete your own account');

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    shared.logAudit('delete', 'User', id, null, 'User deleted', currentUser.email, currentUser.role);
    return { success: true };
  });
}

module.exports = { register };
