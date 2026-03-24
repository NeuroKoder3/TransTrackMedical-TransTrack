/**
 * TransTrack - Priority Scoring & Donor Matching Algorithm Tests
 *
 * Validates:
 *  - Priority scoring: all components, weights, edge cases, UNOS/OPTN alignment
 *  - Donor matching: blood type, HLA, size, crossmatch, ranking
 *  - Boundary conditions, ties, unusual organ types, no-data scenarios
 *
 * Usage: node tests/algorithms.test.cjs
 */

'use strict';

const path = require('path');

// ─── Mock Electron ──────────────────────────────────────────────
const mockUserDataPath = path.join(__dirname, '.test-data-algo-' + Date.now());
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: { getPath: () => mockUserDataPath, isPackaged: false },
    ipcMain: { handle: () => {} },
    dialog: {},
  },
};

const { v4: uuidv4 } = require('uuid');
const functions = require('../electron/functions/index.cjs');

// ─── Test harness ───────────────────────────────────────────────
const results = { passed: 0, failed: 0, errors: [] };

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    results.failed++;
    results.errors.push({ test: name, error: e.message });
  }
}

function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertApprox(a, b, tolerance, msg) {
  if (Math.abs(a - b) > tolerance) throw new Error(`${msg}: expected ~${b}, got ${a} (tolerance ${tolerance})`);
}
function assertInRange(val, min, max, msg) {
  if (val < min || val > max) throw new Error(`${msg}: ${val} not in [${min}, ${max}]`);
}

// ─── Mock DB helpers ─────────────────────────────────────────────

/** Create a mock DB with patients table for priority scoring */
function createMockPriorityDb(patient, weights = null) {
  const defaultWeights = {
    medical_urgency_weight: 30, time_on_waitlist_weight: 25,
    organ_specific_score_weight: 25, evaluation_recency_weight: 10,
    blood_type_rarity_weight: 10, evaluation_decay_rate: 0.5, is_active: 1,
  };
  const w = weights || defaultWeights;

  return {
    prepare: (sql) => ({
      get: (id) => {
        if (sql.includes('patients')) return patient;
        if (sql.includes('priority_weights')) return w;
        return null;
      },
      run: () => ({ changes: 1 }),
      all: () => [],
    }),
  };
}

/** Create a mock context */
function createContext(db) {
  return {
    db,
    currentUser: { email: 'test@test.com', role: 'admin' },
    logAudit: () => {},
  };
}

/** Create a mock DB for donor matching */
function createMockMatchingDb(donor, patients) {
  return {
    prepare: (sql) => ({
      get: (id) => {
        if (sql.includes('donor_organs')) return donor;
        return null;
      },
      all: (...args) => {
        if (sql.includes('patients')) return patients;
        if (sql.includes('users')) return [{ email: 'admin@test.com', role: 'admin' }];
        return [];
      },
      run: () => ({ changes: 1 }),
    }),
  };
}

// =================================================================
// TESTS
// =================================================================

async function runTests() {
  console.log('\n================================================');
  console.log('Priority Scoring & Donor Matching Algorithm Tests');
  console.log('================================================\n');

  // =================================================================
  // Suite 1: Medical Urgency Component
  // =================================================================
  console.log('Suite 1: Medical Urgency Component');
  console.log('----------------------------------');

  await test('1.1: Critical urgency yields highest raw score', async () => {
    const patient = { id: 'p1', medical_urgency: 'critical', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.base, 100, 'Critical base = 100');
  });

  await test('1.2: High urgency = 75', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.base, 75, 'High base = 75');
  });

  await test('1.3: Medium urgency = 50', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.base, 50, 'Medium base = 50');
  });

  await test('1.4: Low urgency = 25', async () => {
    const patient = { id: 'p1', medical_urgency: 'low', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.base, 25, 'Low base = 25');
  });

  await test('1.5: Unknown urgency defaults to 50', async () => {
    const patient = { id: 'p1', medical_urgency: 'unknown', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.base, 50, 'Unknown defaults to 50');
  });

  await test('1.6: Null urgency defaults to 50', async () => {
    const patient = { id: 'p1', medical_urgency: null, blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.base, 50, 'Null defaults to 50');
  });

  // =================================================================
  // Suite 2: Functional Status & Prognosis Multipliers
  // =================================================================
  console.log('\nSuite 2: Functional Status & Prognosis Multipliers');
  console.log('--------------------------------------------------');

  await test('2.1: Critical functional status multiplier = 1.2', async () => {
    const patient = { id: 'p1', medical_urgency: 'critical', functional_status: 'critical', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.functional_adjustment, 1.2, 'Critical functional = 1.2');
  });

  await test('2.2: Fully dependent functional status = 1.1', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', functional_status: 'fully_dependent', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.functional_adjustment, 1.1, 'Fully dependent = 1.1');
  });

  await test('2.3: Independent functional status = 0.95', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', functional_status: 'independent', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.functional_adjustment, 0.95, 'Independent = 0.95');
  });

  await test('2.4: Unknown/null functional status defaults to 1.0', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', functional_status: null, blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.functional_adjustment, 1.0, 'Null functional = 1.0');
  });

  await test('2.5: Critical prognosis = 1.3', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', prognosis_rating: 'critical', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.prognosis_adjustment, 1.3, 'Critical prognosis = 1.3');
  });

  await test('2.6: Excellent prognosis = 0.9', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', prognosis_rating: 'excellent', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.medical_urgency.prognosis_adjustment, 0.9, 'Excellent prognosis = 0.9');
  });

  await test('2.7: Combined critical urgency + critical functional + critical prognosis', async () => {
    const patient = {
      id: 'p1', medical_urgency: 'critical',
      functional_status: 'critical', prognosis_rating: 'critical',
      blood_type: 'O+', organ_needed: 'kidney',
    };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    const expected = 100 * 1.2 * 1.3; // 156
    assertApprox(result.breakdown.components.medical_urgency.final, expected, 0.1, 'Combined critical');
  });

  // =================================================================
  // Suite 3: Time on Waitlist
  // =================================================================
  console.log('\nSuite 3: Time on Waitlist');
  console.log('------------------------');

  await test('3.1: No waitlist date → score 0', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.time_on_waitlist, 0, 'No date → 0');
  });

  await test('3.2: 365 days → ~50% score', async () => {
    const dateOneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', date_added_to_waitlist: dateOneYearAgo };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertApprox(result.breakdown.raw_scores.time_on_waitlist, 50, 2, '1 year ≈ 50');
  });

  await test('3.3: 730 days (2 years) → 100%', async () => {
    const dateTwoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', date_added_to_waitlist: dateTwoYearsAgo };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.time_on_waitlist, 100, '2 years = 100');
  });

  await test('3.4: >3 years gets long-wait bonus (+10)', async () => {
    const dateThreeYearsAgo = new Date(Date.now() - 1100 * 24 * 60 * 60 * 1000).toISOString();
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', date_added_to_waitlist: dateThreeYearsAgo };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.time_on_waitlist.long_wait_bonus, 10, 'Long-wait bonus = 10');
  });

  await test('3.5: Score capped at 100', async () => {
    const dateFiveYearsAgo = new Date(Date.now() - 1825 * 24 * 60 * 60 * 1000).toISOString();
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', date_added_to_waitlist: dateFiveYearsAgo };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertTrue(result.breakdown.raw_scores.time_on_waitlist <= 100, 'Score ≤ 100');
  });

  // =================================================================
  // Suite 4: Organ-Specific Scoring
  // =================================================================
  console.log('\nSuite 4: Organ-Specific Scoring');
  console.log('-------------------------------');

  await test('4.1: Liver uses MELD score', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'liver', meld_score: 30 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.organ_specific.type, 'MELD', 'Uses MELD');
    // MELD 30 → (30-6)/34 * 100 ≈ 70.6
    assertApprox(result.breakdown.components.organ_specific.normalized, 70.59, 0.1, 'MELD 30 ≈ 70.6');
  });

  await test('4.2: MELD score boundary: min (6) → 0%', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'liver', meld_score: 6 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertApprox(result.breakdown.components.organ_specific.normalized, 0, 0.01, 'MELD 6 → 0');
  });

  await test('4.3: MELD score boundary: max (40) → 100%', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'liver', meld_score: 40 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertApprox(result.breakdown.components.organ_specific.normalized, 100, 0.01, 'MELD 40 → 100');
  });

  await test('4.4: Lung uses LAS score directly', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'lung', las_score: 85 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.organ_specific.type, 'LAS', 'Uses LAS');
    assertEq(result.breakdown.components.organ_specific.normalized, 85, 'LAS passed through');
  });

  await test('4.5: Kidney uses PRA + CPRA scoring', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'kidney', pra_percentage: 80, cpra_percentage: 90 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.organ_specific.type, 'Kidney (PRA/CPRA)', 'Uses PRA/CPRA');
    // Base 50 + (80/100)*30 + (90/100)*20 = 50 + 24 + 18 = 92
    assertApprox(result.breakdown.components.organ_specific.normalized, 92, 0.01, 'PRA/CPRA calculation');
  });

  await test('4.6: Kidney with no PRA/CPRA → base 50', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.organ_specific.normalized, 50, 'Kidney base = 50');
  });

  await test('4.7: Kidney PRA/CPRA score capped at 100', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'kidney', pra_percentage: 100, cpra_percentage: 100 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertTrue(result.breakdown.components.organ_specific.normalized <= 100, 'Capped at 100');
  });

  await test('4.8: Heart (unsupported organ-specific) falls back to urgency-based', async () => {
    const patient = { id: 'p1', medical_urgency: 'high', blood_type: 'O+', organ_needed: 'heart' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.organ_specific.type, 'Default (based on urgency)', 'Falls back');
    // urgency high = 75, fallback = 75 * 0.6 = 45
    assertApprox(result.breakdown.components.organ_specific.normalized, 45, 0.01, 'Heart fallback');
  });

  await test('4.9: Pancreas (unsupported) falls back to urgency-based', async () => {
    const patient = { id: 'p1', medical_urgency: 'critical', blood_type: 'O+', organ_needed: 'pancreas' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.components.organ_specific.type, 'Default (based on urgency)', 'Pancreas fallback');
    assertApprox(result.breakdown.components.organ_specific.normalized, 60, 0.01, 'Critical * 0.6 = 60');
  });

  // =================================================================
  // Suite 5: Evaluation Recency Decay
  // =================================================================
  console.log('\nSuite 5: Evaluation Recency Decay');
  console.log('---------------------------------');

  await test('5.1: Evaluation within 90 days → 100', async () => {
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', last_evaluation_date: recent };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.evaluation_recency, 100, 'Within 90 days → 100');
  });

  await test('5.2: Evaluation 180 days ago → decayed (1 period)', async () => {
    const old = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', last_evaluation_date: old };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    // 2 periods → 100 * (1-0.5)^2 = 25
    assertApprox(result.breakdown.raw_scores.evaluation_recency, 25, 1, '180d ≈ 25');
  });

  await test('5.3: No evaluation date → 0', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.evaluation_recency, 0, 'No eval → 0');
    assertEq(result.breakdown.components.evaluation_recency.status, 'No evaluation on record', 'Status message');
  });

  await test('5.4: Very old evaluation (2 years) → near 0', async () => {
    const veryOld = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', last_evaluation_date: veryOld };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertTrue(result.breakdown.raw_scores.evaluation_recency < 1, '2 years → near 0');
  });

  // =================================================================
  // Suite 6: Blood Type Rarity
  // =================================================================
  console.log('\nSuite 6: Blood Type Rarity');
  console.log('-------------------------');

  await test('6.1: AB- (rarest) = 100', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'AB-', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.blood_type_rarity, 100, 'AB- = 100');
  });

  await test('6.2: O+ (most common) = 20', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.blood_type_rarity, 20, 'O+ = 20');
  });

  await test('6.3: B- = 85', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'B-', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.blood_type_rarity, 85, 'B- = 85');
  });

  await test('6.4: Unknown blood type defaults to 40', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'XZ', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.blood_type_rarity, 40, 'Unknown = 40');
  });

  await test('6.5: Null blood type defaults to 40', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: null, organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.raw_scores.blood_type_rarity, 40, 'Null = 40');
  });

  // =================================================================
  // Suite 7: Adjustments (Comorbidity, Transplants, Compliance)
  // =================================================================
  console.log('\nSuite 7: Adjustments');
  console.log('--------------------');

  await test('7.1: Comorbidity score 5 → penalty 5', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', comorbidity_score: 5 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.adjustments.comorbidity_penalty, -5, 'Comorbidity penalty');
  });

  await test('7.2: Max comorbidity (10) → penalty 10', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', comorbidity_score: 10 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.adjustments.comorbidity_penalty, -10, 'Max comorbidity penalty');
  });

  await test('7.3: Previous transplants → -5 each', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', previous_transplants: 2 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.adjustments.previous_transplant_adjustment, -10, '2 transplants → -10');
  });

  await test('7.4: Compliance score 8 → bonus 4', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney', compliance_score: 8 };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertApprox(result.breakdown.adjustments.compliance_bonus, 4, 0.01, 'Compliance bonus');
  });

  await test('7.5: No adjustments when fields absent', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.adjustments.comorbidity_penalty, -0, 'No comorbidity penalty');
    assertEq(result.breakdown.adjustments.previous_transplant_adjustment, 0, 'No transplant adj');
    assertEq(result.breakdown.adjustments.compliance_bonus, 0, 'No compliance bonus');
  });

  // =================================================================
  // Suite 8: Final Score Bounds & Weight System
  // =================================================================
  console.log('\nSuite 8: Final Score & Weight System');
  console.log('------------------------------------');

  await test('8.1: Final score is between 0 and 100', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertInRange(result.priority_score, 0, 100, 'Final score in [0, 100]');
  });

  await test('8.2: Maximum scenario does not exceed 100', async () => {
    const dateOld = new Date(Date.now() - 2000 * 24 * 60 * 60 * 1000).toISOString();
    const recentEval = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const patient = {
      id: 'p1', medical_urgency: 'critical', functional_status: 'critical',
      prognosis_rating: 'critical', blood_type: 'AB-', organ_needed: 'kidney',
      pra_percentage: 100, cpra_percentage: 100,
      date_added_to_waitlist: dateOld, last_evaluation_date: recentEval,
      compliance_score: 10,
    };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertTrue(result.priority_score <= 100, 'Capped at 100');
  });

  await test('8.3: Minimum scenario does not go below 0', async () => {
    const patient = {
      id: 'p1', medical_urgency: 'low', functional_status: 'independent',
      prognosis_rating: 'excellent', blood_type: 'O+', organ_needed: 'kidney',
      comorbidity_score: 10, previous_transplants: 10, compliance_score: 0,
    };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertTrue(result.priority_score >= 0, 'Not below 0');
  });

  await test('8.4: Default weights sum to 100', async () => {
    const patient = { id: 'p1', medical_urgency: 'medium', blood_type: 'O+', organ_needed: 'kidney' };
    const db = createMockPriorityDb(patient);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    const w = result.breakdown.weights_used;
    const weightSum = w.medical_urgency_weight + w.time_on_waitlist_weight +
      w.organ_specific_score_weight + w.evaluation_recency_weight + w.blood_type_rarity_weight;
    assertEq(weightSum, 100, 'Weights sum to 100');
  });

  await test('8.5: Custom weights are respected', async () => {
    const patient = { id: 'p1', medical_urgency: 'critical', blood_type: 'O+', organ_needed: 'kidney' };
    const customWeights = {
      medical_urgency_weight: 50, time_on_waitlist_weight: 20,
      organ_specific_score_weight: 15, evaluation_recency_weight: 10,
      blood_type_rarity_weight: 5, evaluation_decay_rate: 0.5, is_active: 1,
    };
    const db = createMockPriorityDb(patient, customWeights);
    const result = await functions.calculatePriorityAdvanced({ patient_id: 'p1' }, createContext(db));
    assertEq(result.breakdown.weights_used.medical_urgency_weight, 50, 'Custom weight used');
  });

  await test('8.6: Patient not found throws error', async () => {
    const db = { prepare: () => ({ get: () => null, all: () => [], run: () => ({}) }) };
    let threw = false;
    try { await functions.calculatePriorityAdvanced({ patient_id: 'nope' }, createContext(db)); }
    catch (e) { threw = true; assertTrue(e.message.includes('not found'), 'Says not found'); }
    assertTrue(threw, 'Should throw');
  });

  // =================================================================
  // Suite 9: Blood Type Compatibility (Donor Matching)
  // =================================================================
  console.log('\nSuite 9: Blood Type Compatibility (Donor Matching)');
  console.log('--------------------------------------------------');

  await test('9.1: O- donor is universal donor', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'A+', weight_kg: 80, priority_score: 50 },
      { id: 'p2', first_name: 'B', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'B-', weight_kg: 80, priority_score: 50 },
      { id: 'p3', first_name: 'C', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'AB+', weight_kg: 80, priority_score: 50 },
      { id: 'p4', first_name: 'D', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches.length, 4, 'O- matches all 4 types');
    result.matches.forEach(m => assertTrue(m.blood_type_compatible, 'All blood-type compatible'));
  });

  await test('9.2: AB+ donor only matches AB+ recipients', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'AB+', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'A+', weight_kg: 80, priority_score: 50 },
      { id: 'p2', first_name: 'B', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'AB+', weight_kg: 80, priority_score: 50 },
      { id: 'p3', first_name: 'C', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches.length, 1, 'AB+ matches only AB+');
    assertEq(result.matches[0].blood_type, 'AB+', 'Matched AB+');
  });

  await test('9.3: A+ donor matches A+ and AB+ only', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'A+', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'A+', weight_kg: 80, priority_score: 50 },
      { id: 'p2', first_name: 'B', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'AB+', weight_kg: 80, priority_score: 50 },
      { id: 'p3', first_name: 'C', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50 },
      { id: 'p4', first_name: 'D', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'B+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches.length, 2, 'A+ matches A+ and AB+');
  });

  await test('9.4: No compatible blood types → 0 matches', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'AB+', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches.length, 0, 'No compatible matches');
  });

  await test('9.5: Identical blood type gets bonus points', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'A+', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'Same', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'A+', weight_kg: 80, priority_score: 50 },
      { id: 'p2', first_name: 'Diff', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'AB+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertTrue(result.matches[0].compatibility_score > result.matches[1].compatibility_score, 'Same blood type ranked higher');
  });

  // =================================================================
  // Suite 10: HLA Matching
  // =================================================================
  console.log('\nSuite 10: HLA Matching');
  console.log('---------------------');

  await test('10.1: Perfect 6/6 HLA match → 100 score', async () => {
    const hla = 'A1 A2 B7 B8 DR1 DR2';
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: hla, donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', hla_typing: hla, weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].hla_match_score, 100, 'Perfect HLA = 100');
    assertEq(result.matches[0].total_hla_matches, 6, '6/6 matches');
  });

  await test('10.2: Zero HLA matches → 0 score', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: 'A1 A2 B7 B8 DR1 DR2', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', hla_typing: 'A3 A4 B35 B44 DR3 DR4', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].hla_match_score, 0, 'Zero HLA = 0');
    assertEq(result.matches[0].total_hla_matches, 0, '0/6 matches');
  });

  await test('10.3: Partial HLA match (3/6) → 50 score', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: 'A1 A2 B7 B8 DR1 DR2', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', hla_typing: 'A1 A99 B7 B99 DR1 DR99', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].hla_match_score, 50, 'Partial 3/6 = 50');
    assertEq(result.matches[0].total_hla_matches, 3, '3/6 matches');
  });

  await test('10.4: DQ match bonus adds extra points', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: 'A1 A2 B7 B8 DR1 DR2 DQ1', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', hla_typing: 'A1 A2 B7 B8 DR1 DR2 DQ1', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    // 6/6 = 100, but DQ adds +5, capped at 100
    assertTrue(result.matches[0].hla_match_score >= 100, 'DQ bonus keeps at 100');
    assertEq(result.matches[0].hla_matches.DQ, 1, 'DQ match counted');
  });

  await test('10.5: No HLA data defaults to score 50', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].hla_match_score, 50, 'No HLA = 50 default');
  });

  await test('10.6: Higher HLA match ranks higher than lower', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: 'A1 A2 B7 B8 DR1 DR2', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'Few', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', hla_typing: 'A1 A99 B99 B99 DR99 DR99', weight_kg: 80, priority_score: 50 },
      { id: 'p2', first_name: 'Many', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', hla_typing: 'A1 A2 B7 B8 DR1 DR2', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].patient_id, 'p2', 'Better HLA ranked first');
  });

  // =================================================================
  // Suite 11: Size Compatibility
  // =================================================================
  console.log('\nSuite 11: Size Compatibility');
  console.log('---------------------------');

  await test('11.1: Same weight → size compatible', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80, donor_height_cm: 175 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertTrue(result.matches[0].size_compatible, 'Same weight compatible');
  });

  await test('11.2: Ratio < 0.7 → size incompatible', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 50 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 100, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].size_compatible, false, 'Too small not compatible');
  });

  await test('11.3: Ratio > 1.5 → size incompatible', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 120 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 60, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].size_compatible, false, 'Too large not compatible');
  });

  await test('11.4: No weight data → compatible by default', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-' };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertTrue(result.matches[0].size_compatible, 'No weight → compatible');
  });

  await test('11.5: Boundary ratio exactly 0.7 → compatible', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 70 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 100, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertTrue(result.matches[0].size_compatible, 'Exact 0.7 is compatible');
  });

  // =================================================================
  // Suite 12: Virtual Crossmatch
  // =================================================================
  console.log('\nSuite 12: Virtual Crossmatch');
  console.log('---------------------------');

  await test('12.1: High PRA + low HLA → positive crossmatch (excluded)', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: 'A1 A2 B7 B8 DR1 DR2', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+',
        hla_typing: 'A99 A98 B99 B98 DR99 DR98', weight_kg: 80, priority_score: 50, pra_percentage: 95 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    // Positive crossmatch patients are excluded entirely
    assertEq(result.matches.length, 0, 'Positive crossmatch excluded');
  });

  await test('12.2: High PRA + good HLA → pending crossmatch (included)', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: 'A1 A2 B7 B8 DR1 DR2', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+',
        hla_typing: 'A1 A2 B7 B8 DR1 DR99', weight_kg: 80, priority_score: 50, pra_percentage: 85 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches.length, 1, 'Pending crossmatch included');
    assertEq(result.matches[0].virtual_crossmatch, 'pending', 'Crossmatch is pending');
  });

  await test('12.3: Low PRA + high HLA → negative crossmatch', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: 'A1 A2 B7 B8 DR1 DR2', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+',
        hla_typing: 'A1 A2 B7 B8 DR1 DR2', weight_kg: 80, priority_score: 50, pra_percentage: 20 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].virtual_crossmatch, 'negative', 'Negative crossmatch');
  });

  await test('12.4: No HLA data → pending crossmatch', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].virtual_crossmatch, 'pending', 'No HLA → pending');
  });

  // =================================================================
  // Suite 13: Ranking & Predicted Survival
  // =================================================================
  console.log('\nSuite 13: Ranking & Predicted Survival');
  console.log('--------------------------------------');

  await test('13.1: Matches ranked by compatibility score (descending)', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'Low', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 20 },
      { id: 'p2', first_name: 'High', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 90 },
      { id: 'p3', first_name: 'Med', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches[0].priority_rank, 1, 'Rank 1');
    assertEq(result.matches[1].priority_rank, 2, 'Rank 2');
    assertEq(result.matches[2].priority_rank, 3, 'Rank 3');
    assertTrue(result.matches[0].compatibility_score >= result.matches[1].compatibility_score, 'Ordered by score');
    assertTrue(result.matches[1].compatibility_score >= result.matches[2].compatibility_score, 'Ordered by score');
  });

  await test('13.2: Predicted survival is in [60, 98]', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', hla_typing: 'A1 A2 B7 B8 DR1 DR2', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+',
        hla_typing: 'A1 A2 B7 B8 DR1 DR2', weight_kg: 80, priority_score: 50, comorbidity_score: 8, previous_transplants: 3 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertInRange(result.matches[0].predicted_graft_survival, 60, 98, 'Survival in [60, 98]');
  });

  await test('13.3: Perfect match → higher predicted survival', async () => {
    const hla = 'A1 A2 B7 B8 DR1 DR2';
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O+', hla_typing: hla, donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'Perfect', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney',
        blood_type: 'O+', hla_typing: hla, weight_kg: 80, priority_score: 50 },
      { id: 'p2', first_name: 'Partial', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney',
        blood_type: 'O+', hla_typing: 'A99 A98 B99 B98 DR99 DR98', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    const perfect = result.matches.find(m => m.patient_id === 'p1');
    const partial = result.matches.find(m => m.patient_id === 'p2');
    assertTrue(perfect.predicted_graft_survival > partial.predicted_graft_survival, 'Perfect > Partial survival');
  });

  await test('13.4: Previous transplants reduce survival prediction', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'First', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50, previous_transplants: 0 },
      { id: 'p2', first_name: 'Retx', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+', weight_kg: 80, priority_score: 50, previous_transplants: 3 },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    const first = result.matches.find(m => m.patient_id === 'p1');
    const retx = result.matches.find(m => m.patient_id === 'p2');
    assertTrue(first.predicted_graft_survival > retx.predicted_graft_survival, 'First tx > retx survival');
  });

  // =================================================================
  // Suite 14: Edge Cases
  // =================================================================
  console.log('\nSuite 14: Edge Cases');
  console.log('--------------------');

  await test('14.1: No active patients → 0 matches', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80 };
    const db = createMockMatchingDb(donor, []);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches.length, 0, 'No matches');
    assertEq(result.total_matches, 0, 'Total = 0');
  });

  await test('14.2: Donor not found throws', async () => {
    const db = { prepare: () => ({ get: () => null, all: () => [] }) };
    let threw = false;
    try { await functions.matchDonorAdvanced({ donor_organ_id: 'nope' }, createContext(db)); }
    catch (e) { threw = true; assertTrue(e.message.includes('not found'), 'Error mentions not found'); }
    assertTrue(threw, 'Should throw');
  });

  await test('14.3: Simulation mode with hypothetical donor', async () => {
    const hypothetical = { organ_type: 'kidney', blood_type: 'A+', donor_weight_kg: 80 };
    const patients = [
      { id: 'p1', first_name: 'A', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'A+', weight_kg: 80, priority_score: 50 },
    ];
    const db = createMockMatchingDb(null, patients);
    const result = await functions.matchDonorAdvanced(
      { simulation_mode: true, hypothetical_donor: hypothetical }, createContext(db)
    );
    assertTrue(result.simulation_mode, 'Simulation mode');
    assertEq(result.donor.id, 'simulation', 'Donor id = simulation');
    assertTrue(result.matches.length > 0, 'Has matches');
  });

  await test('14.4: Only inactive patients → 0 matches (filtered by DB mock)', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80 };
    // In real app, the DB query filters by waitlist_status='active'
    // Our mock returns whatever patients are provided, so we provide none
    const db = createMockMatchingDb(donor, []);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches.length, 0, 'No active patients → 0');
  });

  await test('14.5: Compatibility score capped at 100', async () => {
    const hla = 'A1 A2 B7 B8 DR1 DR2 DQ1 DQ2';
    const dateOld = new Date(Date.now() - 2000 * 24 * 60 * 60 * 1000).toISOString();
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O+', hla_typing: hla, donor_weight_kg: 80, donor_age: 40 };
    const patients = [
      { id: 'p1', first_name: 'Max', last_name: 'P', waitlist_status: 'active', organ_needed: 'kidney',
        blood_type: 'O+', hla_typing: hla, weight_kg: 80, priority_score: 100,
        date_added_to_waitlist: dateOld, date_of_birth: new Date(Date.now() - 40 * 365.25 * 24 * 60 * 60 * 1000).toISOString() },
    ];
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertTrue(result.matches[0].compatibility_score <= 100, 'Score ≤ 100');
  });

  await test('14.6: Multiple identical patients handled correctly', async () => {
    const donor = { id: 'd1', organ_type: 'kidney', blood_type: 'O-', donor_weight_kg: 80 };
    const patients = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`, first_name: `Patient`, last_name: `${i}`,
      waitlist_status: 'active', organ_needed: 'kidney', blood_type: 'O+',
      weight_kg: 80, priority_score: 50,
    }));
    const db = createMockMatchingDb(donor, patients);
    const result = await functions.matchDonorAdvanced({ donor_organ_id: 'd1', simulation_mode: true }, createContext(db));
    assertEq(result.matches.length, 20, 'All 20 matched');
    // Verify unique ranks
    const ranks = result.matches.map(m => m.priority_rank);
    assertEq(new Set(ranks).size, 20, 'All ranks unique');
  });

  // =================================================================
  // Suite 15: FHIR Validation
  // =================================================================
  console.log('\nSuite 15: FHIR Validation');
  console.log('------------------------');

  await test('15.1: Valid FHIR Bundle passes', async () => {
    const fhirData = {
      resourceType: 'Bundle', type: 'collection',
      entry: [{
        resource: { resourceType: 'Patient', name: [{ family: 'Doe', given: ['John'] }], birthDate: '1990-01-01' },
      }],
    };
    const db = { prepare: () => ({ all: () => [] }) };
    const result = await functions.validateFHIRData({ fhir_data: fhirData }, createContext(db));
    assertTrue(result.valid, 'Should be valid');
    assertEq(result.errors.length, 0, 'No errors');
  });

  await test('15.2: Non-Bundle resource fails', async () => {
    const fhirData = { resourceType: 'Patient', name: [{ family: 'Doe' }] };
    const db = { prepare: () => ({ all: () => [] }) };
    const result = await functions.validateFHIRData({ fhir_data: fhirData }, createContext(db));
    assertEq(result.valid, false, 'Should fail');
    assertTrue(result.errors.some(e => e.message.includes('Bundle')), 'Error mentions Bundle');
  });

  await test('15.3: Empty bundle generates warning', async () => {
    const fhirData = { resourceType: 'Bundle', type: 'collection' };
    const db = { prepare: () => ({ all: () => [] }) };
    const result = await functions.validateFHIRData({ fhir_data: fhirData }, createContext(db));
    assertTrue(result.warnings.length > 0, 'Should have warning');
    assertTrue(result.warnings.some(w => w.message.includes('no entries')), 'Warning about empty');
  });

  await test('15.4: Patient without name generates error', async () => {
    const fhirData = {
      resourceType: 'Bundle', type: 'collection',
      entry: [{ resource: { resourceType: 'Patient', birthDate: '1990-01-01' } }],
    };
    const db = { prepare: () => ({ all: () => [] }) };
    const result = await functions.validateFHIRData({ fhir_data: fhirData }, createContext(db));
    assertEq(result.valid, false, 'Should fail');
    assertTrue(result.errors.some(e => e.message.includes('name')), 'Error mentions name');
  });

  await test('15.5: Patient without birthDate generates warning', async () => {
    const fhirData = {
      resourceType: 'Bundle', type: 'collection',
      entry: [{ resource: { resourceType: 'Patient', name: [{ family: 'Doe', given: ['John'] }] } }],
    };
    const db = { prepare: () => ({ all: () => [] }) };
    const result = await functions.validateFHIRData({ fhir_data: fhirData }, createContext(db));
    assertTrue(result.warnings.some(w => w.message.includes('Birth date')), 'Warning about birthDate');
  });

  await test('15.6: Invalid JSON string fails gracefully', async () => {
    const db = { prepare: () => ({ all: () => [] }) };
    const result = await functions.validateFHIRData({ fhir_data: '{invalid json' }, createContext(db));
    assertEq(result.valid, false, 'Should fail');
    assertTrue(result.errors.some(e => e.message.includes('Invalid JSON')), 'Error mentions JSON');
  });

  // ─── Summary ──────────────────────────────────────────────────
  console.log('\n================================================');
  console.log('Algorithm Test Summary');
  console.log('================================================');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total:  ${results.passed + results.failed}`);

  if (results.failed > 0) {
    console.log('\nFailed Tests:');
    results.errors.forEach(({ test, error }) => console.log(`  - ${test}: ${error}`));
    process.exit(1);
  } else {
    console.log('\n✓ All algorithm tests passed!');
  }
}

runTests().catch(e => { console.error('Test runner error:', e); process.exit(1); });
