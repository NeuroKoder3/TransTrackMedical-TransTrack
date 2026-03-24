/**
 * TransTrack - Operations IPC Handlers
 * Handles: access:*, recovery:*, compliance:*, reconciliation:*, file:*
 *
 * Security:
 *  - wrapHandler() for standardized error handling + session validation
 *  - Admin-gated operations for restore, reconciliation, and settings
 *  - Request-ID tracing
 */

const { ipcMain, dialog } = require('electron');
const { getDatabase } = require('../../database/init.cjs');
const { FEATURES } = require('../../license/tiers.cjs');
const featureGate = require('../../license/featureGate.cjs');
const accessControl = require('../../services/accessControl.cjs');
const disasterRecovery = require('../../services/disasterRecovery.cjs');
const complianceView = require('../../services/complianceView.cjs');
const offlineReconciliation = require('../../services/offlineReconciliation.cjs');
const shared = require('../shared.cjs');
const { createContext, endContext } = require('../requestContext.cjs');

function register() {
  const db = getDatabase();

  // ===== ACCESS CONTROL =====
  ipcMain.handle('access:validateRequest', shared.wrapHandler(async (event, permission, justification) => {
    const { currentUser } = shared.getSessionState();
    return accessControl.validateAccessRequest(currentUser.role, permission, justification);
  }));

  ipcMain.handle('access:logJustifiedAccess', shared.wrapHandler(async (event, permission, entityType, entityId, justification) => {
    const { currentUser } = shared.getSessionState();
    return accessControl.logAccessWithJustification(
      db, currentUser.id, currentUser.email, currentUser.role,
      permission, entityType, entityId, justification
    );
  }));

  ipcMain.handle('access:getRoles', async () => accessControl.getAllRoles());
  ipcMain.handle('access:getJustificationReasons', async () => accessControl.JUSTIFICATION_REASONS);

  // ===== DISASTER RECOVERY =====
  ipcMain.handle('recovery:createBackup', shared.wrapHandler(async (event, options) => {
    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      const result = await disasterRecovery.createBackup({ ...options, createdBy: currentUser.email });
      shared.logAudit('backup_requested', 'System', null, null, 'Backup created via recovery handler', currentUser.email, currentUser.role, ctx.requestId);
      return result;
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('recovery:listBackups', shared.wrapHandler(async () => {
    return disasterRecovery.listBackups();
  }));

  ipcMain.handle('recovery:verifyBackup', shared.wrapHandler(async (event, backupId) => {
    return disasterRecovery.verifyBackup(backupId);
  }));

  ipcMain.handle('recovery:restoreBackup', shared.wrapHandler(async (event, backupId) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED', null, 'Admin access required for restore');

    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      shared.logAudit('restore_requested', 'System', backupId, null, `Restore from backup ${backupId} requested`, currentUser.email, currentUser.role, ctx.requestId);
      return await disasterRecovery.restoreFromBackup(backupId, { restoredBy: currentUser.email });
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('recovery:getStatus', shared.wrapHandler(async () => {
    return disasterRecovery.getRecoveryStatus();
  }));

  // ===== COMPLIANCE VIEW =====
  ipcMain.handle('compliance:getSummary', shared.wrapHandler(async () => {
    const { currentUser } = shared.getSessionState();
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_summary', 'Viewed compliance summary');
    return complianceView.getComplianceSummary();
  }));

  ipcMain.handle('compliance:getAuditTrail', shared.wrapHandler(async (event, options) => {
    const { currentUser } = shared.getSessionState();
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_audit', 'Viewed audit trail');
    return complianceView.getAuditTrailForCompliance(options);
  }));

  ipcMain.handle('compliance:getDataCompleteness', shared.wrapHandler(async () => {
    return complianceView.getDataCompletenessReport();
  }));

  ipcMain.handle('compliance:getValidationReport', shared.wrapHandler(async () => {
    const { currentUser } = shared.getSessionState();
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_validation', 'Viewed validation report');
    return complianceView.generateValidationReport();
  }));

  ipcMain.handle('compliance:getAccessLogs', shared.wrapHandler(async (event, options) => {
    return complianceView.getAccessLogReport(options);
  }));

  // ===== OFFLINE RECONCILIATION =====
  ipcMain.handle('reconciliation:getStatus', shared.wrapHandler(async () => {
    return offlineReconciliation.getReconciliationStatus();
  }));

  ipcMain.handle('reconciliation:getPendingChanges', shared.wrapHandler(async () => {
    return offlineReconciliation.getPendingChanges();
  }));

  ipcMain.handle('reconciliation:reconcile', shared.wrapHandler(async (event, strategy) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED');

    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      shared.logAudit('reconciliation_started', 'System', null, null, `Reconciliation started with strategy: ${strategy}`, currentUser.email, currentUser.role, ctx.requestId);
      return await offlineReconciliation.reconcilePendingChanges(strategy);
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('reconciliation:setMode', shared.wrapHandler(async (event, mode) => {
    const { currentUser } = shared.getSessionState();
    if (currentUser.role !== 'admin') throw shared.createStandardError('ADMIN_REQUIRED');
    return offlineReconciliation.setOperationMode(mode);
  }));

  ipcMain.handle('reconciliation:getMode', shared.wrapHandler(async () => {
    return offlineReconciliation.getOperationMode();
  }));

  // ===== FILE OPERATIONS =====
  ipcMain.handle('file:exportCSV', shared.wrapHandler(async (event, data, filename) => {
    const exportCheck = featureGate.canAccessFeature(FEATURES.DATA_EXPORT);
    if (!exportCheck.allowed) {
      throw shared.createStandardError('FEATURE_UNAVAILABLE', null, 'Data export is not available in your current license tier. Please upgrade to export data.');
    }

    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      const fs = require('fs');
      const { filePath } = await dialog.showSaveDialog({
        title: 'Export CSV',
        defaultPath: filename,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      });

      if (filePath) {
        if (data.length === 0) {
          fs.writeFileSync(filePath, '');
        } else {
          const headers = Object.keys(data[0]).join(',');
          const rows = data.map(row =>
            Object.values(row).map(v => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v)).join(',')
          );
          fs.writeFileSync(filePath, [headers, ...rows].join('\n'));
        }
        shared.logAudit('export', 'System', null, null, `CSV exported: ${filename}`, currentUser.email, currentUser.role, ctx.requestId);
        return { success: true, path: filePath };
      }
      return { success: false };
    } finally {
      endContext(ctx.requestId);
    }
  }));

  ipcMain.handle('file:backupDatabase', shared.wrapHandler(async (event, targetPath) => {
    const { currentUser } = shared.getSessionState();
    const ctx = createContext({ orgId: currentUser.org_id, userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role });
    try {
      const { backupDatabase } = require('../../database/init.cjs');
      await backupDatabase(targetPath);
      shared.logAudit('backup', 'System', null, null, `Database backup to: ${targetPath}`, currentUser.email, currentUser.role, ctx.requestId);
      return { success: true };
    } finally {
      endContext(ctx.requestId);
    }
  }));
}

module.exports = { register };
