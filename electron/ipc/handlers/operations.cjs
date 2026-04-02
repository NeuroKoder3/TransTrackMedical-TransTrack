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

  ipcMain.handle('access:getRoles', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return accessControl.getAllRoles();
  });
  ipcMain.handle('access:getJustificationReasons', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return accessControl.JUSTIFICATION_REASONS;
  });

  // ===== DISASTER RECOVERY =====
  ipcMain.handle('recovery:createBackup', async (event, options) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    return await disasterRecovery.createBackup({ ...options, createdBy: currentUser.email });
  });

  ipcMain.handle('recovery:listBackups', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return disasterRecovery.listBackups();
  });

  ipcMain.handle('recovery:verifyBackup', async (event, backupId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return disasterRecovery.verifyBackup(backupId);
  });

  ipcMain.handle('recovery:restoreBackup', async (event, backupId) => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required for restore');
    return await disasterRecovery.restoreFromBackup(backupId, { restoredBy: currentUser.email });
  });

  ipcMain.handle('recovery:getStatus', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return disasterRecovery.getRecoveryStatus();
  });

  // ===== COMPLIANCE VIEW =====
  ipcMain.handle('compliance:getSummary', async () => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_summary', 'Viewed compliance summary');
    return complianceView.getComplianceSummary(shared.getSessionOrgId());
  });

  ipcMain.handle('compliance:getAuditTrail', async (event, options) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    const orgId = shared.getSessionOrgId();
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_audit', 'Viewed audit trail');
    return complianceView.getAuditTrailForCompliance({ ...options, orgId });
  });

  ipcMain.handle('compliance:getDataCompleteness', async () => {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    return complianceView.getDataCompletenessReport(shared.getSessionOrgId());
  });

  ipcMain.handle('compliance:getValidationReport', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    const orgId = shared.getSessionOrgId();
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_validation', 'Viewed validation report');
    return complianceView.generateValidationReport(orgId);
  });

  ipcMain.handle('compliance:getAccessLogs', async (event, options) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser) throw new Error('Not authenticated');
    const orgId = shared.getSessionOrgId();
    return complianceView.getAccessLogReport({ ...options, orgId });
  });

  // ===== OFFLINE RECONCILIATION =====
  ipcMain.handle('reconciliation:getStatus', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offlineReconciliation.getReconciliationStatus();
  });
  ipcMain.handle('reconciliation:getPendingChanges', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offlineReconciliation.getPendingChanges();
  });

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

  ipcMain.handle('reconciliation:getMode', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offlineReconciliation.getOperationMode();
  });

  // ===== FILE OPERATIONS =====
  ipcMain.handle('file:exportCSV', async (event, data, filename) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

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
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required for database backup');
    const { backupDatabase } = require('../../database/init.cjs');
    await backupDatabase(targetPath);
    shared.logAudit('backup', 'System', null, null, `Database backup created`, currentUser.email, currentUser.role);
    return { success: true };
  });
}

module.exports = { register };
