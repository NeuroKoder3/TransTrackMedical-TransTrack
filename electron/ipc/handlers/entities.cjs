/**
 * TransTrack - Entity CRUD IPC Handlers
 * Handles: entity:create, entity:get, entity:update, entity:delete,
 *          entity:list, entity:filter
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../../database/init.cjs');
const shared = require('../shared.cjs');
const { hasPermission, PERMISSIONS } = require('../../services/accessControl.cjs');
const { encryptField, isEncrypted } = require('../../services/secretEncryption.cjs');

/**
 * Columns that hold raw secrets we must transparently encrypt on write.
 * The label argument to encryptField scopes the HKDF subkey so per-row
 * key rotation is feasible later.
 */
const ENCRYPTED_FIELDS_BY_TABLE = {
  ehr_integrations: ['api_key_encrypted'],
};

function applyEncryptionToWrite(tableName, entityId, data) {
  const encryptedCols = ENCRYPTED_FIELDS_BY_TABLE[tableName];
  if (!encryptedCols) return data;
  for (const col of encryptedCols) {
    // Sentinel '__SET__' means the renderer is round-tripping a redacted
    // payload and does NOT want to overwrite the stored credential. Drop
    // the field entirely so the existing column value is preserved.
    if (data[col] === '__SET__') {
      delete data[col];
      continue;
    }
    if (data[col] !== undefined && data[col] !== null && data[col] !== '') {
      if (!isEncrypted(data[col])) {
        data[col] = encryptField(String(data[col]), `${tableName}:${entityId || 'new'}`);
      }
    }
  }
  return data;
}

/**
 * Redact encrypted columns before returning entities to the renderer.
 * The renderer never needs the cleartext — it only needs to know whether
 * a credential is configured. We swap the column value for a sentinel.
 */
function redactSecretsForRenderer(tableName, row) {
  if (!row) return row;
  const encryptedCols = ENCRYPTED_FIELDS_BY_TABLE[tableName];
  if (!encryptedCols) return row;
  const redacted = { ...row };
  for (const col of encryptedCols) {
    if (redacted[col]) {
      redacted[col] = '__SET__';
    } else {
      redacted[col] = null;
    }
  }
  return redacted;
}

const ENTITY_PERMISSION_MAP = {
  Patient:       { view: PERMISSIONS.PATIENT_VIEW, create: PERMISSIONS.PATIENT_CREATE, update: PERMISSIONS.PATIENT_UPDATE, delete: PERMISSIONS.PATIENT_DELETE },
  DonorOrgan:    { view: PERMISSIONS.DONOR_VIEW,   create: PERMISSIONS.DONOR_CREATE,   update: PERMISSIONS.DONOR_UPDATE,   delete: PERMISSIONS.DONOR_DELETE },
  Match:         { view: PERMISSIONS.MATCH_VIEW,    create: PERMISSIONS.MATCH_CREATE,   update: PERMISSIONS.MATCH_UPDATE,   delete: null },
  Notification:       { view: null, create: null, update: null, delete: null },
  NotificationRule:   { view: null, create: PERMISSIONS.SETTINGS_MANAGE, update: PERMISSIONS.SETTINGS_MANAGE, delete: PERMISSIONS.SETTINGS_MANAGE },
  PriorityWeights:    { view: null, create: PERMISSIONS.SETTINGS_MANAGE, update: PERMISSIONS.SETTINGS_MANAGE, delete: PERMISSIONS.SETTINGS_MANAGE },
  EHRIntegration:     { view: null, create: PERMISSIONS.SYSTEM_CONFIGURE, update: PERMISSIONS.SYSTEM_CONFIGURE, delete: PERMISSIONS.SYSTEM_CONFIGURE },
  EHRImport:          { view: null, create: PERMISSIONS.SYSTEM_CONFIGURE, update: null, delete: null },
  EHRSyncLog:         { view: null, create: null, update: null, delete: null },
  EHRValidationRule:  { view: null, create: PERMISSIONS.SYSTEM_CONFIGURE, update: PERMISSIONS.SYSTEM_CONFIGURE, delete: PERMISSIONS.SYSTEM_CONFIGURE },
  AuditLog:           { view: PERMISSIONS.AUDIT_VIEW, create: null, update: null, delete: null },
  User:               { view: PERMISSIONS.USER_MANAGE, create: PERMISSIONS.USER_MANAGE, update: PERMISSIONS.USER_MANAGE, delete: PERMISSIONS.USER_MANAGE },
  ReadinessBarrier:   { view: PERMISSIONS.PATIENT_VIEW, create: PERMISSIONS.PATIENT_UPDATE, update: PERMISSIONS.PATIENT_UPDATE, delete: PERMISSIONS.PATIENT_DELETE },
  AdultHealthHistoryQuestionnaire: { view: PERMISSIONS.PATIENT_VIEW, create: PERMISSIONS.PATIENT_UPDATE, update: PERMISSIONS.PATIENT_UPDATE, delete: PERMISSIONS.PATIENT_DELETE },
};

function enforcePermission(currentUser, entityName, action) {
  const perms = ENTITY_PERMISSION_MAP[entityName];
  if (!perms) return; // unmapped entities fall through to session-only check
  const required = perms[action];
  if (!required) return; // null means no specific permission needed beyond session
  if (!hasPermission(currentUser.role, required)) {
    throw new Error(`Unauthorized: your role (${currentUser.role}) does not have ${required} permission.`);
  }
}

function register() {
  const db = getDatabase();

  ipcMain.handle('entity:create', async (event, entityName, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    enforcePermission(currentUser, entityName, 'create');

    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);

    const orgId = shared.getSessionOrgId();

    if (entityName === 'AuditLog') throw new Error('Audit logs cannot be created directly');

    // License enforcement — refuse to create new Patient / User rows once
    // the licensed cap is reached. Reads and updates are always allowed
    // (this matches the "fail safe, not silently lose data" stance).
    if (entityName === 'Patient' || entityName === 'User') {
      const licenseManager = require('../../license/manager.cjs');
      const info = licenseManager.getLicenseInfo();
      if (info.mode === 'trial_expired' || info.mode === 'invalid') {
        throw new Error(
          info.mode === 'trial_expired'
            ? 'Your trial period has ended. Please activate a TransTrack license in Settings → License to continue creating records.'
            : 'License is invalid. Please contact your administrator. (' + (info.verificationError || 'unknown') + ')'
        );
      }
      const limitType = entityName === 'Patient' ? 'patients' : 'users';
      // Count existing rows for this org (cheap; SQLite COUNT is O(1) on
      // an indexed column for small N).
      const tbl = entityName === 'Patient' ? 'patients' : 'users';
      const { getDatabase } = require('../../database/init.cjs');
      const current = getDatabase().prepare(`SELECT COUNT(*) AS n FROM ${tbl} WHERE org_id = ?`).get(orgId)?.n || 0;
      const check = licenseManager.checkLimit(limitType, current);
      if (!check.withinLimit) {
        throw new Error(
          `License limit reached: your tier allows up to ${check.limit} ${limitType}. ` +
          `Upgrade your license in Settings → License or contact your account manager.`
        );
      }
    }

    const id = data.id || uuidv4();
    delete data.org_id;
    const safeData = shared.filterToAllowedColumns(tableName, data);
    applyEncryptionToWrite(tableName, id, safeData);
    const entityData = shared.sanitizeForSQLite({ ...safeData, id, org_id: orgId, created_by: currentUser.email });

    // console.log(`creating ${entityName}`, Object.keys(entityData));
    const fields = Object.keys(entityData);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(f => entityData[f]);

    try {
      db.prepare(`INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    } catch (dbError) {
      if (dbError.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (entityName === 'Patient' && entityData.patient_id)
          throw new Error(`A patient with ID "${entityData.patient_id}" already exists. Please use a unique Patient ID.`);
        if (entityName === 'DonorOrgan' && entityData.donor_id)
          throw new Error(`A donor with ID "${entityData.donor_id}" already exists. Please use a unique Donor ID.`);
        throw new Error(`A ${entityName} with this identifier already exists.`);
      }
      throw dbError;
    }

    let patientName = null;
    if (entityName === 'Patient') patientName = `${data.first_name} ${data.last_name}`;
    else if (data.patient_name) patientName = data.patient_name;

    shared.logAudit('create', entityName, id, patientName, `${entityName} created`, currentUser.email, currentUser.role);
    return redactSecretsForRenderer(tableName, shared.getEntityByIdAndOrg(tableName, id, orgId));
  });

  ipcMain.handle('entity:get', async (event, entityName, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    enforcePermission(currentUser, entityName, 'view');
    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    return redactSecretsForRenderer(tableName, shared.getEntityByIdAndOrg(tableName, id, shared.getSessionOrgId()));
  });

  ipcMain.handle('entity:update', async (event, entityName, id, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    enforcePermission(currentUser, entityName, 'update');
    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    const orgId = shared.getSessionOrgId();

    if (entityName === 'AuditLog') throw new Error('Audit logs cannot be modified');

    const existingEntity = shared.getEntityByIdAndOrg(tableName, id, orgId);
    if (!existingEntity) throw new Error(`${entityName} not found or access denied`);

    const now = new Date().toISOString();
    const safeData = shared.filterToAllowedColumns(tableName, data);
    applyEncryptionToWrite(tableName, id, safeData);
    const entityData = shared.sanitizeForSQLite({ ...safeData, updated_by: currentUser.email, updated_at: now });

    const updates = Object.keys(entityData).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(entityData), id, orgId];
    db.prepare(`UPDATE ${tableName} SET ${updates} WHERE id = ? AND org_id = ?`).run(...values);

    const entity = shared.getEntityByIdAndOrg(tableName, id, orgId);
    let patientName = null;
    if (entityName === 'Patient') patientName = `${entity.first_name} ${entity.last_name}`;
    else if (entity.patient_name) patientName = entity.patient_name;

    shared.logAudit('update', entityName, id, patientName, `${entityName} updated`, currentUser.email, currentUser.role);
    return redactSecretsForRenderer(tableName, entity);
  });

  ipcMain.handle('entity:delete', async (event, entityName, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    enforcePermission(currentUser, entityName, 'delete');
    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    const orgId = shared.getSessionOrgId();

    if (entityName === 'AuditLog') throw new Error('Audit logs cannot be deleted');

    const entity = shared.getEntityByIdAndOrg(tableName, id, orgId);
    if (!entity) throw new Error(`${entityName} not found or access denied`);

    let patientName = null;
    if (entityName === 'Patient') patientName = `${entity.first_name} ${entity.last_name}`;
    else if (entity?.patient_name) patientName = entity.patient_name;

    db.prepare(`DELETE FROM ${tableName} WHERE id = ? AND org_id = ?`).run(id, orgId);
    shared.logAudit('delete', entityName, id, patientName, `${entityName} deleted`, currentUser.email, currentUser.role);
    return { success: true };
  });

  ipcMain.handle('entity:list', async (event, entityName, orderBy, limit) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    enforcePermission(currentUser, entityName, 'view');
    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    const rows = shared.listEntitiesByOrg(tableName, shared.getSessionOrgId(), orderBy, limit);
    return rows.map((r) => redactSecretsForRenderer(tableName, r));
  });

  ipcMain.handle('entity:filter', async (event, entityName, filters, orderBy, limit) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    enforcePermission(currentUser, entityName, 'view');
    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    const orgId = shared.getSessionOrgId();
    const allowedColumns = shared.ALLOWED_ORDER_COLUMNS[tableName] || [];

    let query = `SELECT * FROM ${tableName} WHERE org_id = ?`;
    const values = [orgId];

    if (filters && typeof filters === 'object') {
      delete filters.org_id;
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          if (!allowedColumns.includes(key) && !['id', 'created_at', 'updated_at'].includes(key)) {
            throw new Error(`Invalid filter field: ${key}`);
          }
          query += ` AND ${key} = ?`;
          values.push(value);
        }
      }
    }

    if (orderBy) {
      const desc = orderBy.startsWith('-');
      const field = desc ? orderBy.substring(1) : orderBy;
      if (!shared.isValidOrderColumn(tableName, field)) throw new Error(`Invalid sort field: ${field}`);
      query += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
    } else {
      query += ' ORDER BY created_at DESC';
    }

    if (limit) {
      const parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 10000) throw new Error('Invalid limit value. Must be between 1 and 10000.');
      query += ` LIMIT ${parsedLimit}`;
    }

    const rows = db.prepare(query).all(...values);
    return rows
      .map(shared.parseJsonFields)
      .map((r) => redactSecretsForRenderer(tableName, r));
  });
}

module.exports = { register };
