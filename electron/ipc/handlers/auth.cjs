/**
 * TransTrack - Authentication IPC Handlers
 * Handles: auth:login, auth:logout, auth:me, auth:isAuthenticated,
 *          auth:register, auth:changePassword, auth:createUser,
 *          auth:listUsers, auth:updateUser, auth:deleteUser
 *
 * Security:
 *  - Standardized error handling via createStandardError
 *  - Account lockout after MAX_LOGIN_ATTEMPTS
 *  - Password strength validation
 *  - Request-ID tracing for audit logs
 *  - Org-scoped user management
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
const { createContext, endContext } = require('../requestContext.cjs');

function register() {
  const db = getDatabase();

  // =====================================================================
  // auth:login — No wrapHandler (session doesn't exist yet)
  // =====================================================================
  ipcMain.handle('auth:login', async (event, { email, password }) => {
    const ctx = createContext({ userEmail: email });
    try {
      const lockoutStatus = shared.checkAccountLockout(email);
      if (lockoutStatus.locked) {
        shared.logAudit('login_blocked', 'User', null, null, `Login blocked: account locked for ${lockoutStatus.remainingTime} more minutes`, email, null, ctx.requestId);
        throw shared.createStandardError('ACCOUNT_LOCKED', { remainingMinutes: lockoutStatus.remainingTime },
          `Account temporarily locked due to too many failed attempts. Try again in ${lockoutStatus.remainingTime} minutes.`);
      }

      const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
      if (!user) {
        shared.recordFailedLogin(email);
        shared.logAudit('login_failed', 'User', null, null, 'Login failed: user not found', email, null, ctx.requestId);
        throw shared.createStandardError('INVALID_CREDENTIALS');
      }

      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        shared.recordFailedLogin(email);
        shared.logAudit('login_failed', 'User', null, null, 'Login failed: invalid password', email, null, ctx.requestId);
        throw shared.createStandardError('INVALID_CREDENTIALS');
      }

      if (!user.org_id) {
        const defaultOrg = getDefaultOrganization();
        if (defaultOrg) {
          db.prepare('UPDATE users SET org_id = ? WHERE id = ?').run(defaultOrg.id, user.id);
          user.org_id = defaultOrg.id;
        } else {
          throw shared.createStandardError('ORG_REQUIRED', null, 'No organization configured. Please contact administrator.');
        }
      }

      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
      if (!org || org.status !== 'ACTIVE') {
        throw shared.createStandardError('UNAUTHORIZED', null, 'Your organization is not active. Please contact administrator.');
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
      shared.logAudit('login', 'User', user.id, null, 'User logged in successfully', user.email, user.role, ctx.requestId);

      return { success: true, user: currentUser };
    } catch (error) {
      // If it's already a standard error, pass it through
      if (error.code && shared.ERROR_CODES[error.code]) {
        throw error;
      }
      // Wrap unknown errors safely (don't leak internal details)
      const safeMessage =
        error.message.includes('locked') ||
        error.message === 'Invalid credentials' ||
        error.message.includes('organization')
          ? error.message
          : 'Authentication failed';
      throw new Error(safeMessage);
    } finally {
      endContext(ctx.requestId);
    }
  });

  // =====================================================================
  // auth:logout
  // =====================================================================
  ipcMain.handle('auth:logout', async () => {
    const { currentSession, currentUser } = shared.getSessionState();
    if (currentSession) {
      const ctx = createContext({ orgId: currentUser?.org_id, userId: currentUser?.id, userEmail: currentUser?.email, userRole: currentUser?.role });
      try {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(currentSession);
        shared.logAudit('logout', 'User', currentUser?.id, null, 'User logged out', currentUser?.email, currentUser?.role, ctx.requestId);
      } finally {
        endContext(ctx.requestId);
      }
    }
    shared.clearSession();
    return { success: true };
  });

  // =====================================================================
  // auth:me
  // =====================================================================
  ipcMain.handle('auth:me', async () => {
    if (!shared.validateSession()) {
      shared.clearSession();
      throw shared.createStandardError('SESSION_EXPIRED');
    }
    return shared.getSessionState().currentUser;
  });

  ipcMain.handle('auth:isAuthenticated', async () => shared.validateSession());

  // =====================================================================
  // auth:register
  // =====================================================================
  ipcMain.handle('auth:register', async (event, userData) => {
    let defaultOrg = getDefaultOrganization();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const { currentUser } = shared.getSessionState();

    if (userCount.count > 0 && (!currentUser || currentUser.role !== 'admin')) {
      throw shared.createStandardError('UNAUTHORIZED', null, 'Registration not allowed. Please contact administrator.');
    }

    if (!defaultOrg) {
      const { createDefaultOrganization } = require('../../database/init.cjs');
      defaultOrg = createDefaultOrganization();
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
      throw shared.createStandardError('VALIDATION_ERROR', null, 'Invalid email format');
    }

    const passwordValidation = shared.validatePasswordStrength(userData.password);
    if (!passwordValidation.valid) {
      throw shared.createStandardError('VALIDATION_ERROR', { errors: passwordValidation.errors },
        `Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }

    if (!userData.full_name || userData.full_name.trim().length < 2) {
      throw shared.createStandardError('VALIDATION_ERROR', null, 'Full name must be at least 2 characters');
    }

    const ctx = createContext({ orgId: currentUser?.org_id || defaultOrg.id, userEmail: userData.email });
    try {
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      const userId = uuidv4();
      const now = new Date().toISOString();
      const orgId = currentUser?.org_id || defaultOrg.id;

      db.prepare(
        'INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(userId, orgId, userData.email, hashedPassword, userData.full_name.trim(), userData.role || 'admin', 1, now, now);

      shared.logAudit('create', 'User', userId, null, 'User registered', userData.email, userData.role || 'admin', ctx.requestId);
      return { success: true, id: userId };
    } finally {
      endContext(ctx.requestId);
    }
  });

  // =====================================================================
  // auth:changePassword
  // =====================================================================
  ipcMain.handle('auth:changePassword', shared.wrapHandler(async (event, { currentPassword, newPassword }) => {
    const { currentUser } = shared.getSessionState();

    const passwordValidation = shared.validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      throw shared.createStandardError('VALIDATION_ERROR', { errors: passwordValidation.errors },
        `Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUser.id);
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) throw shared.createStandardError('INVALID_CREDENTIALS', null, 'Current password is incorrect');

    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hashedPassword, currentUser.id);
      shared.logAudit('update', 'User', currentUser.id, null, 'Password changed', currentUser.email, currentUser.role, ctx.requestId);
      return { success: true };
    } finally {
      endContext(ctx.requestId);
    }
  }));

  // =====================================================================
  // auth:createUser
  // =====================================================================
  ipcMain.handle('auth:createUser', shared.wrapHandler(async (event, userData) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED');

    const orgId = shared.getSessionOrgId();
    const userCount = getUserCount(orgId);
    const tier = shared.getSessionTier();
    const limitCheck = checkDataLimit(tier, 'maxUsers', userCount);
    if (!limitCheck.allowed) {
      throw shared.createStandardError('LICENSE_LIMIT', null, `User limit reached (${limitCheck.limit}). Please upgrade your license to add more users.`);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
      throw shared.createStandardError('VALIDATION_ERROR', null, 'Invalid email format');
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE org_id = ? AND email = ?').get(orgId, userData.email);
    if (existingUser) throw shared.createStandardError('DUPLICATE_ENTRY', null, 'A user with this email already exists in your organization.');

    const passwordValidation = shared.validatePasswordStrength(userData.password);
    if (!passwordValidation.valid) {
      throw shared.createStandardError('VALIDATION_ERROR', { errors: passwordValidation.errors },
        `Password requirements not met: ${passwordValidation.errors.join(', ')}`);
    }

    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      const hashedPassword = await bcrypt.hash(userData.password, 12);
      const userId = uuidv4();
      const now = new Date().toISOString();

      db.prepare(
        'INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(userId, orgId, userData.email, hashedPassword, userData.full_name, userData.role || 'user', 1, now, now);

      shared.logAudit('create', 'User', userId, null, 'User created', currentUser.email, currentUser.role, ctx.requestId);
      return { success: true, id: userId };
    } finally {
      endContext(ctx.requestId);
    }
  }));

  // =====================================================================
  // auth:listUsers — org-scoped
  // =====================================================================
  ipcMain.handle('auth:listUsers', shared.wrapHandler(async () => {
    const orgId = shared.getSessionOrgId();
    return db.prepare('SELECT id, email, full_name, role, is_active, created_at, last_login FROM users WHERE org_id = ? ORDER BY created_at DESC').all(orgId);
  }));

  // =====================================================================
  // auth:updateUser
  // =====================================================================
  ipcMain.handle('auth:updateUser', shared.wrapHandler(async (event, id, userData) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin' && currentUser.id !== id) {
      throw shared.createStandardError('UNAUTHORIZED');
    }

    const orgId = shared.getSessionOrgId();

    // Verify user belongs to same org
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ? AND org_id = ?').get(id, orgId);
    if (!targetUser) throw shared.createStandardError('NOT_FOUND', null, 'User not found or access denied');

    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      const updates = [];
      const values = [];

      if (userData.full_name !== undefined) {
        updates.push('full_name = ?');
        values.push(userData.full_name);
      }
      if (userData.role !== undefined && currentUser.role === 'admin') {
        const validRoles = ['admin', 'coordinator', 'physician', 'user', 'viewer', 'regulator'];
        if (!validRoles.includes(userData.role)) throw shared.createStandardError('VALIDATION_ERROR', null, 'Invalid role specified');
        updates.push('role = ?');
        values.push(userData.role);
      }
      if (userData.is_active !== undefined && currentUser.role === 'admin') {
        updates.push('is_active = ?');
        values.push(userData.is_active ? 1 : 0);
        if (!userData.is_active) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
          shared.logAudit('session_invalidated', 'User', id, null, 'User sessions invalidated due to account deactivation', currentUser.email, currentUser.role, ctx.requestId);
        }
      }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        values.push(id, orgId);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`).run(...values);
        shared.logAudit('update', 'User', id, null, 'User updated', currentUser.email, currentUser.role, ctx.requestId);
      }
      return { success: true };
    } finally {
      endContext(ctx.requestId);
    }
  }));

  // =====================================================================
  // auth:deleteUser — org-scoped
  // =====================================================================
  ipcMain.handle('auth:deleteUser', shared.wrapHandler(async (event, id) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED');
    if (id === currentUser.id) throw shared.createStandardError('VALIDATION_ERROR', null, 'Cannot delete your own account');

    const orgId = shared.getSessionOrgId();

    // Verify user belongs to same org
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ? AND org_id = ?').get(id, orgId);
    if (!targetUser) throw shared.createStandardError('NOT_FOUND', null, 'User not found or access denied');

    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ? AND org_id = ?').run(id, orgId);
      shared.logAudit('delete', 'User', id, null, 'User deleted', currentUser.email, currentUser.role, ctx.requestId);
      return { success: true };
    } finally {
      endContext(ctx.requestId);
    }
  }));
}

module.exports = { register };
