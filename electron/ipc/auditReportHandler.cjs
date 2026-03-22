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

const log = createLogger('auditReport');

function register() {
  ipcMain.handle('compliance:generate-audit-report', async (_event, options = {}) => {
    const db = getDatabase();
    const org = getDefaultOrganization();

    if (!org) throw new Error('No organization configured');

    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endDate = new Date().toISOString(),
      entityType = null,
      userEmail = null,
      action = null,
      limit = 10000,
    } = options;

    const orgId = org.id;

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
      organization_name: org.name,
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
  });
}

module.exports = { register };
