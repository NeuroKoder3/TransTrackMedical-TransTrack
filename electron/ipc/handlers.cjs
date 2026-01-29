/**
 * TransTrack - IPC Handlers
 * 
 * Handles all communication between renderer and main process.
 * Implements secure data access with full audit logging.
 */

const { ipcMain, dialog } = require('electron');
const { getDatabase } = require('../database/init.cjs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const licenseManager = require('../license/manager.cjs');
const featureGate = require('../license/featureGate.cjs');
const { FEATURES, LICENSE_TIER } = require('../license/tiers.cjs');
const riskEngine = require('../services/riskEngine.cjs');
const accessControl = require('../services/accessControl.cjs');
const disasterRecovery = require('../services/disasterRecovery.cjs');
const complianceView = require('../services/complianceView.cjs');
const offlineReconciliation = require('../services/offlineReconciliation.cjs');
const readinessBarriers = require('../services/readinessBarriers.cjs');
const ahhqService = require('../services/ahhqService.cjs');

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
  User: 'users',
  ReadinessBarrier: 'readiness_barriers',
  AdultHealthHistoryQuestionnaire: 'adult_health_history_questionnaires'
};

// Fields that store JSON data
const jsonFields = ['priority_score_breakdown', 'conditions', 'notification_template', 'metadata', 'import_data', 'error_details', 'document_urls', 'identified_issues'];

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
      db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
      
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
    db.prepare("UPDATE users SET password_hash = ?, updated_date = datetime('now') WHERE id = ?")
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
      updates.push("updated_date = datetime('now')");
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
    
    // Prevent creation of audit logs via generic handler (HIPAA compliance)
    // Audit logs should only be created internally via logAudit function
    if (entityName === 'AuditLog') {
      throw new Error('Audit logs cannot be created directly');
    }
    
    // Check license limits for patients and donors
    // Wrapped in try-catch to ensure demo/dev mode works even if license module has issues
    try {
      if (entityName === 'Patient') {
        const currentCount = db.prepare('SELECT COUNT(*) as count FROM patients').get().count;
        const limitCheck = featureGate.canWithinLimit('maxPatients', currentCount);
        if (!limitCheck.allowed) {
          throw new Error(`Patient limit reached (${limitCheck.limit}). Please upgrade your license to add more patients.`);
        }
      }
      
      if (entityName === 'DonorOrgan') {
        const currentCount = db.prepare('SELECT COUNT(*) as count FROM donor_organs').get().count;
        const limitCheck = featureGate.canWithinLimit('maxDonors', currentCount);
        if (!limitCheck.allowed) {
          throw new Error(`Donor limit reached (${limitCheck.limit}). Please upgrade your license to add more donors.`);
        }
      }
      
      // Check write access (not in read-only mode)
      if (featureGate.isReadOnlyMode()) {
        throw new Error('Application is in read-only mode. Please activate or renew your license to make changes.');
      }
    } catch (licenseError) {
      // Log license check errors but don't block operations in development/demo
      console.warn('License check warning:', licenseError.message);
      // Only block if it's a limit/read-only error, not a license system error
      if (licenseError.message.includes('limit reached') || 
          licenseError.message.includes('read-only mode')) {
        throw licenseError;
      }
      // Otherwise, allow the operation to proceed (fail-open for dev/demo)
    }
    
    // Generate ID if not provided
    const id = data.id || uuidv4();
    const entityData = { ...data, id, created_by: currentUser.email };
    
    // Sanitize all values for SQLite compatibility
    // SQLite only accepts: numbers, strings, bigints, buffers, and null
    for (const field of Object.keys(entityData)) {
      const value = entityData[field];
      
      // Convert undefined to null
      if (value === undefined) {
        entityData[field] = null;
        continue;
      }
      
      // Convert booleans to integers (SQLite doesn't support booleans)
      if (typeof value === 'boolean') {
        entityData[field] = value ? 1 : 0;
        continue;
      }
      
      // Convert arrays and objects to JSON strings
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        entityData[field] = JSON.stringify(value);
        continue;
      }
      
      // Keep numbers, strings, bigints, buffers, and null as-is
    }
    
    // Build insert statement
    const fields = Object.keys(entityData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(f => entityData[f]);
    
    try {
      db.prepare(`INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    } catch (dbError) {
      // Provide user-friendly error messages for common database errors
      if (dbError.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (entityName === 'Patient' && entityData.patient_id) {
          throw new Error(`A patient with ID "${entityData.patient_id}" already exists. Please use a unique Patient ID.`);
        } else if (entityName === 'DonorOrgan' && entityData.donor_id) {
          throw new Error(`A donor with ID "${entityData.donor_id}" already exists. Please use a unique Donor ID.`);
        } else {
          throw new Error(`A ${entityName} with this identifier already exists.`);
        }
      }
      throw dbError;
    }
    
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
    
    // Sanitize all values for SQLite compatibility
    // SQLite only accepts: numbers, strings, bigints, buffers, and null
    for (const field of Object.keys(entityData)) {
      const value = entityData[field];
      
      // Convert undefined to null
      if (value === undefined) {
        entityData[field] = null;
        continue;
      }
      
      // Convert booleans to integers (SQLite doesn't support booleans)
      if (typeof value === 'boolean') {
        entityData[field] = value ? 1 : 0;
        continue;
      }
      
      // Convert arrays and objects to JSON strings
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        entityData[field] = JSON.stringify(value);
        continue;
      }
      
      // Keep numbers, strings, bigints, buffers, and null as-is
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
    
    const functions = require('../functions/index.cjs');
    
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
  
  // ===== OPERATIONAL RISK INTELLIGENCE =====
  ipcMain.handle('risk:getDashboard', async () => {
    return await riskEngine.getRiskDashboard();
  });
  
  ipcMain.handle('risk:getFullReport', async () => {
    return await riskEngine.generateOperationalRiskReport();
  });
  
  ipcMain.handle('risk:assessPatient', async (event, patientId) => {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new Error('Patient not found');
    return riskEngine.assessPatientOperationalRisk(patient);
  });
  
  // ===== READINESS BARRIERS (Non-Clinical Operational Tracking) =====
  // NOTE: This feature is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
  // operational workflow visibility only. It does NOT perform allocation decisions,
  // listing authority functions, or replace UNOS/OPTN systems.
  
  ipcMain.handle('barrier:getTypes', async () => {
    return readinessBarriers.BARRIER_TYPES;
  });
  
  ipcMain.handle('barrier:getStatuses', async () => {
    return readinessBarriers.BARRIER_STATUS;
  });
  
  ipcMain.handle('barrier:getRiskLevels', async () => {
    return readinessBarriers.BARRIER_RISK_LEVEL;
  });
  
  ipcMain.handle('barrier:getOwningRoles', async () => {
    return readinessBarriers.OWNING_ROLES;
  });
  
  ipcMain.handle('barrier:create', async (event, data) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    // Validate required fields
    if (!data.patient_id) throw new Error('Patient ID is required');
    if (!data.barrier_type) throw new Error('Barrier type is required');
    if (!data.owning_role) throw new Error('Owning role is required');
    
    // Validate notes length (max 255 chars, non-clinical only)
    if (data.notes && data.notes.length > 255) {
      throw new Error('Notes must be 255 characters or less');
    }
    
    const barrier = readinessBarriers.createBarrier(data, currentUser.id);
    
    // Get patient name for audit
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ?').get(data.patient_id);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
    
    logAudit(
      'create',
      'ReadinessBarrier',
      barrier.id,
      patientName,
      JSON.stringify({
        patient_id: data.patient_id,
        barrier_type: data.barrier_type,
        status: barrier.status,
        risk_level: barrier.risk_level,
        owning_role: barrier.owning_role,
      }),
      currentUser.email,
      currentUser.role
    );
    
    return barrier;
  });
  
  ipcMain.handle('barrier:update', async (event, id, data) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const existing = readinessBarriers.getBarrierById(id);
    if (!existing) throw new Error('Barrier not found');
    
    // Validate notes length
    if (data.notes && data.notes.length > 255) {
      throw new Error('Notes must be 255 characters or less');
    }
    
    const barrier = readinessBarriers.updateBarrier(id, data, currentUser.id);
    
    // Get patient name for audit
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ?').get(existing.patient_id);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
    
    // Log what changed
    const changes = {};
    if (data.status && data.status !== existing.status) changes.status = { from: existing.status, to: data.status };
    if (data.risk_level && data.risk_level !== existing.risk_level) changes.risk_level = { from: existing.risk_level, to: data.risk_level };
    if (data.barrier_type && data.barrier_type !== existing.barrier_type) changes.barrier_type = { from: existing.barrier_type, to: data.barrier_type };
    
    logAudit(
      'update',
      'ReadinessBarrier',
      id,
      patientName,
      JSON.stringify({
        patient_id: existing.patient_id,
        changes,
      }),
      currentUser.email,
      currentUser.role
    );
    
    return barrier;
  });
  
  ipcMain.handle('barrier:resolve', async (event, id) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const existing = readinessBarriers.getBarrierById(id);
    if (!existing) throw new Error('Barrier not found');
    
    const barrier = readinessBarriers.updateBarrier(id, { status: 'resolved' }, currentUser.id);
    
    // Get patient name for audit
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ?').get(existing.patient_id);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
    
    logAudit(
      'resolve',
      'ReadinessBarrier',
      id,
      patientName,
      JSON.stringify({
        patient_id: existing.patient_id,
        barrier_type: existing.barrier_type,
        resolved_by: currentUser.email,
      }),
      currentUser.email,
      currentUser.role
    );
    
    return barrier;
  });
  
  ipcMain.handle('barrier:delete', async (event, id) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    // Only admins can delete barriers (prefer resolving instead)
    if (currentUser.role !== 'admin') {
      throw new Error('Only administrators can delete barriers. Consider resolving the barrier instead.');
    }
    
    const existing = readinessBarriers.getBarrierById(id);
    if (!existing) throw new Error('Barrier not found');
    
    // Get patient name for audit
    const patient = db.prepare('SELECT first_name, last_name FROM patients WHERE id = ?').get(existing.patient_id);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : null;
    
    readinessBarriers.deleteBarrier(id);
    
    logAudit(
      'delete',
      'ReadinessBarrier',
      id,
      patientName,
      JSON.stringify({
        patient_id: existing.patient_id,
        barrier_type: existing.barrier_type,
        deleted_by: currentUser.email,
      }),
      currentUser.email,
      currentUser.role
    );
    
    return { success: true };
  });
  
  ipcMain.handle('barrier:getByPatient', async (event, patientId, includeResolved = false) => {
    if (!currentUser) throw new Error('Not authenticated');
    return readinessBarriers.getBarriersByPatientId(patientId, includeResolved);
  });
  
  ipcMain.handle('barrier:getPatientSummary', async (event, patientId) => {
    if (!currentUser) throw new Error('Not authenticated');
    return readinessBarriers.getPatientBarrierSummary(patientId);
  });
  
  ipcMain.handle('barrier:getAllOpen', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    return readinessBarriers.getAllOpenBarriers();
  });
  
  ipcMain.handle('barrier:getDashboard', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    return readinessBarriers.getBarriersDashboard();
  });
  
  ipcMain.handle('barrier:getAuditHistory', async (event, patientId, startDate, endDate) => {
    if (!currentUser) throw new Error('Not authenticated');
    return readinessBarriers.getBarrierAuditHistory(patientId, startDate, endDate);
  });
  
  // ===== ADULT HEALTH HISTORY QUESTIONNAIRE (aHHQ) =====
  // NOTE: This feature is strictly NON-CLINICAL, NON-ALLOCATIVE, and designed for
  // OPERATIONAL DOCUMENTATION purposes only. It tracks whether required health history
  // questionnaires are present, complete, and current. It does NOT store medical narratives,
  // clinical interpretations, or eligibility determinations.
  
  // Get aHHQ constants
  ipcMain.handle('ahhq:getStatuses', async () => {
    return ahhqService.AHHQ_STATUS;
  });
  
  ipcMain.handle('ahhq:getIssues', async () => {
    return ahhqService.AHHQ_ISSUES;
  });
  
  ipcMain.handle('ahhq:getOwningRoles', async () => {
    return ahhqService.AHHQ_OWNING_ROLES;
  });
  
  // Create aHHQ record
  ipcMain.handle('ahhq:create', async (event, data) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    // Validate notes length
    if (data.notes && data.notes.length > 255) {
      throw new Error('Notes must be 255 characters or less');
    }
    
    const result = ahhqService.createAHHQ(data, currentUser.id);
    
    // Audit log
    logAudit('create', 'AdultHealthHistoryQuestionnaire', result.id, null, 
      JSON.stringify({
        patient_id: data.patient_id,
        status: data.status,
        owning_role: data.owning_role,
        note: 'aHHQ record created (operational documentation tracking only)',
      }),
      currentUser.email, currentUser.role);
    
    return result;
  });
  
  // Get aHHQ by ID
  ipcMain.handle('ahhq:getById', async (event, id) => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getAHHQById(id);
  });
  
  // Get aHHQ for patient
  ipcMain.handle('ahhq:getByPatient', async (event, patientId) => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getAHHQByPatientId(patientId);
  });
  
  // Get patient aHHQ summary
  ipcMain.handle('ahhq:getPatientSummary', async (event, patientId) => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getPatientAHHQSummary(patientId);
  });
  
  // Get all aHHQs with filters
  ipcMain.handle('ahhq:getAll', async (event, filters) => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getAllAHHQs(filters);
  });
  
  // Get expiring aHHQs
  ipcMain.handle('ahhq:getExpiring', async (event, days) => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getExpiringAHHQs(days);
  });
  
  // Get expired aHHQs
  ipcMain.handle('ahhq:getExpired', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getExpiredAHHQs();
  });
  
  // Get incomplete aHHQs
  ipcMain.handle('ahhq:getIncomplete', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getIncompleteAHHQs();
  });
  
  // Update aHHQ
  ipcMain.handle('ahhq:update', async (event, id, data) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    // Validate notes length
    if (data.notes && data.notes.length > 255) {
      throw new Error('Notes must be 255 characters or less');
    }
    
    const existing = ahhqService.getAHHQById(id);
    const result = ahhqService.updateAHHQ(id, data, currentUser.id);
    
    // Audit log with changes
    const changes = {};
    if (data.status !== undefined && data.status !== existing.status) {
      changes.status = { from: existing.status, to: data.status };
    }
    if (data.owning_role !== undefined && data.owning_role !== existing.owning_role) {
      changes.owning_role = { from: existing.owning_role, to: data.owning_role };
    }
    
    logAudit('update', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({
        patient_id: existing.patient_id,
        changes,
        note: 'aHHQ record updated (operational documentation tracking only)',
      }),
      currentUser.email, currentUser.role);
    
    return result;
  });
  
  // Mark aHHQ complete
  ipcMain.handle('ahhq:markComplete', async (event, id, completedDate) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const existing = ahhqService.getAHHQById(id);
    const result = ahhqService.markAHHQComplete(id, completedDate, currentUser.id);
    
    logAudit('complete', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({
        patient_id: existing.patient_id,
        completed_date: completedDate || new Date().toISOString(),
        expiration_date: result.expiration_date,
        note: 'aHHQ marked complete (operational documentation tracking only)',
      }),
      currentUser.email, currentUser.role);
    
    return result;
  });
  
  // Mark aHHQ as requiring follow-up
  ipcMain.handle('ahhq:markFollowUpRequired', async (event, id, issues) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    const existing = ahhqService.getAHHQById(id);
    const result = ahhqService.markAHHQFollowUpRequired(id, issues, currentUser.id);
    
    logAudit('follow_up_required', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({
        patient_id: existing.patient_id,
        issues: issues,
        note: 'aHHQ marked as requiring follow-up (operational documentation tracking only)',
      }),
      currentUser.email, currentUser.role);
    
    return result;
  });
  
  // Delete aHHQ
  ipcMain.handle('ahhq:delete', async (event, id) => {
    if (!currentUser) throw new Error('Not authenticated');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    const existing = ahhqService.getAHHQById(id);
    
    logAudit('delete', 'AdultHealthHistoryQuestionnaire', id, null,
      JSON.stringify({
        patient_id: existing?.patient_id,
        note: 'aHHQ record deleted (operational documentation tracking only)',
      }),
      currentUser.email, currentUser.role);
    
    return ahhqService.deleteAHHQ(id);
  });
  
  // Get aHHQ dashboard metrics
  ipcMain.handle('ahhq:getDashboard', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getAHHQDashboard();
  });
  
  // Get patients with aHHQ issues
  ipcMain.handle('ahhq:getPatientsWithIssues', async (event, limit) => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getPatientsWithAHHQIssues(limit);
  });
  
  // Get aHHQ audit history
  ipcMain.handle('ahhq:getAuditHistory', async (event, patientId, startDate, endDate) => {
    if (!currentUser) throw new Error('Not authenticated');
    return ahhqService.getAHHQAuditHistory(patientId, startDate, endDate);
  });
  
  // ===== ACCESS CONTROL WITH JUSTIFICATION =====
  ipcMain.handle('access:validateRequest', async (event, permission, justification) => {
    if (!currentUser) throw new Error('Not authenticated');
    return accessControl.validateAccessRequest(currentUser.role, permission, justification);
  });
  
  ipcMain.handle('access:logJustifiedAccess', async (event, permission, entityType, entityId, justification) => {
    if (!currentUser) throw new Error('Not authenticated');
    return accessControl.logAccessWithJustification(
      db, currentUser.id, currentUser.email, currentUser.role,
      permission, entityType, entityId, justification
    );
  });
  
  ipcMain.handle('access:getRoles', async () => {
    return accessControl.getAllRoles();
  });
  
  ipcMain.handle('access:getJustificationReasons', async () => {
    return accessControl.JUSTIFICATION_REASONS;
  });
  
  // ===== DISASTER RECOVERY =====
  ipcMain.handle('recovery:createBackup', async (event, options) => {
    if (!currentUser) throw new Error('Not authenticated');
    return await disasterRecovery.createBackup({
      ...options,
      createdBy: currentUser.email,
    });
  });
  
  ipcMain.handle('recovery:listBackups', async () => {
    return disasterRecovery.listBackups();
  });
  
  ipcMain.handle('recovery:verifyBackup', async (event, backupId) => {
    return disasterRecovery.verifyBackup(backupId);
  });
  
  ipcMain.handle('recovery:restoreBackup', async (event, backupId) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required for restore');
    }
    return await disasterRecovery.restoreFromBackup(backupId, {
      restoredBy: currentUser.email,
    });
  });
  
  ipcMain.handle('recovery:getStatus', async () => {
    return disasterRecovery.getRecoveryStatus();
  });
  
  // ===== COMPLIANCE VIEW (READ-ONLY FOR REGULATORS) =====
  ipcMain.handle('compliance:getSummary', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_summary', 'Viewed compliance summary');
    return complianceView.getComplianceSummary();
  });
  
  ipcMain.handle('compliance:getAuditTrail', async (event, options) => {
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_audit', 'Viewed audit trail');
    return complianceView.getAuditTrailForCompliance(options);
  });
  
  ipcMain.handle('compliance:getDataCompleteness', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    return complianceView.getDataCompletenessReport();
  });
  
  ipcMain.handle('compliance:getValidationReport', async () => {
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_validation', 'Viewed validation report');
    return complianceView.generateValidationReport();
  });
  
  ipcMain.handle('compliance:getAccessLogs', async (event, options) => {
    if (!currentUser) throw new Error('Not authenticated');
    return complianceView.getAccessLogReport(options);
  });
  
  // ===== OFFLINE RECONCILIATION =====
  ipcMain.handle('reconciliation:getStatus', async () => {
    return offlineReconciliation.getReconciliationStatus();
  });
  
  ipcMain.handle('reconciliation:getPendingChanges', async () => {
    return offlineReconciliation.getPendingChanges();
  });
  
  ipcMain.handle('reconciliation:reconcile', async (event, strategy) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required');
    }
    return await offlineReconciliation.reconcilePendingChanges(strategy);
  });
  
  ipcMain.handle('reconciliation:setMode', async (event, mode) => {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required');
    }
    return offlineReconciliation.setOperationMode(mode);
  });
  
  ipcMain.handle('reconciliation:getMode', async () => {
    return offlineReconciliation.getOperationMode();
  });
  
  // ===== LICENSE MANAGEMENT =====
  
  // Get comprehensive license info
  ipcMain.handle('license:getInfo', async () => {
    return licenseManager.getLicenseInfo();
  });
  
  // Activate license with key
  ipcMain.handle('license:activate', async (event, key, customerInfo) => {
    if (!currentUser) throw new Error('Not authenticated');
    
    // Log attempt
    logAudit('license_activation_attempt', 'License', null, null, 
      `License activation attempted`, currentUser.email, currentUser.role);
    
    try {
      const result = await licenseManager.activateLicense(key, customerInfo);
      
      // Log success
      logAudit('license_activated', 'License', null, null, 
        `License activated: ${result.tierName}`, currentUser.email, currentUser.role);
      
      return result;
    } catch (error) {
      logAudit('license_activation_failed', 'License', null, null, 
        `License activation failed: ${error.message}`, currentUser.email, currentUser.role);
      throw error;
    }
  });
  
  // Renew maintenance
  ipcMain.handle('license:renewMaintenance', async (event, renewalKey, years) => {
    if (!currentUser) throw new Error('Not authenticated');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    const result = await licenseManager.renewMaintenance(renewalKey, years);
    
    logAudit('maintenance_renewed', 'License', null, null, 
      `Maintenance renewed for ${years} year(s)`, currentUser.email, currentUser.role);
    
    return result;
  });
  
  // Check if license is valid
  ipcMain.handle('license:isValid', async () => {
    return licenseManager.isLicenseValid();
  });
  
  // Get current license tier
  ipcMain.handle('license:getTier', async () => {
    return licenseManager.getCurrentTier();
  });
  
  // Get tier limits
  ipcMain.handle('license:getLimits', async () => {
    const tier = licenseManager.getCurrentTier();
    return licenseManager.getTierLimits(tier);
  });
  
  // Check feature access
  ipcMain.handle('license:checkFeature', async (event, feature) => {
    return featureGate.canAccessFeature(feature);
  });
  
  // Check limit
  ipcMain.handle('license:checkLimit', async (event, limitType, currentCount) => {
    return featureGate.canWithinLimit(limitType, currentCount);
  });
  
  // Get application state
  ipcMain.handle('license:getAppState', async () => {
    return featureGate.checkApplicationState();
  });
  
  // Get payment options
  ipcMain.handle('license:getPaymentOptions', async () => {
    return licenseManager.getAllPaymentOptions();
  });
  
  // Get payment info for specific tier
  ipcMain.handle('license:getPaymentInfo', async (event, tier) => {
    return licenseManager.getPaymentInfo(tier);
  });
  
  // Get organization info
  ipcMain.handle('license:getOrganization', async () => {
    return licenseManager.getOrganizationInfo();
  });
  
  // Update organization info
  ipcMain.handle('license:updateOrganization', async (event, updates) => {
    if (!currentUser) throw new Error('Not authenticated');
    if (currentUser.role !== 'admin') throw new Error('Admin access required');
    
    return licenseManager.updateOrganizationInfo(updates);
  });
  
  // Get maintenance status
  ipcMain.handle('license:getMaintenanceStatus', async () => {
    return licenseManager.getMaintenanceStatus();
  });
  
  // Get license audit history
  ipcMain.handle('license:getAuditHistory', async (event, limit) => {
    if (!currentUser) throw new Error('Not authenticated');
    return licenseManager.getLicenseAuditHistory(limit);
  });
  
  // Check if evaluation build
  ipcMain.handle('license:isEvaluationBuild', async () => {
    return licenseManager.isEvaluationBuild();
  });
  
  // Get evaluation status
  ipcMain.handle('license:getEvaluationStatus', async () => {
    return {
      isEvaluation: licenseManager.isEvaluationMode(),
      daysRemaining: licenseManager.getEvaluationDaysRemaining(),
      expired: licenseManager.isEvaluationExpired(),
      inGracePeriod: licenseManager.isInEvaluationGracePeriod(),
    };
  });
  
  // Get all features and their status
  ipcMain.handle('license:getAllFeatures', async () => {
    const tier = licenseManager.getCurrentTier();
    const allFeatures = Object.values(FEATURES);
    
    return allFeatures.map(feature => ({
      feature,
      ...featureGate.canAccessFeature(feature),
    }));
  });
  
  // Check full access (combined checks)
  ipcMain.handle('license:checkFullAccess', async (event, options) => {
    return featureGate.checkFullAccess(options);
  });
  
  // ===== FILE OPERATIONS =====
  ipcMain.handle('file:exportCSV', async (event, data, filename) => {
    // Check feature access for data export
    const exportCheck = featureGate.canAccessFeature(FEATURES.DATA_EXPORT);
    if (!exportCheck.allowed) {
      throw new Error('Data export is not available in your current license tier. Please upgrade to export data.');
    }
    
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
    const { backupDatabase } = require('../database/init.cjs');
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
