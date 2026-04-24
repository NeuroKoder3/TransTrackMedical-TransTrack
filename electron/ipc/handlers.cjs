// IPC handler coordinator — registers all handler modules

const authHandlers = require('./handlers/auth.cjs');
const entityHandlers = require('./handlers/entities.cjs');
const adminHandlers = require('./handlers/admin.cjs');
const barrierHandlers = require('./handlers/barriers.cjs');
const ahhqHandlers = require('./handlers/ahhq.cjs');
const labsHandlers = require('./handlers/labs.cjs');
const clinicalHandlers = require('./handlers/clinical.cjs');
const operationsHandlers = require('./handlers/operations.cjs');
const outcomesHandlers = require('./handlers/outcomes.cjs');
const predictionsHandlers = require('./handlers/predictions.cjs');
const tasksHandlers = require('./handlers/tasks.cjs');
const srtrHandlers = require('./handlers/srtr.cjs');
const calculatorsHandlers = require('./handlers/calculators.cjs');
const organOffersHandlers = require('./handlers/organOffers.cjs');
const postTransplantHandlers = require('./handlers/postTransplant.cjs');
const livingDonorsHandlers = require('./handlers/livingDonors.cjs');
const mfaHandlers = require('./handlers/mfa.cjs');
const siemHandlers = require('./handlers/siem.cjs');
const hl7Handlers = require('./handlers/hl7.cjs');
const optnExportHandlers = require('./handlers/optnExport.cjs');
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
      shared.setRequestContext(event?.sender?.id);
      try {
        const { currentUser } = shared.getSessionState();
        const userId = currentUser?.id || 'anon';

        const rateResult = checkRateLimit(userId, channel);
        if (!rateResult.allowed) {
          throw new Error(rateResult.error);
        }

        return await handler(event, ...args);
      } finally {
        shared.clearRequestContext();
      }
    });
  };
}

function registerExtendedHandlers() {
  const { ipcMain } = require('electron');
  const shared = require('./shared.cjs');

  // Encryption key rotation
  ipcMain.handle('encryption:rotateKey', async (_event, options = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
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
  barrierHandlers.register();
  ahhqHandlers.register();
  labsHandlers.register();
  clinicalHandlers.register();
  operationsHandlers.register();
  outcomesHandlers.register();
  predictionsHandlers.register();
  tasksHandlers.register();
  srtrHandlers.register();
  calculatorsHandlers.register();
  organOffersHandlers.register();
  postTransplantHandlers.register();
  livingDonorsHandlers.register();
  mfaHandlers.register();
  siemHandlers.register();
  hl7Handlers.register();
  optnExportHandlers.register();
  backupHandler.register();
  dataResidency.register();
  auditReportHandler.register();
  registerExtendedHandlers();
}

module.exports = { setupIPCHandlers };
