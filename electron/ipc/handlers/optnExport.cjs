/**
 * OPTN-style CSV export IPC handlers.
 * Channels: optn:exportTCR, optn:exportTRR, optn:exportTRF
 *
 * All handlers are role-gated to admin or coordinator. Each export records
 * an audit row with the row count (no PHI).
 */

'use strict';

const { ipcMain } = require('electron');
const optn = require('../../services/optnExport.cjs');
const shared = require('../shared.cjs');

function requireExportRole() {
  if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
  const { currentUser } = shared.getSessionState();
  if (!currentUser || !['admin', 'coordinator', 'regulator'].includes(currentUser.role)) {
    throw new Error('Insufficient role to export OPTN data');
  }
  return currentUser;
}

function register() {
  ipcMain.handle('optn:exportTCR', async (_event, params = {}) => {
    const user = requireExportRole();
    const orgId = shared.getSessionOrgId();
    const r = optn.exportTCR(orgId, params);
    shared.logAudit('export', 'OPTN-TCR', null, null,
      JSON.stringify({ row_count: r.rowCount, since: params.since, until: params.until }),
      user.email, user.role);
    return r;
  });

  ipcMain.handle('optn:exportTRR', async (_event, params = {}) => {
    const user = requireExportRole();
    const orgId = shared.getSessionOrgId();
    const r = optn.exportTRR(orgId, params);
    shared.logAudit('export', 'OPTN-TRR', null, null,
      JSON.stringify({ row_count: r.rowCount, since: params.since, until: params.until }),
      user.email, user.role);
    return r;
  });

  ipcMain.handle('optn:exportTRF', async () => {
    const user = requireExportRole();
    const orgId = shared.getSessionOrgId();
    const r = optn.exportTRF(orgId);
    shared.logAudit('export', 'OPTN-TRF', null, null,
      JSON.stringify({ row_count: r.rowCount }), user.email, user.role);
    return r;
  });
}

module.exports = { register };
