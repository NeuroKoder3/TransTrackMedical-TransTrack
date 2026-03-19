/**
 * TransTrack - Operations IPC Handlers
 * Handles: access:*, recovery:*, compliance:*, reconciliation:*, file:*
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

function register() {
  const db = getDatabase();

  // ===== ACCESS CONTROL =====
  ipcMain.handle('access:validateRequest', async (event, permission, justification) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    return accessControl.validateAccessRequest(currentUser.role, permission, justification);
  });

  ipcMain.handle('access:logJustifiedAccess', async (event, permission, entityType, entityId, justification) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    return accessControl.logAccessWithJustification(
      db, currentUser.id, currentUser.email, currentUser.role,
      permission, entityType, entityId, justification
    );
  });

  ipcMain.handle('access:getRoles', async () => accessControl.getAllRoles());
  ipcMain.handle('access:getJustificationReasons', async () => accessControl.JUSTIFICATION_REASONS);

  // ===== DISASTER RECOVERY =====
  ipcMain.handle('recovery:createBackup', async (event, options) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    return await disasterRecovery.createBackup({ ...options, createdBy: currentUser.email });
  });

  ipcMain.handle('recovery:listBackups', async () => disasterRecovery.listBackups());

  ipcMain.handle('recovery:verifyBackup', async (event, backupId) => disasterRecovery.verifyBackup(backupId));

  ipcMain.handle('recovery:restoreBackup', async (event, backupId) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required for restore');
    return await disasterRecovery.restoreFromBackup(backupId, { restoredBy: currentUser.email });
  });

  ipcMain.handle('recovery:getStatus', async () => disasterRecovery.getRecoveryStatus());

  // ===== COMPLIANCE VIEW =====
  ipcMain.handle('compliance:getSummary', async () => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_summary', 'Viewed compliance summary');
    return complianceView.getComplianceSummary();
  });

  ipcMain.handle('compliance:getAuditTrail', async (event, options) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_audit', 'Viewed audit trail');
    return complianceView.getAuditTrailForCompliance(options);
  });

  ipcMain.handle('compliance:getDataCompleteness', async () => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    return complianceView.getDataCompletenessReport();
  });

  ipcMain.handle('compliance:getValidationReport', async () => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_validation', 'Viewed validation report');
    return complianceView.generateValidationReport();
  });

  ipcMain.handle('compliance:getAccessLogs', async (event, options) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    return complianceView.getAccessLogReport(options);
  });

  // ===== OFFLINE RECONCILIATION =====
  ipcMain.handle('reconciliation:getStatus', async () => offlineReconciliation.getReconciliationStatus());
  ipcMain.handle('reconciliation:getPendingChanges', async () => offlineReconciliation.getPendingChanges());

  ipcMain.handle('reconciliation:reconcile', async (event, strategy) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required');
    return await offlineReconciliation.reconcilePendingChanges(strategy);
  });

  ipcMain.handle('reconciliation:setMode', async (event, mode) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required');
    return offlineReconciliation.setOperationMode(mode);
  });

  ipcMain.handle('reconciliation:getMode', async () => offlineReconciliation.getOperationMode());

  // ===== FILE OPERATIONS =====
  ipcMain.handle('file:exportCSV', async (event, data, filename) => {
    const exportCheck = featureGate.canAccessFeature(FEATURES.DATA_EXPORT);
    if (!exportCheck.allowed) {
      throw new Error('Data export is not available in your current license tier. Please upgrade to export data.');
    }

    const { currentUser } = shared.getSessionState();
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
      shared.logAudit('export', 'System', null, null, `CSV exported: ${filename}`, currentUser.email, currentUser.role);
      return { success: true, path: filePath };
    }
    return { success: false };
  });

  ipcMain.handle('file:backupDatabase', async (event, targetPath) => {
    const { backupDatabase } = require('../../database/init.cjs');
    await backupDatabase(targetPath);
    return { success: true };
  });
}

module.exports = { register };
