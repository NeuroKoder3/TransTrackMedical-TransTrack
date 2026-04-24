/**
 * Transplant calculator IPC handlers.
 * Channels: calculator:meld, calculator:meldNa, calculator:meld3,
 *           calculator:peld, calculator:las, calculator:kdpi, calculator:epts
 *
 * All calculators are pure-function and side-effect-free; we still gate them
 * on session validation so non-authenticated callers cannot probe.
 *
 * Audit: every successful calculation logs a low-cardinality audit row
 * (formula + bound/unbound score), no PHI in the details payload.
 */

'use strict';

const { ipcMain } = require('electron');
const calc = require('../../services/calculators/index.cjs');
const shared = require('../shared.cjs');

function audit(formula, result) {
  try {
    const { currentUser } = shared.getSessionState();
    if (!currentUser) return;
    shared.logAudit(
      'calculate',
      'TransplantCalculator',
      formula,
      null,
      JSON.stringify({ formula, computed: result.score !== undefined ? result.score : (result.kdpi ?? result.epts_pct ?? null), insufficient: result.score === null || result.kdpi === null || result.epts_pct === null }),
      currentUser.email,
      currentUser.role
    );
  } catch {
    // never fail the calculation due to audit-log errors
  }
}

function register() {
  ipcMain.handle('calculator:meld', async (_event, inputs) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const r = calc.calculateMELD(inputs || {});
    audit('MELD', r);
    return r;
  });

  ipcMain.handle('calculator:meldNa', async (_event, inputs) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const r = calc.calculateMELDNa(inputs || {});
    audit('MELD-Na', r);
    return r;
  });

  ipcMain.handle('calculator:meld3', async (_event, inputs) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const r = calc.calculateMELD3(inputs || {});
    audit('MELD-3.0', r);
    return r;
  });

  ipcMain.handle('calculator:peld', async (_event, inputs) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const r = calc.calculatePELD(inputs || {});
    audit('PELD', r);
    return r;
  });

  ipcMain.handle('calculator:las', async (_event, inputs) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const r = calc.calculateLAS(inputs || {});
    audit('LAS', r);
    return r;
  });

  ipcMain.handle('calculator:kdpi', async (_event, inputs) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const r = calc.calculateKDPI(inputs || {});
    audit('KDPI', r);
    return r;
  });

  ipcMain.handle('calculator:epts', async (_event, inputs) => {
    if (!shared.validateSession()) throw new Error('Session expired. Please log in again.');
    const r = calc.calculateEPTS(inputs || {});
    audit('EPTS', r);
    return r;
  });

  ipcMain.handle('calculator:listFormulas', async () => ({
    formulas: calc.ALL_FORMULAS,
    requiredFields: {
      MELD: calc.REQUIRED_FIELDS.MELD,
      'MELD-Na': calc.REQUIRED_FIELDS['MELD-Na'],
      'MELD-3.0': calc.REQUIRED_FIELDS['MELD-3.0'],
      PELD: calc.REQUIRED_FIELDS.PELD,
      LAS: calc.REQUIRED_FIELDS.LAS,
      KDPI: calc.REQUIRED_FIELDS.KDPI,
      EPTS: calc.REQUIRED_FIELDS.EPTS,
    },
    disclaimer: calc.DISCLAIMER,
  }));
}

module.exports = { register };
