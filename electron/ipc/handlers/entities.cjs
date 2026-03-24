/**
 * TransTrack - Entity CRUD IPC Handlers
 * Handles: entity:create, entity:get, entity:update, entity:delete,
 *          entity:list, entity:filter, entity:lock, entity:unlock
 *
 * Security:
 *  - All handlers wrapped with wrapHandler() for standardized error handling
 *  - RBAC permission checks via accessControl.cjs
 *  - Optimistic concurrency control (version column)
 *  - Pessimistic row-level locking (locked_by/locked_at/lock_expires_at)
 *  - Input validation for Patient and DonorOrgan entities
 *  - Request-ID tracing via requestContext.cjs
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const { getDatabase, getPatientCount } = require('../../database/init.cjs');
const { checkDataLimit } = require('../../license/tiers.cjs');
const featureGate = require('../../license/featureGate.cjs');
const shared = require('../shared.cjs');
const { hasPermission, PERMISSIONS } = require('../../services/accessControl.cjs');
const { createContext, endContext } = require('../requestContext.cjs');

// =========================================================================
// RBAC PERMISSION MAPPING
// =========================================================================

/**
 * Map entity name + action to the required RBAC permission.
 * Returns null if no specific permission is defined (allows any authenticated user).
 */
function getRequiredPermission(entityName, action) {
  const map = {
    Patient: {
      create: PERMISSIONS.PATIENT_CREATE,
      view: PERMISSIONS.PATIENT_VIEW,
      update: PERMISSIONS.PATIENT_UPDATE,
      delete: PERMISSIONS.PATIENT_DELETE,
    },
    DonorOrgan: {
      create: PERMISSIONS.DONOR_CREATE,
      view: PERMISSIONS.DONOR_VIEW,
      update: PERMISSIONS.DONOR_UPDATE,
      delete: PERMISSIONS.DONOR_DELETE,
    },
    Match: {
      create: PERMISSIONS.MATCH_CREATE,
      view: PERMISSIONS.MATCH_VIEW,
      update: PERMISSIONS.MATCH_UPDATE,
      delete: PERMISSIONS.MATCH_UPDATE, // No separate delete perm; require update
    },
    AuditLog: {
      view: PERMISSIONS.AUDIT_VIEW,
    },
    Notification: {
      view: PERMISSIONS.PATIENT_VIEW, // Notifications visible to patient-viewers
      create: PERMISSIONS.PATIENT_UPDATE,
      update: PERMISSIONS.PATIENT_UPDATE,
      delete: PERMISSIONS.PATIENT_UPDATE,
    },
  };

  return map[entityName]?.[action] || null;
}

/**
 * Check if the current user has the required permission for the action.
 * Throws a standardized UNAUTHORIZED error if denied.
 */
function enforcePermission(currentUser, entityName, action) {
  const requiredPerm = getRequiredPermission(entityName, action);
  if (requiredPerm && !hasPermission(currentUser.role, requiredPerm)) {
    throw shared.createStandardError('UNAUTHORIZED', {
      requiredPermission: requiredPerm,
      userRole: currentUser.role,
      entityName,
      action,
    });
  }
}

// =========================================================================
// HANDLER REGISTRATION
// =========================================================================

function register() {
  const db = getDatabase();

  // =====================================================================
  // entity:create — Create a new entity
  // =====================================================================
  ipcMain.handle('entity:create', shared.wrapHandler(async (event, entityName, data) => {
    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const tableName = shared.entityTableMap[entityName];
      if (!tableName) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown entity: ${entityName}`);

      const orgId = shared.getSessionOrgId();
      const tier = shared.getSessionTier();

      // Block direct audit log creation
      if (entityName === 'AuditLog') throw shared.createStandardError('IMMUTABLE_RECORD', null, 'Audit logs cannot be created directly');

      // RBAC check
      enforcePermission(currentUser, entityName, 'create');

      // License limit enforcement
      try {
        if (entityName === 'Patient') {
          const currentCount = getPatientCount(orgId);
          const limitCheck = checkDataLimit(tier, 'maxPatients', currentCount);
          if (!limitCheck.allowed) throw shared.createStandardError('LICENSE_LIMIT', null, `Patient limit reached (${limitCheck.limit}). Please upgrade your license to add more patients.`);
        }
        if (entityName === 'DonorOrgan') {
          const currentCount = db.prepare('SELECT COUNT(*) as count FROM donor_organs WHERE org_id = ?').get(orgId).count;
          const limitCheck = checkDataLimit(tier, 'maxDonors', currentCount);
          if (!limitCheck.allowed) throw shared.createStandardError('LICENSE_LIMIT', null, `Donor limit reached (${limitCheck.limit}). Please upgrade your license to add more donors.`);
        }
        if (featureGate.isReadOnlyMode()) {
          throw shared.createStandardError('READ_ONLY_MODE');
        }
      } catch (licenseError) {
        const { app } = require('electron');
        const failOpen = !app.isPackaged && process.env.NODE_ENV === 'development' && process.env.LICENSE_FAIL_OPEN === 'true';
        if (!failOpen) throw licenseError;
        if (licenseError.message.includes('limit reached') || licenseError.message.includes('read-only mode')) throw licenseError;
      }

      // Input validation for known entity types
      if (entityName === 'Patient') {
        const validation = shared.validateEntityData(data, shared.PATIENT_VALIDATION_RULES);
        if (!validation.valid) {
          throw shared.createStandardError('VALIDATION_ERROR', { errors: validation.errors }, `Validation failed: ${validation.errors.join('; ')}`);
        }
      } else if (entityName === 'DonorOrgan') {
        const validation = shared.validateEntityData(data, shared.DONOR_VALIDATION_RULES);
        if (!validation.valid) {
          throw shared.createStandardError('VALIDATION_ERROR', { errors: validation.errors }, `Validation failed: ${validation.errors.join('; ')}`);
        }
      }

      const id = data.id || uuidv4();
      delete data.org_id;
      const entityData = shared.sanitizeForSQLite({
        ...data,
        id,
        org_id: orgId,
        version: 1, // Explicit version initialization for concurrency control
        created_by: currentUser.email,
      });

      const fields = Object.keys(entityData);
      const placeholders = fields.map(() => '?').join(', ');
      const values = fields.map(f => entityData[f]);

      try {
        db.prepare(`INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
      } catch (dbError) {
        if (dbError.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          if (entityName === 'Patient' && entityData.patient_id)
            throw shared.createStandardError('DUPLICATE_ENTRY', null, `A patient with ID "${entityData.patient_id}" already exists. Please use a unique Patient ID.`);
          if (entityName === 'DonorOrgan' && entityData.donor_id)
            throw shared.createStandardError('DUPLICATE_ENTRY', null, `A donor with ID "${entityData.donor_id}" already exists. Please use a unique Donor ID.`);
          throw shared.createStandardError('DUPLICATE_ENTRY', { originalError: dbError.message });
        }
        throw dbError;
      }

      let patientName = null;
      if (entityName === 'Patient') patientName = `${data.first_name} ${data.last_name}`;
      else if (data.patient_name) patientName = data.patient_name;

      shared.logAudit('create', entityName, id, patientName, `${entityName} created`, currentUser.email, currentUser.role, ctx.requestId);
      return shared.getEntityByIdAndOrg(tableName, id, orgId);
    } finally {
      endContext(ctx.requestId);
    }
  }));

  // =====================================================================
  // entity:get — Read a single entity by ID
  // =====================================================================
  ipcMain.handle('entity:get', shared.wrapHandler(async (event, entityName, id) => {
    const { currentUser } = shared.getSessionState();

    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown entity: ${entityName}`);

    // RBAC check
    enforcePermission(currentUser, entityName, 'view');

    const entity = shared.getEntityByIdAndOrg(tableName, id, shared.getSessionOrgId());
    if (!entity) throw shared.createStandardError('NOT_FOUND', null, `${entityName} not found or access denied`);
    return entity;
  }));

  // =====================================================================
  // entity:update — Update an existing entity with version control
  // =====================================================================
  ipcMain.handle('entity:update', shared.wrapHandler(async (event, entityName, id, data) => {
    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const tableName = shared.entityTableMap[entityName];
      if (!tableName) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown entity: ${entityName}`);
      const orgId = shared.getSessionOrgId();

      // Block audit log modification
      if (entityName === 'AuditLog') throw shared.createStandardError('IMMUTABLE_RECORD', null, 'Audit logs cannot be modified');

      // RBAC check
      enforcePermission(currentUser, entityName, 'update');

      const existingEntity = shared.getEntityByIdAndOrg(tableName, id, orgId);
      if (!existingEntity) throw shared.createStandardError('NOT_FOUND', null, `${entityName} not found or access denied`);

      // Input validation for known entity types
      if (entityName === 'Patient') {
        const validation = shared.validateEntityData(data, shared.PATIENT_VALIDATION_RULES);
        if (!validation.valid) {
          throw shared.createStandardError('VALIDATION_ERROR', { errors: validation.errors }, `Validation failed: ${validation.errors.join('; ')}`);
        }
      } else if (entityName === 'DonorOrgan') {
        const validation = shared.validateEntityData(data, shared.DONOR_VALIDATION_RULES);
        if (!validation.valid) {
          throw shared.createStandardError('VALIDATION_ERROR', { errors: validation.errors }, `Validation failed: ${validation.errors.join('; ')}`);
        }
      }

      const now = new Date().toISOString();
      const entityData = shared.sanitizeForSQLite({ ...data, updated_by: currentUser.email, updated_at: now });

      // Extract version for optimistic concurrency control
      const expectedVersion = entityData.version || existingEntity.version;
      delete entityData.id;
      delete entityData.org_id;
      delete entityData.created_at;
      delete entityData.created_date;
      delete entityData.created_by;
      delete entityData.locked_by;
      delete entityData.locked_at;
      delete entityData.lock_expires_at;

      // Use version-based concurrency control if entity has a version field
      if (existingEntity.version !== undefined && expectedVersion !== undefined) {
        shared.updateWithVersionCheck(tableName, id, orgId, entityData, expectedVersion);
      } else {
        // Fallback for entities without version column
        const updates = Object.keys(entityData).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(entityData), id, orgId];
        db.prepare(`UPDATE ${tableName} SET ${updates} WHERE id = ? AND org_id = ?`).run(...values);
      }

      const entity = shared.getEntityByIdAndOrg(tableName, id, orgId);
      let patientName = null;
      if (entityName === 'Patient') patientName = `${entity.first_name} ${entity.last_name}`;
      else if (entity.patient_name) patientName = entity.patient_name;

      shared.logAudit('update', entityName, id, patientName, `${entityName} updated`, currentUser.email, currentUser.role, ctx.requestId);
      return entity;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  // =====================================================================
  // entity:delete — Delete an entity
  // =====================================================================
  ipcMain.handle('entity:delete', shared.wrapHandler(async (event, entityName, id) => {
    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const tableName = shared.entityTableMap[entityName];
      if (!tableName) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown entity: ${entityName}`);
      const orgId = shared.getSessionOrgId();

      // Block audit log deletion
      if (entityName === 'AuditLog') throw shared.createStandardError('IMMUTABLE_RECORD', null, 'Audit logs cannot be deleted');

      // RBAC check
      enforcePermission(currentUser, entityName, 'delete');

      const entity = shared.getEntityByIdAndOrg(tableName, id, orgId);
      if (!entity) throw shared.createStandardError('NOT_FOUND', null, `${entityName} not found or access denied`);

      let patientName = null;
      if (entityName === 'Patient') patientName = `${entity.first_name} ${entity.last_name}`;
      else if (entity?.patient_name) patientName = entity.patient_name;

      db.prepare(`DELETE FROM ${tableName} WHERE id = ? AND org_id = ?`).run(id, orgId);
      shared.logAudit('delete', entityName, id, patientName, `${entityName} deleted`, currentUser.email, currentUser.role, ctx.requestId);
      return { success: true };
    } finally {
      endContext(ctx.requestId);
    }
  }));

  // =====================================================================
  // entity:list — List all entities of a type (org-scoped)
  // =====================================================================
  ipcMain.handle('entity:list', shared.wrapHandler(async (event, entityName, orderBy, limit) => {
    const { currentUser } = shared.getSessionState();

    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown entity: ${entityName}`);

    // RBAC check
    enforcePermission(currentUser, entityName, 'view');

    return shared.listEntitiesByOrg(tableName, shared.getSessionOrgId(), orderBy, limit);
  }));

  // =====================================================================
  // entity:filter — Filter entities with validated fields
  // =====================================================================
  ipcMain.handle('entity:filter', shared.wrapHandler(async (event, entityName, filters, orderBy, limit) => {
    const { currentUser } = shared.getSessionState();

    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown entity: ${entityName}`);

    // RBAC check
    enforcePermission(currentUser, entityName, 'view');

    const orgId = shared.getSessionOrgId();
    const allowedColumns = shared.ALLOWED_ORDER_COLUMNS[tableName] || [];

    let query = `SELECT * FROM ${tableName} WHERE org_id = ?`;
    const values = [orgId];

    if (filters && typeof filters === 'object') {
      delete filters.org_id;
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          // Strict validation: only allow columns explicitly listed in ALLOWED_ORDER_COLUMNS
          if (!allowedColumns.includes(key)) {
            throw shared.createStandardError('VALIDATION_ERROR', null, `Invalid filter field: ${key}`);
          }
          query += ` AND ${key} = ?`;
          values.push(value);
        }
      }
    }

    if (orderBy) {
      const desc = orderBy.startsWith('-');
      const field = desc ? orderBy.substring(1) : orderBy;
      if (!shared.isValidOrderColumn(tableName, field)) throw shared.createStandardError('VALIDATION_ERROR', null, `Invalid sort field: ${field}`);
      query += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
    } else {
      query += ' ORDER BY created_at DESC';
    }

    if (limit) {
      const parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 10000) {
        throw shared.createStandardError('VALIDATION_ERROR', null, 'Invalid limit value. Must be between 1 and 10000.');
      }
      query += ` LIMIT ${parsedLimit}`;
    }

    const rows = db.prepare(query).all(...values);
    return rows.map(shared.parseJsonFields);
  }));

  // =====================================================================
  // entity:lock — Acquire a pessimistic row lock
  // =====================================================================
  ipcMain.handle('entity:lock', shared.wrapHandler(async (event, entityName, id) => {
    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const tableName = shared.entityTableMap[entityName];
      if (!tableName) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown entity: ${entityName}`);

      // Only lockable entities
      const lockableTables = ['patients', 'donor_organs', 'matches'];
      if (!lockableTables.includes(tableName)) {
        throw shared.createStandardError('VALIDATION_ERROR', null, `Entity type '${entityName}' does not support row locking`);
      }

      // RBAC: require update permission to lock
      enforcePermission(currentUser, entityName, 'update');

      const orgId = shared.getSessionOrgId();
      shared.acquireRowLock(tableName, id, orgId, currentUser.id);

      shared.logAudit('lock_acquired', entityName, id, null,
        `Row lock acquired by ${currentUser.email}`, currentUser.email, currentUser.role, ctx.requestId);

      return {
        success: true,
        lockedBy: currentUser.id,
        lockedAt: new Date().toISOString(),
        lockExpiresAt: new Date(Date.now() + shared.ROW_LOCK_TIMEOUT_MS).toISOString(),
      };
    } finally {
      endContext(ctx.requestId);
    }
  }));

  // =====================================================================
  // entity:unlock — Release a pessimistic row lock
  // =====================================================================
  ipcMain.handle('entity:unlock', shared.wrapHandler(async (event, entityName, id) => {
    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });

    try {
      const tableName = shared.entityTableMap[entityName];
      if (!tableName) throw shared.createStandardError('VALIDATION_ERROR', null, `Unknown entity: ${entityName}`);

      const lockableTables = ['patients', 'donor_organs', 'matches'];
      if (!lockableTables.includes(tableName)) {
        throw shared.createStandardError('VALIDATION_ERROR', null, `Entity type '${entityName}' does not support row locking`);
      }

      const orgId = shared.getSessionOrgId();
      shared.releaseRowLock(tableName, id, orgId, currentUser.id);

      shared.logAudit('lock_released', entityName, id, null,
        `Row lock released by ${currentUser.email}`, currentUser.email, currentUser.role, ctx.requestId);

      return { success: true };
    } finally {
      endContext(ctx.requestId);
    }
  }));
}

module.exports = { register };
