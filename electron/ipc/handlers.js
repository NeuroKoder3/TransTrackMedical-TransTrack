/**
 * TransTrack - IPC Handlers
 * 
 * Handles all communication between renderer and main process.
 * Implements secure data access with full audit logging.
 */

const { ipcMain, dialog } = require('electron');
const { getDatabase } = require('../database/init');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// Current session store
let currentSession = null;
let currentUser = null;

// Entity name to table name mapping
const entityTableMap = {
  Patient: 'patients',
  DonorOrgan: 'donor_organs',
  Match: 'matches',
  Notification: 'notifications',
  NotificationRule: 'notification_rules',
  PriorityWeights: 'priority_weights',
  EHRIntegration: 'ehr_integrations',
  EHRImport: 'ehr_imports',
  EHRSyncLog: 'ehr_sync_logs',
  EHRValidationRule: 'ehr_validation_rules',
  AuditLog: 'audit_logs',
  User: 'users'
};

// Fields that store JSON data
const jsonFields = ['priority_score_breakdown', 'conditions', 'notification_template', 'metadata', 'import_data', 'error_details'];

function setupIPCHandlers() {
  const db = getDatabase();
  
  // ===== APP INFO =====
  ipcMain.handle('app:getInfo', () => ({
    name: 'TransTrack',
    version: '1.0.0',
    compliance: ['HIPAA', 'FDA 21 CFR Part 11', 'AATB']
  }));
  
  ipcMain.handle('app:getVersion', () => '1.0.0');
  
  // ===== AUTHENTICATION =====
  ipcMain.handle('auth:login', async (event, { email, password }) => {
    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
      
      if (!user) {
        throw new Error('Invalid credentials');
      }
      
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        throw new Error('Invalid credentials');
      }
      
      // Create session
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
      
      db.prepare(`
        INSERT INTO sessions (id, user_id, expires_at)
        VALUES (?, ?, ?)
      `).run(sessionId, user.id, expiresAt);
      
      // Update last login
      db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(user.id);
      
      // Store current session
      currentSession = sessionId;
      currentUser = {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      };
      
      // Log login
      logAudit('login', 'User', user.id, null, 'User logged in', user.email, user.role);
      
      return { success: true, user: currentUser };
    } catch (error) {
      logAudit('login_failed', 'User', null, null, `Login failed: ${error.message}`, email, null);
      throw error;
    }
  });
  
  ipcMain.handle('auth:logout', async () => {
    if (currentSession) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(currentSession);
      logAudit('logout', 'User', currentUser?.id, null, 'User logged out', currentUser?.email, currentUser?.role);
    }
    currentSession = null;
    currentUser = null;
    return { success: true };
  });
  
  ipcMain.handle('auth:me', async () => {
    if (!currentUser) {
      throw new Error('Not authenticated');
    }
    return currentUser;
  });
  
  ipcMain.handle('auth:isAuthenticated', async () => {
    return !!currentUser;
  });
  
  ipcMain.handle('auth:register', async (event, userData) => {
    // Check if registration is allowed
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    
    // Only allow registration if no users exist or if called by admin
    if (userCount.count > 0 && (!currentUser || currentUser.role !== 'admin')) {
      throw new Error('Registration not allowed. Please contact administrator.');
    }
    
    const hashedPassword = await bcrypt.hash(userData.password, 12);
    const userId = uuidv4();
    
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, userData.email, hashedPassword, userData.full_name, userData.role || 'user');
    
    logAudit('create', 'User', userId, null, 'User registered', userData.email, userData.role || 'user');
    
    return { success: true, id: userId };
  });
  
  ipcMain.handle('auth:changePassword', async (event, { currentPassword, newPassword }) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUser.id);
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_date = datetime("now") WHERE id = ?')
      .run(hashedPassword, currentUser.id);
    
    logAudit('update', 'User', currentUser.id, null, 'Password changed', currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  ipcMain.handle('auth:createUser', async (event, userData) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Unauthorized: Admin access required');
    }
    
    const hashedPassword = await bcrypt.hash(userData.password, 12);
    const userId = uuidv4();
    
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, userData.email, hashedPassword, userData.full_name, userData.role || 'user', 1);
    
    logAudit('create', 'User', userId, null, `User created: ${userData.email}`, currentUser.email, currentUser.role);
    
    return { success: true, id: userId };
  });
  
  ipcMain.handle('auth:listUsers', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const users = db.prepare(`
      SELECT id, email, full_name, role, is_active, created_date, last_login
      FROM users
      ORDER BY created_date DESC
    `).all();
    
    return users;
  });
  
  ipcMain.handle('auth:updateUser', async (event, id, userData) => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.id !== id)) {
      throw new Error('Unauthorized');
    }
    
    const updates = [];
    const values = [];
    
    if (userData.full_name !== undefined) {
      updates.push('full_name = ?');
      values.push(userData.full_name);
    }
    if (userData.role !== undefined && currentUser.role === 'admin') {
      updates.push('role = ?');
      values.push(userData.role);
    }
    if (userData.is_active !== undefined && currentUser.role === 'admin') {
      updates.push('is_active = ?');
      values.push(userData.is_active ? 1 : 0);
    }
    
    if (updates.length > 0) {
      updates.push('updated_date = datetime("now")');
      values.push(id);
      
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      logAudit('update', 'User', id, null, 'User updated', currentUser.email, currentUser.role);
    }
    
    return { success: true };
  });
  
  ipcMain.handle('auth:deleteUser', async (event, id) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Unauthorized: Admin access required');
    }
    
    if (id === currentUser.id) {
      throw new Error('Cannot delete your own account');
    }
    
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    
    logAudit('delete', 'User', id, null, `User deleted: ${user?.email}`, currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  // ===== ENTITY OPERATIONS =====
  ipcMain.handle('entity:create', async (event, entityName, data) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // Generate ID if not provided
    const id = data.id || uuidv4();
    const entityData = { ...data, id, created_by: currentUser.email };
    
    // Convert JSON fields to strings
    for (const field of jsonFields) {
      if (entityData[field] && typeof entityData[field] === 'object') {
        entityData[field] = JSON.stringify(entityData[field]);
      }
    }
    
    // Build insert statement
    const fields = Object.keys(entityData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(f => entityData[f]);
    
    db.prepare(`INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    
    // Get patient name for audit log
    let patientName = null;
    if (entityName === 'Patient') {
      patientName = `${data.first_name} ${data.last_name}`;
    } else if (data.patient_name) {
      patientName = data.patient_name;
    }
    
    logAudit('create', entityName, id, patientName, `${entityName} created`, currentUser.email, currentUser.role);
    
    // Return created entity
    return getEntityById(tableName, id);
  });
  
  ipcMain.handle('entity:get', async (event, entityName, id) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    return getEntityById(tableName, id);
  });
  
  ipcMain.handle('entity:update', async (event, entityName, id, data) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // Prevent modification of audit logs (HIPAA compliance)
    if (entityName === 'AuditLog') {
      throw new Error('Audit logs cannot be modified');
    }
    
    const entityData = { ...data, updated_by: currentUser.email, updated_date: new Date().toISOString() };
    delete entityData.id;
    delete entityData.created_date;
    delete entityData.created_by;
    
    // Convert JSON fields to strings
    for (const field of jsonFields) {
      if (entityData[field] && typeof entityData[field] === 'object') {
        entityData[field] = JSON.stringify(entityData[field]);
      }
    }
    
    // Build update statement
    const updates = Object.keys(entityData).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(entityData), id];
    
    db.prepare(`UPDATE ${tableName} SET ${updates} WHERE id = ?`).run(...values);
    
    // Get patient name for audit log
    const entity = getEntityById(tableName, id);
    let patientName = null;
    if (entityName === 'Patient') {
      patientName = `${entity.first_name} ${entity.last_name}`;
    } else if (entity.patient_name) {
      patientName = entity.patient_name;
    }
    
    logAudit('update', entityName, id, patientName, `${entityName} updated`, currentUser.email, currentUser.role);
    
    return entity;
  });
  
  ipcMain.handle('entity:delete', async (event, entityName, id) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    // Prevent deletion of audit logs (HIPAA compliance)
    if (entityName === 'AuditLog') {
      throw new Error('Audit logs cannot be deleted');
    }
    
    // Get entity for audit log before deletion
    const entity = getEntityById(tableName, id);
    let patientName = null;
    if (entityName === 'Patient' && entity) {
      patientName = `${entity.first_name} ${entity.last_name}`;
    } else if (entity?.patient_name) {
      patientName = entity.patient_name;
    }
    
    db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
    
    logAudit('delete', entityName, id, patientName, `${entityName} deleted`, currentUser.email, currentUser.role);
    
    return { success: true };
  });
  
  ipcMain.handle('entity:list', async (event, entityName, orderBy, limit) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    let query = `SELECT * FROM ${tableName}`;
    
    // Handle ordering
    if (orderBy) {
      const desc = orderBy.startsWith('-');
      const field = desc ? orderBy.substring(1) : orderBy;
      query += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
    } else {
      query += ' ORDER BY created_date DESC';
    }
    
    // Handle limit
    if (limit) {
      query += ` LIMIT ${parseInt(limit)}`;
    }
    
    const rows = db.prepare(query).all();
    return rows.map(row => parseJsonFields(row));
  });
  
  ipcMain.handle('entity:filter', async (event, entityName, filters, orderBy, limit) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const tableName = entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    
    let query = `SELECT * FROM ${tableName}`;
    const conditions = [];
    const values = [];
    
    // Build WHERE clause
    if (filters && typeof filters === 'object') {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          conditions.push(`${key} = ?`);
          values.push(value);
        }
      }
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    // Handle ordering
    if (orderBy) {
      const desc = orderBy.startsWith('-');
      const field = desc ? orderBy.substring(1) : orderBy;
      query += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
    } else {
      query += ' ORDER BY created_date DESC';
    }
    
    // Handle limit
    if (limit) {
      query += ` LIMIT ${parseInt(limit)}`;
    }
    
    const rows = db.prepare(query).all(...values);
    return rows.map(row => parseJsonFields(row));
  });
  
  // ===== FUNCTIONS (Business Logic) =====
  ipcMain.handle('function:invoke', async (event, functionName, params) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const functions = require('../functions');
    
    if (!functions[functionName]) {
      throw new Error(`Unknown function: ${functionName}`);
    }
    
    const result = await functions[functionName](params, { db, currentUser, logAudit });
    return result;
  });
  
  // ===== SETTINGS =====
  ipcMain.handle('settings:get', async (event, key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  });
  
  ipcMain.handle('settings:set', async (event, key, value) => {
    db.prepare(`
      INSERT INTO settings (key, value, updated_date)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_date = datetime('now')
    `).run(key, JSON.stringify(value), JSON.stringify(value));
    return { success: true };
  });
  
  ipcMain.handle('settings:getAll', async () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = JSON.parse(row.value);
    }
    return settings;
  });
  
  // ===== FILE OPERATIONS =====
  ipcMain.handle('file:exportCSV', async (event, data, filename) => {
    const { dialog } = require('electron');
    const fs = require('fs');
    
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export CSV',
      defaultPath: filename,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });
    
    if (filePath) {
      // Convert data to CSV
      if (data.length === 0) {
        fs.writeFileSync(filePath, '');
      } else {
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => 
          Object.values(row).map(v => 
            typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
          ).join(',')
        );
        fs.writeFileSync(filePath, [headers, ...rows].join('\n'));
      }
      
      logAudit('export', 'System', null, null, `CSV exported: ${filename}`, currentUser.email, currentUser.role);
      return { success: true, path: filePath };
    }
    
    return { success: false };
  });
  
  ipcMain.handle('file:backupDatabase', async (event, targetPath) => {
    const { backupDatabase } = require('../database/init');
    await backupDatabase(targetPath);
    return { success: true };
  });
  
  // Helper functions
  function getEntityById(tableName, id) {
    const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
    return row ? parseJsonFields(row) : null;
  }
  
  function parseJsonFields(row) {
    if (!row) return row;
    const parsed = { ...row };
    for (const field of jsonFields) {
      if (parsed[field] && typeof parsed[field] === 'string') {
        try {
          parsed[field] = JSON.parse(parsed[field]);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
    }
    return parsed;
  }
  
  function logAudit(action, entityType, entityId, patientName, details, userEmail, userRole) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO audit_logs (id, action, entity_type, entity_id, patient_name, details, user_email, user_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, action, entityType, entityId, patientName, details, userEmail, userRole);
  }
}

module.exports = { setupIPCHandlers };
