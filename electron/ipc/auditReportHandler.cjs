/**
 * TransTrack - Compliance Audit Report Generator
 *
 * Generates comprehensive audit trail reports for HIPAA compliance reviews.
 * Reports can be exported as JSON for external auditors.
 *
 * HIPAA 164.312(b) - Audit Controls
 * HIPAA 164.308(a)(1)(ii)(D) - Information System Activity Review
 */

'use strict';

const { ipcMain } = require('electron');
const { getDatabase, getDefaultOrganization } = require('../database/init.cjs');
const { createLogger } = require('./errorLogger.cjs');
const shared = require('./shared.cjs');
const auditExport = require('../services/auditExport.cjs');

const log = createLogger('auditReport');

/** Only these roles may read or export the audit trail. */
const AUDIT_READER_ROLES = ['admin', 'regulator'];

function requireAuditReader(purpose) {
  if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
  const { currentUser } = shared.getSessionState();
  if (!currentUser || !AUDIT_READER_ROLES.includes(currentUser.role)) {
    throw new Error(`Admin or regulator access required for ${purpose}`);
  }
  return currentUser;
}

function register() {
  ipcMain.handle('compliance:verify-audit-chain', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!currentUser || !['admin', 'regulator'].includes(currentUser.role)) {
      throw new Error('Admin or regulator access required for audit chain verification');
    }
    const orgId = shared.getSessionOrgId();
    log.audit('audit_chain_verification_requested', { org_id: orgId });
    const result = shared.verifyAuditChain(orgId);
    log.audit('audit_chain_verification_completed', { org_id: orgId, ok: result.ok, broken_at: result.brokenAt || null });
    return result;
  });

  ipcMain.handle('compliance:generate-audit-report', async (_event, options = {}) => {
    const currentUser = requireAuditReader('audit reports');
    return buildAuditReport(currentUser, options);
  });

  /**
   * Produce the same audit trail in human-readable form (21 CFR 11.10(b)).
   *
   * `format` selects the representation:
   *   'json' — electronic form, identical to compliance:generate-audit-report
   *   'csv'  — spreadsheet review copy
   *   'html' — self-contained printable document
   *   'all'  — every representation plus a suggested filename base
   *
   * The chain verification result is embedded so a reviewer can see that the
   * exported rows were integrity-checked at the moment of export.
   */
  ipcMain.handle('compliance:export-audit-report', async (_event, options = {}) => {
    const currentUser = requireAuditReader('audit trail export');
    const orgId = shared.getSessionOrgId();

    const format = String(options.format || 'all').toLowerCase();
    if (!['json', 'csv', 'html', 'all'].includes(format)) {
      throw new Error(`Unsupported audit export format: ${format}`);
    }
    const includePatientName = options.includePatientName !== false;

    const report = buildAuditReport(currentUser, options);

    let chainVerification = null;
    try {
      chainVerification = shared.verifyAuditChain(orgId);
    } catch (err) {
      log.warn('Audit chain verification unavailable during export', { reason: err.message });
    }

    const exportOptions = { includePatientName, chainVerification };

    // Exporting the audit trail is itself an auditable event. Record what was
    // exported (scope and row count) — never the exported content.
    shared.logAudit(
      'export', 'AuditTrail', orgId, null,
      JSON.stringify({
        message: 'Audit trail exported for inspection',
        format,
        include_patient_name: includePatientName,
        period_start: report.period.start,
        period_end: report.period.end,
        record_count: report.summary.total_entries,
        chain_ok: chainVerification ? chainVerification.ok : null,
      }),
      currentUser.email, currentUser.role
    );

    const result = {
      format,
      generated_at: report.generated_at,
      record_count: report.summary.total_entries,
      chain_verification: chainVerification,
      filename_base: `transtrack-audit-${orgId}-${report.generated_at.replace(/[:.]/g, '-')}`,
    };

    if (format === 'json') return { ...result, json: report };
    if (format === 'csv') return { ...result, csv: auditExport.toCsv(report, exportOptions) };
    if (format === 'html') return { ...result, html: auditExport.toHtml(report, exportOptions) };
    return { ...result, ...auditExport.buildInspectionPackage(report, exportOptions) };
  });
}

/**
 * Query the audit trail and assemble the report object shared by the JSON and
 * human-readable exports.
 */
function buildAuditReport(currentUser, options = {}) {
    const db = getDatabase();
    const orgId = shared.getSessionOrgId();

    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endDate = new Date().toISOString(),
      entityType = null,
      userEmail = null,
      action = null,
      limit = 10000,
    } = options;

    log.info('Generating compliance audit report', {
      org_id: orgId,
      start_date: startDate,
      end_date: endDate,
      entity_type: entityType,
      user_email: userEmail,
    });

    let query = `
      SELECT
        id, org_id, action, entity_type, entity_id,
        patient_name, details, user_email, user_role,
        hipaa_action, access_type, access_justification,
        outcome, error_message, request_id, record_hash,
        created_at
      FROM audit_logs
      WHERE org_id = ?
        AND created_at >= ?
        AND created_at <= ?
    `;
    const params = [orgId, startDate, endDate];

    if (entityType) {
      query += ' AND entity_type = ?';
      params.push(entityType);
    }
    if (userEmail) {
      query += ' AND user_email = ?';
      params.push(userEmail);
    }
    if (action) {
      query += ' AND (action = ? OR hipaa_action = ?)';
      params.push(action, action);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const entries = db.prepare(query).all(...params);

    // Summary statistics
    const totalCount = entries.length;
    const actionCounts = {};
    const entityTypeCounts = {};
    const userCounts = {};
    const outcomeCounts = { SUCCESS: 0, FAILURE: 0, UNKNOWN: 0 };

    for (const entry of entries) {
      const a = entry.hipaa_action || entry.action || 'UNKNOWN';
      actionCounts[a] = (actionCounts[a] || 0) + 1;

      const et = entry.entity_type || 'UNKNOWN';
      entityTypeCounts[et] = (entityTypeCounts[et] || 0) + 1;

      const u = entry.user_email || 'system';
      userCounts[u] = (userCounts[u] || 0) + 1;

      const o = entry.outcome || 'UNKNOWN';
      outcomeCounts[o] = (outcomeCounts[o] || 0) + 1;
    }

    const report = {
      report_type: 'HIPAA_AUDIT_TRAIL',
      generated_at: new Date().toISOString(),
      organization_id: orgId,
      organization_name: currentUser.org_name || orgId,
      period: { start: startDate, end: endDate },
      summary: {
        total_entries: totalCount,
        by_action: actionCounts,
        by_entity_type: entityTypeCounts,
        by_user: userCounts,
        by_outcome: outcomeCounts,
      },
      entries,
    };

    log.audit('compliance_report_generated', {
      org_id: orgId,
      period_start: startDate,
      period_end: endDate,
      total_entries: totalCount,
    });

    return report;
}

module.exports = { register, buildAuditReport, AUDIT_READER_ROLES };
