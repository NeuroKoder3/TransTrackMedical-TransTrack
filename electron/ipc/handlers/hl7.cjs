/**
 * HL7 v2 IPC handlers.
 * Channels: hl7:parse, hl7:buildAck
 *
 * Parsing is read-only and side-effect free; we still gate on session
 * validation so anonymous callers cannot probe.
 */

'use strict';

const { ipcMain } = require('electron');
const hl7 = require('../../services/hl7v2.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('hl7:parse', async (_event, rawMessage) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const parsed = hl7.parseMessage(rawMessage);
    const { currentUser } = shared.getSessionState();
    shared.logAudit('hl7_parse', 'Hl7Message', parsed.message_control_id || null, null,
      JSON.stringify({ message_type: parsed.message_type, trigger_event: parsed.trigger_event, supported: parsed.supported }),
      currentUser.email, currentUser.role);
    return parsed;
  });

  ipcMain.handle('hl7:buildAck', async (_event, params) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { parsed_or_raw, code, message } = params || {};
    return { ack: hl7.buildAck(parsed_or_raw || {}, code || 'AA', message || '') };
  });

  ipcMain.handle('hl7:supportedEvents', async () => hl7.SUPPORTED_EVENTS);
}

module.exports = { register };
