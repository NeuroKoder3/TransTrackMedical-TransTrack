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
const outcomesHandlers = require('./handlers/outcomes.cjs');
const predictionsHandlers = require('./handlers/predictions.cjs');
const tasksHandlers = require('./handlers/tasks.cjs');
const srtrHandlers = require('./handlers/srtr.cjs');
const backupHandler = require('./backupHandler.cjs');
const dataResidency = require('./dataResidency.cjs');
const auditReportHandler = require('./auditReportHandler.cjs');
const encryptionKeyManagement = require('../services/encryptionKeyManagement.cjs');
const { validateFHIRDataComplete } = require('../functions/validateFHIRData.cjs');
const { getMigrationStatus } = require('../database/migrations.cjs');

/**
 * Wrap ipcMain.handle so every registered handler automatically runs through
 * the rate limiter. The original handler still decides whether it requires
 * an active session (auth:login obviously doesn't).
 */
function installRateLimitMiddleware() {
  const { ipcMain } = require('electron');
  const { checkRateLimit } = require('./rateLimiter.cjs');
  const shared = require('./shared.cjs');

  const originalHandle = ipcMain.handle.bind(ipcMain);

  ipcMain.handle = (channel, handler) => {
    originalHandle(channel, async (event, ...args) => {
      const { currentUser } = shared.getSessionState();
      const userId = currentUser?.id || 'anon';

      const rateResult = checkRateLimit(userId, channel);
      if (!rateResult.allowed) {
        throw new Error(rateResult.error);
      }

      return handler(event, ...args);
    });
  };
}

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
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return encryptionKeyManagement.getKeyRotationStatus();
  });

  ipcMain.handle('encryption:getKeyRotationHistory', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return encryptionKeyManagement.getKeyRotationHistory();
  });

  // FHIR R4 validation
  ipcMain.handle('fhir:validate', async (_event, fhirData) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return validateFHIRDataComplete(fhirData);
  });

  // Migration status
  ipcMain.handle('system:getMigrationStatus', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required');
    const { getDatabase } = require('../database/init.cjs');
    return getMigrationStatus(getDatabase());
  });
}

function setupIPCHandlers() {
  installRateLimitMiddleware();
  authHandlers.register();
  entityHandlers.register();
  adminHandlers.register();
  licenseHandlers.register();
  barrierHandlers.register();
  ahhqHandlers.register();
  labsHandlers.register();
  clinicalHandlers.register();
  operationsHandlers.register();
  outcomesHandlers.register();
  predictionsHandlers.register();
  tasksHandlers.register();
  srtrHandlers.register();
  backupHandler.register();
  dataResidency.register();
  auditReportHandler.register();
  registerExtendedHandlers();
}

module.exports = { setupIPCHandlers };
