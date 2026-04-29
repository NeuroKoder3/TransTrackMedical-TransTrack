/**
 * TransTrack — Inactivation Risk Engine IPC handlers
 *
 * Channels:
 *   inactivationRisk:assessPatient            — single-patient assessment
 *   inactivationRisk:simulateIntervention     — counterfactual ("what if")
 *   inactivationRisk:projectCenterImpact      — center-level KPIs / ROI
 *   inactivationRisk:getModelInfo             — model version + weights
 *
 * Every channel:
 *   • requires an authenticated session,
 *   • is scoped to the current user's org_id (no cross-org leakage),
 *   • is audit-logged,
 *   • returns the full decomposed assessment so the UI / partner systems
 *     can show *why* the score was produced.
 *
 * The engine itself is pure. This handler is the only place that touches
 * the database to build the input snapshot.
 */

'use strict';

const { ipcMain } = require('electron');
const engine = require('../../services/inactivationRiskEngine.cjs');
const shared = require('../shared.cjs');

function register() {
  ipcMain.handle('inactivationRisk:getModelInfo', async () => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    return {
      modelVersion: engine.MODEL_VERSION,
      factorWeights: engine.FACTOR_WEIGHTS,
      riskThresholds: engine.RISK_THRESHOLDS,
      defaultInactivationCostUSD: engine.DEFAULT_INACTIVATION_COST_USD,
    };
  });

  ipcMain.handle('inactivationRisk:assessPatient', async (_event, patientId) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    if (!patientId) throw new Error('patientId is required');

    const inputs = engine.buildInputsFromDatabase(orgId, patientId);
    const assessment = engine.assessInactivationRisk(inputs);

    const { currentUser } = shared.getSessionState();
    shared.logAudit(
      'assess', 'InactivationRisk', patientId, null,
      JSON.stringify({
        score: assessment.score,
        riskLevel: assessment.riskLevel,
        modelVersion: assessment.modelVersion,
        inputsFingerprint: assessment.inputsFingerprint,
      }),
      currentUser?.email,
      currentUser?.role
    );

    return { assessment, inputs };
  });

  ipcMain.handle('inactivationRisk:simulateIntervention', async (_event, params = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const orgId = shared.getSessionOrgId();
    const { patientId, intervention } = params;
    if (!patientId)    throw new Error('patientId is required');
    if (!intervention) throw new Error('intervention is required');

    const inputs = engine.buildInputsFromDatabase(orgId, patientId);
    const result = engine.simulateIntervention(inputs, intervention);

    const { currentUser } = shared.getSessionState();
    shared.logAudit(
      'simulate', 'InactivationRisk', patientId, null,
      JSON.stringify({
        intervention: intervention.type,
        scoreReduction: result.scoreReduction,
        before: result.before.score,
        after: result.after.score,
      }),
      currentUser?.email,
      currentUser?.role
    );

    return result;
  });

  ipcMain.handle('inactivationRisk:projectCenterImpact', async (_event, opts = {}) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const { currentUser } = shared.getSessionState();
    // Center-level reporting is restricted to admin / coordinator / regulator
    // because it surfaces aggregate ROI numbers used in operational reviews.
    const allowed = ['admin', 'coordinator', 'regulator'];
    if (!currentUser || !allowed.includes(currentUser.role)) {
      throw new Error('Center-level inactivation projection requires admin, coordinator, or regulator role.');
    }
    const orgId = shared.getSessionOrgId();
    const { getDatabase } = require('../../database/init.cjs');
    const db = getDatabase();

    const patients = db.prepare(
      `SELECT id FROM patients WHERE org_id = ? AND waitlist_status = 'active'`
    ).all(orgId);

    const inputs = patients.map(p =>
      engine.buildInputsFromDatabase(orgId, p.id, { db })
    );
    const projection = engine.projectCenterImpact(inputs, {
      costPerInactivationUSD: opts.costPerInactivationUSD,
      interventionCapPerCandidate: opts.interventionCapPerCandidate,
    });

    shared.logAudit(
      'project', 'InactivationRisk', null, null,
      JSON.stringify({
        candidates: projection.candidates,
        avoided: projection.expectedInactivationsWithin90Days.avoided,
        dollarsAvoided: projection.estimatedDollarsAvoided,
      }),
      currentUser?.email,
      currentUser?.role
    );

    return projection;
  });
}

module.exports = { register };
