/**
 * TransTrack - Entity CRUD IPC Handlers
 * Handles: entity:create, entity:get, entity:update, entity:delete,
 *          entity:list, entity:filter
 */

const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');
const { getDatabase, getPatientCount } = require('../../database/init.cjs');
const { checkDataLimit } = require('../../license/tiers.cjs');
const featureGate = require('../../license/featureGate.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  ipcMain.handle('entity:create', async (event, entityName, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();

    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);

    const orgId = shared.getSessionOrgId();
    const tier = shared.getSessionTier();

    if (entityName === 'AuditLog') throw new Error('Audit logs cannot be created directly');

    try {
      if (entityName === 'Patient') {
        const currentCount = getPatientCount(orgId);
        const limitCheck = checkDataLimit(tier, 'maxPatients', currentCount);
        if (!limitCheck.allowed) throw new Error(`Patient limit reached (${limitCheck.limit}). Please upgrade your license to add more patients.`);
      }
      if (entityName === 'DonorOrgan') {
        const currentCount = db.prepare('SELECT COUNT(*) as count FROM donor_organs WHERE org_id = ?').get(orgId).count;
        const limitCheck = checkDataLimit(tier, 'maxDonors', currentCount);
        if (!limitCheck.allowed) throw new Error(`Donor limit reached (${limitCheck.limit}). Please upgrade your license to add more donors.`);
      }
      if (featureGate.isReadOnlyMode()) {
        throw new Error('Application is in read-only mode. Please activate or renew your license to make changes.');
      }
    } catch (licenseError) {
      const { app } = require('electron');
      const failOpen = !app.isPackaged && process.env.NODE_ENV === 'development' && process.env.LICENSE_FAIL_OPEN === 'true';
      if (!failOpen) {
        console.error('License check error:', licenseError.message);
        throw licenseError;
      }
      console.warn('License check warning (dev mode):', licenseError.message);
      if (licenseError.message.includes('limit reached') || licenseError.message.includes('read-only mode')) {
        throw licenseError;
      }
    }

    const id = data.id || uuidv4();
    delete data.org_id;
    const entityData = shared.sanitizeForSQLite({ ...data, id, org_id: orgId, created_by: currentUser.email });

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
    return shared.getEntityById(tableName, id);
  });

  ipcMain.handle('entity:get', async (event, entityName, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    return shared.getEntityByIdAndOrg(tableName, id, shared.getSessionOrgId());
  });

  ipcMain.handle('entity:update', async (event, entityName, id, data) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    const orgId = shared.getSessionOrgId();

    if (entityName === 'AuditLog') throw new Error('Audit logs cannot be modified');

    const existingEntity = shared.getEntityByIdAndOrg(tableName, id, orgId);
    if (!existingEntity) throw new Error(`${entityName} not found or access denied`);

    const now = new Date().toISOString();
    const entityData = shared.sanitizeForSQLite({ ...data, updated_by: currentUser.email, updated_at: now });

    delete entityData.id;
    delete entityData.org_id;
    delete entityData.created_at;
    delete entityData.created_date;
    delete entityData.created_by;

    const updates = Object.keys(entityData).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(entityData), id, orgId];
    db.prepare(`UPDATE ${tableName} SET ${updates} WHERE id = ? AND org_id = ?`).run(...values);

    const entity = shared.getEntityByIdAndOrg(tableName, id, orgId);
    let patientName = null;
    if (entityName === 'Patient') patientName = `${entity.first_name} ${entity.last_name}`;
    else if (entity.patient_name) patientName = entity.patient_name;

    shared.logAudit('update', entityName, id, patientName, `${entityName} updated`, currentUser.email, currentUser.role);
    return entity;
  });

  ipcMain.handle('entity:delete', async (event, entityName, id) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
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
    const tableName = shared.entityTableMap[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);
    return shared.listEntitiesByOrg(tableName, shared.getSessionOrgId(), orderBy, limit);
  });

  ipcMain.handle('entity:filter', async (event, entityName, filters, orderBy, limit) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
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
    return rows.map(shared.parseJsonFields);
  });
}

module.exports = { register };
