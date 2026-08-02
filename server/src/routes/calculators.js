'use strict';

/**
 * OPTN reference calculators.
 *
 * M-12: six of these seven routes used to hand req.body straight to the
 * calculator with no schema at all, so unvalidated client input reached the
 * scoring functions and any extra property travelled through into the echoed
 * `inputs` block. Every route now parses an explicit schema and strips
 * unknown keys — Zod objects are strict-by-omission, so `.parse()` returns
 * only the declared fields.
 *
 * Required-vs-optional here mirrors REQUIRED_FIELDS in each calculator
 * module: fields the formula cannot run without are required, and the
 * calculators' own INSUFFICIENT_DATA path remains for anything they still
 * consider missing (a required field can be present and out of range).
 */

const { z } = require('zod');
const calc = require('../../../electron/services/calculators/index.cjs');

const lab = z.number().finite();
const nonNegative = z.number().finite().nonnegative();

const meldSchema = z.object({
  creatinine_mg_dl: lab,
  bilirubin_mg_dl: lab,
  inr: lab,
  dialysis_twice_in_week: z.boolean().optional(),
});

const meldNaSchema = meldSchema.extend({
  sodium_meq_l: lab,
});

const meld3Schema = meldSchema.extend({
  sodium_meq_l: lab,
  albumin_g_dl: lab,
  sex: z.enum(['male', 'female', 'M', 'F']),
});

const peldSchema = z.object({
  bilirubin_mg_dl: lab,
  inr: lab,
  albumin_g_dl: lab,
  age_years: nonNegative,
  growth_failure: z.boolean(),
});

const lasSchema = z.object({
  diagnosis_group: z.enum(['A', 'B', 'C', 'D']),
  age_years: nonNegative,
  bmi: nonNegative,
  functional_status: z.enum(['no_assistance', 'some_assistance', 'total_assistance']),
  six_minute_walk_ft: nonNegative,
  continuous_o2_l_min: nonNegative,
  pco2_mmHg: nonNegative,
  on_mechanical_ventilation: z.boolean(),
  creatinine_mg_dl: lab,
  bilirubin_mg_dl: lab,
  pap_systolic_mmHg: nonNegative.optional(),
  diabetes: z.boolean().optional(),
});

const kdpiSchema = z.object({
  age_years: nonNegative,
  height_cm: nonNegative,
  weight_kg: nonNegative,
  african_american: z.boolean(),
  hypertension: z.boolean(),
  diabetes: z.boolean(),
  cause_of_death: z.enum(['CVA', 'TRAUMA', 'ANOXIA', 'OTHER']),
  creatinine_mg_dl: lab,
  hcv_positive: z.boolean(),
  dcd: z.boolean(),
});

const eptsSchema = z.object({
  age_years: nonNegative,
  diabetes: z.boolean(),
  prior_solid_organ_transplant: z.boolean(),
  years_on_dialysis: nonNegative,
});

module.exports = async function calculatorRoutes(app) {
  const perRouteRateLimit = {
    config: {
      rateLimit: {
        max: 200,
        timeWindow: '1 minute',
      },
    },
  };

  app.get('/calculators', perRouteRateLimit, async () => ({
    formulas: calc.ALL_FORMULAS,
    requiredFields: calc.REQUIRED_FIELDS,
    disclaimer: calc.DISCLAIMER,
  }));

  app.post('/calculators/meld', perRouteRateLimit,
    async (req) => calc.calculateMELD(meldSchema.parse(req.body)));

  app.post('/calculators/meld-na', perRouteRateLimit,
    async (req) => calc.calculateMELDNa(meldNaSchema.parse(req.body)));

  app.post('/calculators/meld-3', perRouteRateLimit,
    async (req) => calc.calculateMELD3(meld3Schema.parse(req.body)));

  app.post('/calculators/peld', perRouteRateLimit,
    async (req) => calc.calculatePELD(peldSchema.parse(req.body)));

  app.post('/calculators/las', perRouteRateLimit,
    async (req) => calc.calculateLAS(lasSchema.parse(req.body)));

  app.post('/calculators/kdpi', perRouteRateLimit,
    async (req) => calc.calculateKDPI(kdpiSchema.parse(req.body)));

  app.post('/calculators/epts', perRouteRateLimit,
    async (req) => calc.calculateEPTS(eptsSchema.parse(req.body)));
};

module.exports.schemas = {
  meld: meldSchema,
  'meld-na': meldNaSchema,
  'meld-3': meld3Schema,
  peld: peldSchema,
  las: lasSchema,
  kdpi: kdpiSchema,
  epts: eptsSchema,
};
