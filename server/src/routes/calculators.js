'use strict';

const { z } = require('zod');
const calc = require('../../../electron/services/calculators/index.cjs');

module.exports = async function calculatorRoutes(app) {
  app.get('/calculators', async () => ({
    formulas: calc.ALL_FORMULAS,
    requiredFields: calc.REQUIRED_FIELDS,
    disclaimer: calc.DISCLAIMER,
  }));

  app.post('/calculators/meld', async (req) => {
    const body = z.object({
      bilirubin: z.number(),
      inr: z.number(),
      creatinine: z.number(),
      sodium: z.number().optional(),
      onDialysis: z.boolean().optional(),
    }).parse(req.body);
    return calc.calculateMELD(body);
  });

  app.post('/calculators/meld-na', async (req) => calc.calculateMELDNa(req.body));
  app.post('/calculators/meld-3',  async (req) => calc.calculateMELD3(req.body));
  app.post('/calculators/peld',    async (req) => calc.calculatePELD(req.body));
  app.post('/calculators/las',     async (req) => calc.calculateLAS(req.body));
  app.post('/calculators/kdpi',    async (req) => calc.calculateKDPI(req.body));
  app.post('/calculators/epts',    async (req) => calc.calculateEPTS(req.body));
};
