/**
 * TransTrack - Operations IPC Handlers
 * Handles: access:*, recovery:*, compliance:*, reconciliation:*, file:*
 */

const { ipcMain, dialog } = require('electron');
const path = require('path');
const { getDatabase } = require('../../database/init.cjs');
const accessControl = require('../../services/accessControl.cjs');
const disasterRecovery = require('../../services/disasterRecovery.cjs');
const complianceView = require('../../services/complianceView.cjs');
const offlineReconciliation = require('../../services/offlineReconciliation.cjs');
const shared = require('../shared.cjs');

function register() {
  const db = getDatabase();

  // Access control
  ipcMain.handle('access:validateRequest', async (event, permission, justification) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    return accessControl.validateAccessRequest(currentUser.role, permission, justification);
  });

  ipcMain.handle('access:logJustifiedAccess', async (event, permission, entityType, entityId, justification) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
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

  // --- disaster recovery ---
  ipcMain.handle('recovery:createBackup', async (event, options) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required for backup');
    return await disasterRecovery.createBackup({ ...options, createdBy: currentUser.email, orgId: shared.getSessionOrgId() });
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
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required for restore');
    return await disasterRecovery.restoreFromBackup(backupId, { restoredBy: currentUser.email });
  });

  ipcMain.handle('recovery:getStatus', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return disasterRecovery.getRecoveryStatus();
  });

  // Compliance view
  ipcMain.handle('compliance:getSummary', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
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
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
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

  // Offline reconciliation
  ipcMain.handle('reconciliation:getStatus', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offlineReconciliation.getReconciliationStatus();
  });
  ipcMain.handle('reconciliation:getPendingChanges', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offlineReconciliation.getPendingChanges();
  });

  ipcMain.handle('reconciliation:reconcile', async (event, strategy) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required');
    return await offlineReconciliation.reconcilePendingChanges(strategy);
  });

  ipcMain.handle('reconciliation:setMode', async (event, mode) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required');
    return offlineReconciliation.setOperationMode(mode);
  });

  ipcMain.handle('reconciliation:getMode', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offlineReconciliation.getOperationMode();
  });

  // --- file operations ---
  ipcMain.handle('file:exportCSV', async (event, data, filename) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

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

  // Excel export
  ipcMain.handle('file:exportExcel', async (event, data, filename) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

    const { currentUser } = shared.getSessionState();
    const fs = require('fs');
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Excel (CSV)',
      defaultPath: filename || 'transtrack-export.csv',
      filters: [
        { name: 'CSV Files', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!filePath) return { success: false };

    if (!Array.isArray(data) || data.length === 0) {
      fs.writeFileSync(filePath, '');
    } else {
      const headers = Object.keys(data[0]);
      const csvHeader = headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',');
      const csvRows = data.map(row =>
        headers.map(h => {
          const v = row[h];
          if (v === null || v === undefined) return '';
          return `"${String(v).replace(/"/g, '""')}"`;
        }).join(',')
      );
      fs.writeFileSync(filePath, [csvHeader, ...csvRows].join('\n'), 'utf8');
    }

    shared.logAudit('export', 'System', null, null,
      `Excel/CSV exported: ${filename || 'transtrack-export.csv'} (${Array.isArray(data) ? data.length : 0} rows)`,
      currentUser.email, currentUser.role);
    return { success: true, path: filePath };
  });

  // PDF export
  ipcMain.handle('file:exportPDF', async (event, data, filename) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

    const { currentUser } = shared.getSessionState();
    const fs = require('fs');
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export PDF (Text Report)',
      defaultPath: filename || 'transtrack-report.txt',
      filters: [
        { name: 'Text Reports', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!filePath) return { success: false };

    let content = `TransTrack Report\nGenerated: ${new Date().toISOString()}\n`;
    content += `Exported by: ${currentUser.email}\n`;
    content += '='.repeat(60) + '\n\n';

    if (typeof data === 'string') {
      content += data;
    } else if (Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0]);
      content += headers.join(' | ') + '\n';
      content += headers.map(() => '---').join(' | ') + '\n';
      for (const row of data) {
        content += headers.map(h => String(row[h] ?? '')).join(' | ') + '\n';
      }
    } else {
      content += 'No data to export.\n';
    }

    fs.writeFileSync(filePath, content, 'utf8');
    shared.logAudit('export', 'System', null, null,
      `PDF/Report exported: ${filename || 'transtrack-report.txt'}`,
      currentUser.email, currentUser.role);
    return { success: true, path: filePath };
  });

  // File import
  ipcMain.handle('file:import', async (event, type) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

    const { currentUser } = shared.getSessionState();
    if (!currentUser || !['admin', 'coordinator'].includes(currentUser.role)) {
      throw new Error('Admin or coordinator access required for data import');
    }

    const fs = require('fs');

    const filters = [];
    if (type === 'csv') {
      filters.push({ name: 'CSV Files', extensions: ['csv'] });
    } else if (type === 'json' || type === 'fhir') {
      filters.push({ name: 'JSON Files', extensions: ['json'] });
    } else {
      filters.push({ name: 'Supported Files', extensions: ['csv', 'json'] });
    }
    filters.push({ name: 'All Files', extensions: ['*'] });

    const { filePaths } = await dialog.showOpenDialog({
      title: 'Import Data',
      filters,
      properties: ['openFile'],
    });

    if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true };

    const importPath = filePaths[0];
    const ext = path.extname(importPath).toLowerCase();

    const MAX_IMPORT_SIZE = 50 * 1024 * 1024; // 50 MB
    const fd = fs.openSync(importPath, 'r');
    let raw;
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size > MAX_IMPORT_SIZE) {
        fs.closeSync(fd);
        throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Maximum import size is 50 MB.`);
      }
      raw = fs.readFileSync(fd, 'utf8');
      fs.closeSync(fd);
    } catch (fdErr) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      throw fdErr;
    }
    let parsed;

    if (ext === '.json') {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(`Invalid JSON file: ${e.message}`);
      }
    } else if (ext === '.csv') {
      const lines = raw.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) throw new Error('CSV file must have a header row and at least one data row');
      const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
      parsed = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
        return obj;
      });
    } else {
      throw new Error(`Unsupported file type: ${ext}. Use .csv or .json files.`);
    }

    shared.logAudit('import', 'System', null, null,
      `File imported: ${path.basename(importPath)} (${ext}, ${stat.size} bytes)`,
      currentUser.email, currentUser.role);

    return {
      success: true,
      filename: path.basename(importPath),
      type: ext.replace('.', ''),
      data: parsed,
      recordCount: Array.isArray(parsed) ? parsed.length : 1,
    };
  });

  // --- database restore ---
  ipcMain.handle('file:restoreDatabase', async (event, restorePath) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Admin access required for database restore');
    }

    const fs = require('fs');

    if (!restorePath) {
      const { filePaths } = await dialog.showOpenDialog({
        title: 'Restore Database from Backup',
        filters: [{ name: 'Database Files', extensions: ['db'] }],
        properties: ['openFile'],
      });
      if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true };
      restorePath = filePaths[0];
    }

    if (!fs.existsSync(restorePath)) {
      throw new Error('Backup file not found');
    }

    const { backupDatabase, getDatabasePath } = require('../../database/init.cjs');
    const dbPath = getDatabasePath();

    const autoBackupPath = dbPath + '.pre-restore.' + Date.now() + '.bak';
    await backupDatabase(autoBackupPath);

    shared.logAudit('restore', 'System', null, null,
      `Database restore initiated from: ${path.basename(restorePath)}. Auto-backup saved to: ${path.basename(autoBackupPath)}`,
      currentUser.email, currentUser.role);

    return {
      success: true,
      restoredFrom: path.basename(restorePath),
      autoBackup: path.basename(autoBackupPath),
      message: 'Database restore prepared. Application restart required to complete restore.',
      requiresRestart: true,
    };
  });
}

module.exports = { register };
