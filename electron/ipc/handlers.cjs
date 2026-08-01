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
const inactivationRiskHandlers = require('./handlers/inactivationRisk.cjs');
const inactivationActionQueueHandlers = require('./handlers/inactivationActionQueue.cjs');
const iotaHandlers = require('./handlers/iota.cjs');
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
const licenseHandlers = require('./handlers/license.cjs');
const backupHandler = require('./backupHandler.cjs');
const dataResidency = require('./dataResidency.cjs');
const auditReportHandler = require('./auditReportHandler.cjs');
const encryptionKeyManagement = require('../services/encryptionKeyManagement.cjs');
const { validateFHIRDataComplete } = require('../functions/validateFHIRData.cjs');
const { getMigrationStatus } = require('../database/migrations.cjs');

/**
 * Wrap ipcMain.handle so every registered handler automatically runs through
 * the shared IPC security middleware. The original handler still decides
 * whether it requires an active session (auth:login obviously doesn't).
 *
 * Order matters — cheapest and most decisive checks first:
 *   1. Sender validation  (is this the trusted renderer top-level frame?)
 *   2. Argument validation (is the payload structurally safe / in schema?)
 *   3. Session restrictions (password change / MFA enrollment gates)
 *   4. Rate limiting
 *
 * Rejections are logged without payload contents so no PHI reaches the logs.
 */
function installIpcSecurityMiddleware() {
  const { ipcMain } = require('electron');
  const { checkRateLimit } = require('./rateLimiter.cjs');
  const shared = require('./shared.cjs');
  const senderValidation = require('./senderValidation.cjs');
  const argValidation = require('./argValidation.cjs');
  const { logger } = require('../services/logger.cjs');

  const originalHandle = ipcMain.handle.bind(ipcMain);

  ipcMain.handle = (channel, handler) => {
    originalHandle(channel, async (event, ...args) => {
      shared.setRequestContext(event?.sender?.id);
      try {
        // 1. Sender validation — refuse IPC that did not come from the
        //    trusted renderer's top-level frame.
        const senderResult = senderValidation.validateSender(event, channel);
        if (!senderResult.ok) {
          logger.warn('Rejected IPC from untrusted sender', {
            channel,
            reason: senderResult.reason,
          });
          throw new Error('Request rejected: untrusted IPC sender');
        }

        // 2. Argument validation — structural guards for all channels plus
        //    per-channel schemas where defined.
        try {
          argValidation.validateArgs(channel, args);
        } catch (validationErr) {
          logger.warn('Rejected IPC with invalid arguments', {
            channel,
            reason: validationErr.message,
          });
          throw validationErr;
        }

        const { currentUser } = shared.getSessionState();
        const userId = currentUser?.id || 'anon';

        // 3. Restricted sessions (must change password / enroll MFA) may only
        //    call the allow-listed security-setup channels.
        if (currentUser?.session_restrictions?.length) {
          if (!shared.sessionAllows(channel)) {
            throw new Error('Complete account security requirements before continuing');
          }
        }

        // 4. Rate limiting.
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
  const electronicSignature = require('../services/electronicSignature.cjs');
  const { verifyAuditChain } = require('../services/auditChain.cjs');

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

  // Health check — comprehensive system snapshot. Available to any
  // authenticated user so the in-app diagnostics page works for any role
  // that has the permission to open it; the report does not contain PHI.
  ipcMain.handle('system:getHealth', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const healthCheck = require('../services/healthCheck.cjs');
    return healthCheck.getHealth();
  });

  // Electronic signatures (21 CFR Part 11)
  ipcMain.handle('esig:sign', async (_event, params) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const result = electronicSignature.signRecord({
      orgId,
      userId: currentUser.id,
      userEmail: currentUser.email,
      userFullName: currentUser.full_name,
      meaning: params.meaning,
      entityType: params.entityType,
      entityId: params.entityId,
      payloadHash: params.payloadHash,
    });
    shared.logAudit('electronic_signature', params.entityType, params.entityId, null,
      JSON.stringify({ meaning: params.meaning, signatureId: result.id }),
      currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('esig:list', async (_event, params) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return electronicSignature.getSignatures(
      shared.getSessionOrgId(), params.entityType, params.entityId
    );
  });

  ipcMain.handle('esig:verify', async (_event, signatureId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return electronicSignature.verifySignature(signatureId);
  });

  // Audit chain verification
  ipcMain.handle('audit:verifyChain', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required');
    return verifyAuditChain(shared.getSessionOrgId());
  });
}

function setupIPCHandlers() {
  installIpcSecurityMiddleware();
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
  inactivationRiskHandlers.register();
  inactivationActionQueueHandlers.register();
  iotaHandlers.register();
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
  licenseHandlers.register();
  backupHandler.register();
  dataResidency.register();
  auditReportHandler.register();
  registerExtendedHandlers();
}

module.exports = { setupIPCHandlers };
