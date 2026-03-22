/**
 * TransTrack - IPC Handler Coordinator
 *
 * Registers all domain-specific IPC handler modules.
 * Each module handles a specific set of IPC channels.
 *
 * Security Features:
 * - SQL injection prevention via parameterized queries and column whitelisting
 * - Session expiration validation
 * - Account lockout after failed login attempts
 * - Password strength requirements
 * - Audit logging for all operations
 * - Organization isolation on all data access
 */

const authHandlers = require('./handlers/auth.cjs');
const entityHandlers = require('./handlers/entities.cjs');
const adminHandlers = require('./handlers/admin.cjs');
const licenseHandlers = require('./handlers/license.cjs');
const barrierHandlers = require('./handlers/barriers.cjs');
const ahhqHandlers = require('./handlers/ahhq.cjs');
const labsHandlers = require('./handlers/labs.cjs');
const clinicalHandlers = require('./handlers/clinical.cjs');
const operationsHandlers = require('./handlers/operations.cjs');
const backupHandler = require('./backupHandler.cjs');
const dataResidency = require('./dataResidency.cjs');
const auditReportHandler = require('./auditReportHandler.cjs');
const encryptionKeyManagement = require('../services/encryptionKeyManagement.cjs');
const { validateFHIRDataComplete } = require('../functions/validateFHIRData.cjs');
const { getMigrationStatus } = require('../database/migrations.cjs');

function registerExtendedHandlers() {
  const { ipcMain } = require('electron');
  const shared = require('./shared.cjs');

  // Encryption key rotation
  ipcMain.handle('encryption:rotateKey', async (_event, options = {}) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required for key rotation');
    }
    return await encryptionKeyManagement.rotateEncryptionKey({
      createdBy: currentUser.email,
      ...options,
    });
  });

  ipcMain.handle('encryption:getKeyRotationStatus', async () => {
    return encryptionKeyManagement.getKeyRotationStatus();
  });

  ipcMain.handle('encryption:getKeyRotationHistory', async () => {
    return encryptionKeyManagement.getKeyRotationHistory();
  });

  // FHIR R4 validation
  ipcMain.handle('fhir:validate', async (_event, fhirData) => {
    return validateFHIRDataComplete(fhirData);
  });

  // Migration status
  ipcMain.handle('system:getMigrationStatus', async () => {
    const { getDatabase } = require('../database/init.cjs');
    return getMigrationStatus(getDatabase());
  });
}

function setupIPCHandlers() {
  authHandlers.register();
  entityHandlers.register();
  adminHandlers.register();
  licenseHandlers.register();
  barrierHandlers.register();
  ahhqHandlers.register();
  labsHandlers.register();
  clinicalHandlers.register();
  operationsHandlers.register();
  backupHandler.register();
  dataResidency.register();
  auditReportHandler.register();
  registerExtendedHandlers();
}

module.exports = { setupIPCHandlers };
