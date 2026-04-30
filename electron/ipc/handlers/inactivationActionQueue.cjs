/**
 * TransTrack — Inactivation Prevention Action Queue + Outcomes IPC handlers.
 *
 * Channels:
 *
 *   actionQueue:build                  — build the prioritised action queue
 *                                        for the entire active waitlist
 *   actionQueue:topInterventionsForPatient
 *                                      — top-N interventions for a single
 *                                        patient (for the patient page)
 *   actionQueue:recordIntervention     — log a coordinator action and the
 *                                        score snapshot at the moment of action
 *   actionQueue:recordOutcome          — log the measured "after" assessment
 *                                        for a previously-recorded action
 *   actionQueue:getInterventionsForPatient
 *                                      — patient intervention history
 *   actionQueue:getInterventionEffectiveness
 *                                      — center-level rollup (manager dashboard)
 *
 * Every channel:
 *   • requires an authenticated session,
 *   • is org-scoped (no cross-org leakage),
 *   • is audit-logged,
 *   • returns the engine model version so the UI can show "scored against
 *     model 2.0.0" alongside every reported number.
 */

'use strict';

const { ipcMain } = require('electron');
const engine = require('../../services/inactivationRiskEngine.cjs');
const queueSvc = require('../../services/inactivationActionQueue.cjs');
const outcomes = require('../../services/preventionOutcomes.cjs');
const digest = require('../../services/preventionDigest.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('actionQueue:build', async (_event, opts = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const allowed = ['admin', 'coordinator', 'physician', 'regulator'];
    if (!currentUser || !allowed.includes(currentUser.role)) {
      throw new Error('Action queue requires admin, coordinator, physician, or regulator role.');
    }
    const orgId = shared.getSessionOrgId();
    const result = queueSvc.buildActionQueueFromDatabase(orgId, {
      size: opts.size,
      includeRiskLevels: opts.includeRiskLevels,
    });

    shared.logAudit(
      'build', 'InactivationActionQueue', null, null,
      JSON.stringify({
        candidatesScreened: result.candidatesScreened,
        queueSize: result.queueSize,
        modelVersion: result.modelVersion,
        queueVersion: result.queueVersion,
      }),
      currentUser?.email,
      currentUser?.role
    );
    return result;
  });

  ipcMain.handle('actionQueue:topInterventionsForPatient', async (_event, params = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const { patientId, n } = params;
    if (!patientId) throw new Error('patientId is required');
    const inputs = engine.buildInputsFromDatabase(orgId, patientId);
    const assessment = engine.assessInactivationRisk(inputs);
    return {
      patientId,
      modelVersion: assessment.modelVersion,
      score: assessment.score,
      riskLevel: assessment.riskLevel,
      probabilities: assessment.probabilities,
      topInterventions: queueSvc.getTopInterventions(assessment, n || 3),
    };
  });

  ipcMain.handle('actionQueue:recordIntervention', async (_event, params = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const allowed = ['admin', 'coordinator', 'physician'];
    if (!currentUser || !allowed.includes(currentUser.role)) {
      throw new Error('Recording an intervention requires admin, coordinator, or physician role.');
    }
    const orgId = shared.getSessionOrgId();
    const { patientId, interventionType, targetFactor, notes } = params;
    if (!patientId)        throw new Error('patientId is required');
    if (!interventionType) throw new Error('interventionType is required');

    // Capture the engine score AT THE MOMENT OF THE ACTION. This is the
    // score that proves what the coordinator was reacting to.
    const inputs = engine.buildInputsFromDatabase(orgId, patientId);
    const assessmentBefore = engine.assessInactivationRisk(inputs);

    const { getDatabase } = require('../../database/init.cjs');
    const db = getDatabase();

    const { id } = outcomes.recordIntervention(db, {
      orgId,
      patientId,
      interventionType,
      targetFactor: targetFactor || null,
      assessmentBefore,
      notes: notes || null,
      performedBy: currentUser.email,
      performedRole: currentUser.role,
    });

    shared.logAudit(
      'create', 'PreventionIntervention', id, null,
      JSON.stringify({
        patientId, interventionType, targetFactor: targetFactor || null,
        scoreBefore: assessmentBefore.score,
        riskLevelBefore: assessmentBefore.riskLevel,
        modelVersion: assessmentBefore.modelVersion,
      }),
      currentUser?.email,
      currentUser?.role
    );

    return {
      id,
      assessmentBefore: {
        score: assessmentBefore.score,
        riskLevel: assessmentBefore.riskLevel,
        probabilityWithin90Days: assessmentBefore.probabilities.within90Days,
        modelVersion: assessmentBefore.modelVersion,
      },
    };
  });

  ipcMain.handle('actionQueue:recordOutcome', async (_event, params = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const allowed = ['admin', 'coordinator', 'physician'];
    if (!currentUser || !allowed.includes(currentUser.role)) {
      throw new Error('Recording an outcome requires admin, coordinator, or physician role.');
    }
    const orgId = shared.getSessionOrgId();
    const { interventionId, patientId } = params;
    if (!interventionId) throw new Error('interventionId is required');
    if (!patientId)      throw new Error('patientId is required');

    const inputs = engine.buildInputsFromDatabase(orgId, patientId);
    const assessmentAfter = engine.assessInactivationRisk(inputs);

    const { getDatabase } = require('../../database/init.cjs');
    const db = getDatabase();

    const r = outcomes.recordOutcome(db, {
      orgId,
      interventionId,
      assessmentAfter,
    });

    shared.logAudit(
      'update', 'PreventionIntervention', interventionId, null,
      JSON.stringify({
        patientId,
        scoreAfter: assessmentAfter.score,
        riskLevelAfter: assessmentAfter.riskLevel,
        measuredScoreDelta: r.measured_score_delta,
        modelVersion: assessmentAfter.modelVersion,
      }),
      currentUser?.email,
      currentUser?.role
    );

    return {
      ...r,
      assessmentAfter: {
        score: assessmentAfter.score,
        riskLevel: assessmentAfter.riskLevel,
        probabilityWithin90Days: assessmentAfter.probabilities.within90Days,
        modelVersion: assessmentAfter.modelVersion,
      },
    };
  });

  ipcMain.handle('actionQueue:getInterventionsForPatient', async (_event, params = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const { patientId } = params;
    if (!patientId) throw new Error('patientId is required');
    const { getDatabase } = require('../../database/init.cjs');
    return outcomes.getInterventionsForPatient(getDatabase(), orgId, patientId);
  });

  ipcMain.handle('actionQueue:buildDigest', async (_event, params = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const allowed = ['admin', 'coordinator', 'regulator'];
    if (!currentUser || !allowed.includes(currentUser.role)) {
      throw new Error('Manager digest requires admin, coordinator, or regulator role.');
    }
    const orgId = shared.getSessionOrgId();
    const result = digest.buildDigestFromDatabase(orgId, {
      actionQueueSize: params?.actionQueueSize,
      effectivenessWindowDays: params?.effectivenessWindowDays,
      costPerInactivationUSD: params?.costPerInactivationUSD,
    });
    shared.logAudit(
      'build', 'PreventionDigest', null, null,
      JSON.stringify({
        candidates: result.headline.activeCandidatesScreened,
        avoided: result.headline.inactivationsAvoided,
        dollarsAvoided: result.headline.estimatedDollarsAvoided,
        modelVersion: result.modelVersion,
        digestVersion: result.digestVersion,
      }),
      currentUser?.email,
      currentUser?.role
    );
    return result;
  });

  ipcMain.handle('actionQueue:getInterventionEffectiveness', async (_event, params = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    const allowed = ['admin', 'coordinator', 'regulator'];
    if (!currentUser || !allowed.includes(currentUser.role)) {
      throw new Error('Center-level effectiveness reporting requires admin, coordinator, or regulator role.');
    }
    const orgId = shared.getSessionOrgId();
    const { getDatabase } = require('../../database/init.cjs');
    const report = outcomes.getInterventionEffectiveness(getDatabase(), orgId, {
      windowDays: params?.windowDays,
    });

    shared.logAudit(
      'read', 'PreventionEffectivenessReport', null, null,
      JSON.stringify({
        windowDays: report.windowDays,
        recorded: report.totals.recorded,
        measured: report.totals.measured,
        weightedAvgScoreDelta: report.totals.weightedAvgScoreDelta,
      }),
      currentUser?.email,
      currentUser?.role
    );
    return report;
  });
}

module.exports = { register };
