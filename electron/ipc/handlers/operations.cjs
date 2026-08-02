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
const supportBundle = require('../../services/supportBundle.cjs');
const pathConfinement = require('../pathConfinement.cjs');
const shared = require('../shared.cjs');

/**
 * File types a backup may be written as.
 *
 * Enforced on the write path because backupDatabase() securely wipes whatever
 * already sits at the target before copying: without this, a target inside the
 * application data directory could be aimed at `.transtrack-key` and destroy the
 * encryption key rather than produce a backup.
 */
const BACKUP_EXTENSIONS = ['.db', '.sqlite', '.bak'];

/**
 * Record who took a diagnostics export and what it was allowed to contain.
 *
 * Named separately from the export itself so the trail distinguishes a routine
 * bundle from one that carries free text, and so the operator's identity is on
 * the record rather than inferred from a nearby sign-in.
 */
function auditFreeTextDiagnostics(action, currentUser, options) {
  shared.logAudit(
    action,
    'System',
    null,
    null, // patientName — a support bundle is never scoped to one patient
    JSON.stringify({
      severity: options?.includeFreeText === true ? 'high' : 'informational',
      operator: currentUser.email,
      includeFreeText: options?.includeFreeText === true,
      handleAsPhi: options?.includeFreeText === true,
      confirmationProvided: Boolean(options?.freeTextConfirmation),
    }),
    currentUser.email,
    currentUser.role,
  );
}

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

  ipcMain.handle('access:authorizePhiAccess', async (event, { permission, entityType, entityId, justification }) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    return accessControl.authorizeAndLogPhiAccess({
      permission, entityType, entityId, justification, user: currentUser,
    });
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

  // The backup inventory names every copy of the database and where it lives on
  // disk, and verification reads one. Both are operator functions: creating and
  // restoring a backup were already admin-only, so leaving the inventory open to
  // any authenticated account gave a map of the PHI at rest to everyone.
  ipcMain.handle('recovery:listBackups', async () => {
    shared.requireAdmin('listing database backups');
    return disasterRecovery.listBackups();
  });

  ipcMain.handle('recovery:verifyBackup', async (event, backupId) => {
    shared.requireAdmin('verifying a database backup');
    return disasterRecovery.verifyBackup(backupId);
  });

  ipcMain.handle('recovery:restoreBackup', async (event, backupId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin access required for restore');
    return await disasterRecovery.restoreFromBackup(backupId, {
      restoredBy: currentUser.email,
      orgId: shared.getSessionOrgId(),
    });
  });

  ipcMain.handle('recovery:getStatus', async () => {
    shared.requireAdmin('reading disaster-recovery status');
    return disasterRecovery.getRecoveryStatus();
  });

  // --- support diagnostics ---
  //
  // Admin-only. A support bundle is a diagnostic export that leaves the machine,
  // so it is gated like a backup rather than like a read.

  ipcMain.handle('support:previewBundle', async (event, options) => {
    const currentUser = shared.requireAdmin('support diagnostics');

    // Returned to the renderer so an administrator can see exactly what would
    // leave the machine before choosing to save it. A preview in full-text mode
    // materialises the same PHI, so it carries the same confirmation and the
    // same audit record as the export.
    const includeFreeText = options?.includeFreeText === true;
    if (includeFreeText) {
      auditFreeTextDiagnostics('support_bundle_previewed_with_phi', currentUser, options);
    }

    return supportBundle.collectBundle({
      includeFreeText,
      freeTextConfirmation: options?.freeTextConfirmation,
      operator: currentUser.email,
      maxLogLines: 200,
    });
  });

  ipcMain.handle('support:exportBundle', async (event, options) => {
    const currentUser = shared.requireAdmin('support diagnostics');
    const includeFreeText = options?.includeFreeText === true;

    // Confirmation is checked before the save dialog opens so the operator is
    // not asked where to put a file that will not be produced.
    supportBundle.requireFreeTextAuthorization({
      includeFreeText,
      freeTextConfirmation: options?.freeTextConfirmation,
      operator: currentUser.email,
    });

    const suggested = supportBundle.suggestFileName(new Date(), { includeFreeText });
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: includeFreeText
        ? 'Export support bundle (CONTAINS PHI)'
        : 'Export support bundle',
      defaultPath: suggested,
      filters: [{ name: 'Support bundle', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    // Recorded BEFORE the file is written. In full-text mode this is a PHI
    // disclosure, and a disclosure that cannot be evidenced must not happen —
    // so the audit failure propagates rather than being swallowed as it was.
    auditFreeTextDiagnostics(
      includeFreeText ? 'support_bundle_exported_with_phi' : 'support_bundle_exported',
      currentUser,
      options
    );

    const result = supportBundle.writeBundle(filePath, {
      includeFreeText,
      freeTextConfirmation: options?.freeTextConfirmation,
      operator: currentUser.email,
    });

    return { canceled: false, ...result, includeFreeText };
  });

  // Compliance view
  //
  // The Compliance Center is a read-only surface for regulators and auditors.
  // COMPLIANCE_VIEW and AUDIT_VIEW are held by admin and regulator only, which
  // is what separates an auditor's read from a coordinator's — the previous
  // session-only check gave every role the whole audit trail.
  ipcMain.handle('compliance:getSummary', async () => {
    const currentUser = shared.requirePermission(
      accessControl.PERMISSIONS.COMPLIANCE_VIEW, 'reading the compliance summary'
    );
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_summary', 'Viewed compliance summary');
    return complianceView.getComplianceSummary(shared.getSessionOrgId());
  });

  ipcMain.handle('compliance:getAuditTrail', async (event, options) => {
    const currentUser = shared.requirePermission(
      accessControl.PERMISSIONS.AUDIT_VIEW, 'reading the audit trail'
    );
    const orgId = shared.getSessionOrgId();
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_audit', 'Viewed audit trail');
    return complianceView.getAuditTrailForCompliance({ ...options, orgId });
  });

  ipcMain.handle('compliance:getDataCompleteness', async () => {
    shared.requirePermission(
      accessControl.PERMISSIONS.COMPLIANCE_VIEW, 'reading the data completeness report'
    );
    return complianceView.getDataCompletenessReport(shared.getSessionOrgId());
  });

  ipcMain.handle('compliance:getValidationReport', async () => {
    const currentUser = shared.requirePermission(
      accessControl.PERMISSIONS.COMPLIANCE_VIEW, 'reading the validation report'
    );
    const orgId = shared.getSessionOrgId();
    complianceView.logRegulatorAccess(db, currentUser.id, currentUser.email, 'view_validation', 'Viewed validation report');
    return complianceView.generateValidationReport(orgId);
  });

  ipcMain.handle('compliance:getAccessLogs', async (event, options) => {
    // Who looked at which patient record and why — audit content, not clinical.
    shared.requirePermission(accessControl.PERMISSIONS.AUDIT_VIEW, 'reading PHI access logs');
    const orgId = shared.getSessionOrgId();
    return complianceView.getAccessLogReport({ ...options, orgId });
  });

  // Offline reconciliation (disabled — single-workstation mode)
  ipcMain.handle('reconciliation:getStatus', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return offlineReconciliation.getReconciliationStatus();
  });
  ipcMain.handle('reconciliation:getPendingChanges', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return [];
  });
  ipcMain.handle('reconciliation:reconcile', async () => {
    throw new Error('Offline reconciliation is disabled; TransTrack is single-workstation offline-first without multi-device sync');
  });
  ipcMain.handle('reconciliation:setMode', async () => {
    throw new Error('Offline reconciliation is disabled; TransTrack is single-workstation offline-first without multi-device sync');
  });
  ipcMain.handle('reconciliation:getMode', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return 'normal';
  });

  // --- file operations ---
  ipcMain.handle('file:exportCSV', async (event, data, filename, justification) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

    const { currentUser } = shared.getSessionState();
    if (!accessControl.hasPermission(currentUser.role, accessControl.PERMISSIONS.REPORT_EXPORT) &&
        !['admin', 'coordinator'].includes(currentUser.role)) {
      throw new Error('Unauthorized: REPORT_EXPORT permission or admin/coordinator role required for data export');
    }
    shared.logAudit('export_authorized', 'System', null, null,
      `CSV export authorized. Justification: ${justification || 'N/A'}`,
      currentUser.email, currentUser.role);

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
    const currentUser = shared.requireAdmin('backing up the database');

    const confinedPath = pathConfinement.resolveConfinedPath(
      targetPath || pathConfinement.defaultBackupPath(),
      { purpose: 'backing up the database', extensions: BACKUP_EXTENSIONS }
    );

    const { backupDatabase } = require('../../database/init.cjs');
    await backupDatabase(confinedPath);
    shared.logAudit('backup', 'System', null, null, `Database backup created`, currentUser.email, currentUser.role);
    return { success: true, path: confinedPath };
  });

  // Excel export
  ipcMain.handle('file:exportExcel', async (event, data, filename, justification) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

    const { currentUser } = shared.getSessionState();
    if (!accessControl.hasPermission(currentUser.role, accessControl.PERMISSIONS.REPORT_EXPORT) &&
        !['admin', 'coordinator'].includes(currentUser.role)) {
      throw new Error('Unauthorized: REPORT_EXPORT permission or admin/coordinator role required for data export');
    }
    shared.logAudit('export_authorized', 'System', null, null,
      `Excel export authorized. Justification: ${justification || 'N/A'}`,
      currentUser.email, currentUser.role);

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
  ipcMain.handle('file:exportPDF', async (event, data, filename, justification) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');

    const { currentUser } = shared.getSessionState();
    if (!accessControl.hasPermission(currentUser.role, accessControl.PERMISSIONS.REPORT_EXPORT) &&
        !['admin', 'coordinator'].includes(currentUser.role)) {
      throw new Error('Unauthorized: REPORT_EXPORT permission or admin/coordinator role required for data export');
    }
    shared.logAudit('export_authorized', 'System', null, null,
      `PDF/Report export authorized. Justification: ${justification || 'N/A'}`,
      currentUser.email, currentUser.role);

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

    const fileStats = fs.statSync(importPath);
    shared.logAudit('import', 'System', null, null,
      `File imported: ${path.basename(importPath)} (${ext}, ${fileStats.size} bytes)`,
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
    const currentUser = shared.requireAdmin('restoring the database');

    if (!restorePath) {
      // Opened in the backup directory so the operator starts inside the
      // allowlist rather than discovering the confinement as an error.
      const roots = pathConfinement.getAllowedRoots();
      const backupRoot = roots.find(r => r.label === 'backup directory');
      const { filePaths } = await dialog.showOpenDialog({
        title: 'Restore Database from Backup',
        defaultPath: backupRoot ? backupRoot.dir : undefined,
        filters: [{ name: 'Database Files', extensions: ['db'] }],
        properties: ['openFile'],
      });
      if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true };
      restorePath = filePaths[0];
    }

    // Applied to the dialog result as well as a renderer-supplied string: the
    // dialog is driven by the same process that could be supplying the string,
    // so it is not a stronger source of truth (finding L-5).
    const confinedPath = pathConfinement.resolveConfinedPath(restorePath, {
      purpose: 'restoring the database',
      mustExist: true,
    });

    shared.logAudit('restore', 'System', null, null,
      `Database restore initiated from: ${path.basename(confinedPath)}`,
      currentUser.email, currentUser.role);

    const { restoreDatabaseFromBackup } = require('../../database/init.cjs');
    return await restoreDatabaseFromBackup(confinedPath);
  });
}

module.exports = { register };
