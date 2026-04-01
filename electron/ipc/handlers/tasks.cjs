/**
 * TransTrack - Task Engine IPC Handlers
 * Handles: tasks:create, tasks:update, tasks:delete, tasks:getAll,
 *          tasks:getByPatient, tasks:getDashboard, tasks:generateAuto,
 *          tasks:processEscalations, tasks:getEscalationRules,
 *          tasks:saveEscalationRule, tasks:deleteEscalationRule
 */

const { ipcMain } = require('electron');
const taskEngine = require('../../services/taskEngine.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('tasks:create', async (_event, taskData) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const task = taskEngine.createTask(orgId, taskData, currentUser.email);
    shared.logAudit('create', 'Task', task.id, null, `Task created: ${task.title}`, currentUser.email, currentUser.role);
    return task;
  });

  ipcMain.handle('tasks:update', async (_event, taskId, updates) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const task = taskEngine.updateTask(orgId, taskId, updates, currentUser.email);
    shared.logAudit('update', 'Task', task.id, null, `Task updated: ${task.title}`, currentUser.email, currentUser.role);
    return task;
  });

  ipcMain.handle('tasks:delete', async (_event, taskId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    shared.logAudit('delete', 'Task', taskId, null, 'Task deleted', currentUser.email, currentUser.role);
    return taskEngine.deleteTask(orgId, taskId);
  });

  ipcMain.handle('tasks:getAll', async (_event, filters) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return taskEngine.getAllTasks(orgId, filters || {});
  });

  ipcMain.handle('tasks:getByPatient', async (_event, patientId, includeCompleted) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return taskEngine.getTasksByPatient(orgId, patientId, includeCompleted);
  });

  ipcMain.handle('tasks:getDashboard', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return taskEngine.getTaskDashboard(orgId);
  });

  ipcMain.handle('tasks:generateAuto', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const result = taskEngine.generateAutoTasks(orgId, currentUser.email);
    shared.logAudit('execute', 'TaskEngine', null, null, `Auto-generated ${result.generated} tasks`, currentUser.email, currentUser.role);
    return result;
  });

  ipcMain.handle('tasks:processEscalations', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    const result = taskEngine.processEscalations(orgId);
    if (result.escalated.length > 0) {
      shared.logAudit('execute', 'TaskEscalation', null, null, `Escalated ${result.escalated.length} tasks`, currentUser.email, currentUser.role);
    }
    return result;
  });

  ipcMain.handle('tasks:getEscalationRules', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    return taskEngine.getEscalationRules(orgId);
  });

  ipcMain.handle('tasks:saveEscalationRule', async (_event, ruleData) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    return taskEngine.saveEscalationRule(orgId, ruleData, currentUser.email);
  });

  ipcMain.handle('tasks:deleteEscalationRule', async (_event, ruleId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const orgId = shared.getSessionOrgId();
    shared.logAudit('delete', 'TaskEscalationRule', ruleId, null, 'Escalation rule deleted', currentUser.email, currentUser.role);
    return taskEngine.deleteEscalationRule(orgId, ruleId);
  });
}

module.exports = { register };
