/**
 * SIEM destination IPC handlers (admin-only).
 * Channels: siem:list, siem:create, siem:update, siem:delete, siem:test
 */

'use strict';

const { ipcMain } = require('electron');
const siem = require('../../services/siemForwarder.cjs');
const shared = require('../shared.cjs');

function requireAdmin() {
  if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
  const { currentUser } = shared.getSessionState();
  if (!currentUser || currentUser.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return currentUser;
}

function register() {
  ipcMain.handle('siem:list', async () => {
    requireAdmin();
    return siem.listDestinations(shared.getSessionOrgId());
  });

  ipcMain.handle('siem:create', async (_event, data) => {
    const user = requireAdmin();
    const orgId = shared.getSessionOrgId();
    const created = siem.createDestination({ orgId, ...data, createdBy: user.email });
    shared.logAudit('create', 'SiemDestination', created.id, null,
      JSON.stringify({ host: created.host, port: created.port, protocol: created.protocol }),
      user.email, user.role);
    return created;
  });

  ipcMain.handle('siem:update', async (_event, params) => {
    const user = requireAdmin();
    const orgId = shared.getSessionOrgId();
    const updated = siem.updateDestination({ id: params.id, orgId, fields: params.fields || {} });
    shared.logAudit('update', 'SiemDestination', params.id, null,
      JSON.stringify({ fields: Object.keys(params.fields || {}) }), user.email, user.role);
    return updated;
  });

  ipcMain.handle('siem:delete', async (_event, id) => {
    const user = requireAdmin();
    const orgId = shared.getSessionOrgId();
    const r = siem.deleteDestination(id, orgId);
    shared.logAudit('delete', 'SiemDestination', id, null, null, user.email, user.role);
    return r;
  });

  ipcMain.handle('siem:test', async (_event, id) => {
    const user = requireAdmin();
    const orgId = shared.getSessionOrgId();
    shared.logAudit('siem_test', 'SiemDestination', id, null, null, user.email, user.role);
    return await siem.testDestination(id, orgId);
  });
}

module.exports = { register };
