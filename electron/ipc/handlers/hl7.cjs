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
const ingestService = require('../../services/hl7Ingest.cjs');
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

  // Lift a raw HL7 message into internal entities (Patient, LabResult).
  // Caller can pass either { raw, parsed, options } or just { raw }.
  // Restricted to admin/coordinator roles to avoid drive-by writes.
  ipcMain.handle('hl7:ingest', async (_event, params) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    if (!['admin', 'coordinator'].includes(currentUser.role)) {
      throw new Error('Only admin or coordinator can ingest HL7 messages.');
    }
    const orgId = shared.getSessionOrgId();
    const { raw, parsed: providedParsed, options } = params || {};
    const parsed = providedParsed || (raw ? hl7.parseMessage(raw) : null);
    if (!parsed) throw new Error('Either `raw` or `parsed` must be provided.');

    const summary = ingestService.ingest({
      orgId,
      parsed,
      options: options || {},
      userEmail: currentUser.email,
      userId: currentUser.id,
    });

    shared.logAudit('hl7_ingest', 'Hl7Message', parsed.message_control_id || null, null,
      JSON.stringify({
        message_type: parsed.message_type,
        trigger_event: parsed.trigger_event,
        ok: summary.ok,
        patient_action: summary.patient ? summary.patient.action : null,
        labs_inserted: summary.labs.inserted,
        labs_skipped: summary.labs.skipped,
      }),
      currentUser.email, currentUser.role);
    return summary;
  });
}

module.exports = { register };
