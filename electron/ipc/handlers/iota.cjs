/**
 * TransTrack — CMS IOTA notification IPC handlers.
 *
 * Channels:
 *
 *   iota:getConfig            — read the centre's notice configuration
 *   iota:saveConfig           — store it (template validated before saving)
 *   iota:previewTemplate      — validate a draft template without saving
 *   iota:recordTransition     — record a waitlist status change; creates the
 *                               notification obligation when it blocks offers
 *   iota:listTransitions      — transition history
 *   iota:generateNotice       — (re)generate the notice for a transition
 *   iota:listNotifications    — the obligation queue
 *   iota:getNotification      — a single notice including its rendered body
 *   iota:markDelivered        — record delivery to the patient
 *   iota:markSecondaryNotified — record the copy to facility/provider
 *   iota:getSummary           — centre-level compliance posture
 *
 * Every channel requires an authenticated session and is org-scoped from the
 * session rather than from renderer input, so a compromised renderer cannot
 * read or write another centre's notification records.
 *
 * WHY WRITES ARE AUDITED BUT READS ARE NOT: the notification records are
 * themselves the compliance evidence, and every write to them changes what the
 * centre is asserting to CMS. Reads are ordinary operational use of a screen
 * whose contents are already covered by patient-level access logging.
 */

'use strict';

const { ipcMain } = require('electron');
const { getDatabase } = require('../../database/init.cjs');
const svc = require('../../services/iotaNoticeService.cjs');
const generator = require('../../services/iotaNoticeGenerator.cjs');
const shared = require('../shared.cjs');

/** Roles that may view the compliance queue. */
const VIEW_ROLES = ['admin', 'coordinator', 'physician', 'regulator'];
/** Roles that may record obligations and delivery. Regulators observe only. */
const WRITE_ROLES = ['admin', 'coordinator'];
/** Configuration is a compliance decision, so it is administrator-only. */
const CONFIG_ROLES = ['admin'];

function requireRole(allowed, what) {
  if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
  const { currentUser } = shared.getSessionState();
  if (!currentUser || !allowed.includes(currentUser.role)) {
    throw new Error(`${what} requires ${allowed.join(' or ')} role.`);
  }
  return { user: currentUser, orgId: shared.getSessionOrgId(), db: getDatabase() };
}

function register() {
  // --- configuration -------------------------------------------------------

  ipcMain.handle('iota:getConfig', async () => {
    const { db, orgId } = requireRole(VIEW_ROLES, 'Viewing IOTA configuration');
    return svc.getConfig(db, orgId);
  });

  ipcMain.handle('iota:saveConfig', async (_e, config) => {
    const { db, orgId, user } = requireRole(CONFIG_ROLES, 'Changing IOTA configuration');
    const result = svc.saveConfig(db, orgId, config || {});

    // The template determines the wording of a statutorily required patient
    // notice, so a change to it is a compliance-relevant event. The hash is
    // recorded rather than the body, which would put PHI-adjacent letterhead
    // content into the audit trail.
    shared.logAudit(
      'update', 'IotaNoticeConfig', orgId, null,
      JSON.stringify({
        templateSha256: result.templateSha256,
        templateValid: result.templateValid,
        ready: result.ready,
      }),
      user.email, user.role,
    );
    return result;
  });

  ipcMain.handle('iota:previewTemplate', async (_e, template) => {
    requireRole(CONFIG_ROLES, 'Validating an IOTA template');
    if (typeof template !== 'string') throw new Error('template must be a string');
    return generator.validateTemplate(template);
  });

  // --- transitions ---------------------------------------------------------

  ipcMain.handle('iota:recordTransition', async (_e, input) => {
    const { db, orgId, user } = requireRole(WRITE_ROLES, 'Recording a waitlist status change');
    const result = svc.recordTransition(
      db,
      { ...(input || {}), orgId },
      { id: user.id, email: user.email, role: user.role },
    );

    shared.logAudit(
      'create', 'WaitlistStatusTransition', result.transitionId, null,
      JSON.stringify({
        toStatus: input?.toStatus,
        offerEligibilityImpact: input?.offerEligibilityImpact,
        obligated: result.obligated,
        noticeGenerated: !!result.notice,
        noticeError: result.noticeError,
      }),
      user.email, user.role,
    );
    return result;
  });

  ipcMain.handle('iota:listTransitions', async (_e, opts = {}) => {
    const { db, orgId } = requireRole(VIEW_ROLES, 'Viewing waitlist status history');
    return svc.listTransitions(db, orgId, opts);
  });

  // --- notices -------------------------------------------------------------

  ipcMain.handle('iota:generateNotice', async (_e, opts = {}) => {
    const { db, orgId, user } = requireRole(WRITE_ROLES, 'Generating an IOTA notice');
    const notice = svc.generateForTransition(
      db,
      { orgId, transitionId: opts.transitionId, noticeKind: opts.noticeKind, revision: opts.revision },
      { id: user.id, email: user.email, role: user.role },
    );

    shared.logAudit(
      'create', 'IotaNotification', notice.id, notice.patientName,
      JSON.stringify({
        transitionId: opts.transitionId,
        noticeKind: notice.notice_kind,
        contentSha256: notice.content_sha256,
        dueAt: notice.due_at,
        revision: opts.revision || 0,
      }),
      user.email, user.role,
    );
    return notice;
  });

  ipcMain.handle('iota:listNotifications', async (_e, opts = {}) => {
    const { db, orgId } = requireRole(VIEW_ROLES, 'Viewing the IOTA notification queue');
    return svc.listNotifications(db, orgId, opts);
  });

  ipcMain.handle('iota:getNotification', async (_e, id) => {
    const { db, orgId } = requireRole(VIEW_ROLES, 'Viewing an IOTA notice');
    return svc.getNotification(db, orgId, id);
  });

  ipcMain.handle('iota:markDelivered', async (_e, { id, channel, deliveredAt, patientDeclined } = {}) => {
    const { db, orgId, user } = requireRole(WRITE_ROLES, 'Recording IOTA notice delivery');
    const notice = svc.markDelivered(db, orgId, id, { channel, deliveredAt, patientDeclined });

    shared.logAudit(
      'update', 'IotaNotification', id, notice.patientName,
      JSON.stringify({
        deliveredAt: notice.delivered_at,
        channel,
        patientDeclined: !!patientDeclined,
        deliveredLate: notice.deliveredLate,
      }),
      user.email, user.role,
    );
    return notice;
  });

  ipcMain.handle('iota:markSecondaryNotified', async (_e, { id, notifiedAt } = {}) => {
    const { db, orgId, user } = requireRole(WRITE_ROLES, 'Recording secondary notification');
    const notice = svc.markSecondaryNotified(db, orgId, id, { notifiedAt });

    shared.logAudit(
      'update', 'IotaNotification', id, notice.patientName,
      JSON.stringify({
        secondaryNotifiedAt: notice.secondary_notified_at,
        recipientType: notice.secondary_recipient_type,
      }),
      user.email, user.role,
    );
    return notice;
  });

  ipcMain.handle('iota:fileToChart', async (_e, { id, mode, epicPatientId, typeCoding } = {}) => {
    const { db, orgId, user } = requireRole(WRITE_ROLES, 'Filing an IOTA notice to the chart');

    // No `submit` transport is passed. Live DocumentReference.Create requires
    // per-organisation enablement by the site's Epic team plus configured
    // credentials; until that exists the desktop app can dry-run and record a
    // manual filing, and cannot reach the network from this path at all.
    const result = await svc.fileToChart(db, orgId, id, { mode, epicPatientId, typeCoding });

    shared.logAudit(
      'update', 'IotaNotification', id, result.notice.patientName,
      JSON.stringify({
        chartWriteStatus: result.outcome.status,
        chartWriteChannel: result.outcome.channel,
        documentReferenceId: result.outcome.documentReferenceId,
        error: result.outcome.error,
      }),
      user.email, user.role,
    );
    return result;
  });

  ipcMain.handle('iota:getSummary', async () => {
    const { db, orgId } = requireRole(VIEW_ROLES, 'Viewing IOTA compliance status');
    return svc.getComplianceSummary(db, orgId);
  });
}

module.exports = { register, VIEW_ROLES, WRITE_ROLES, CONFIG_ROLES };
