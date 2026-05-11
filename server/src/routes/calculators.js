'use strict';

const { z } = require('zod');
const calc = require('../../../electron/services/calculators/index.cjs');

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

  app.post('/calculators/meld', perRouteRateLimit, async (req) => {
    const body = z.object({
      bilirubin: z.number(),
      inr: z.number(),
      creatinine: z.number(),
      sodium: z.number().optional(),
      onDialysis: z.boolean().optional(),
    }).parse(req.body);
    return calc.calculateMELD(body);
  });

  app.post('/calculators/meld-na', perRouteRateLimit, async (req) => calc.calculateMELDNa(req.body));
  app.post('/calculators/meld-3', perRouteRateLimit, async (req) => calc.calculateMELD3(req.body));
  app.post('/calculators/peld', perRouteRateLimit, async (req) => calc.calculatePELD(req.body));
  app.post('/calculators/las', perRouteRateLimit, async (req) => calc.calculateLAS(req.body));
  app.post('/calculators/kdpi', perRouteRateLimit, async (req) => calc.calculateKDPI(req.body));
  app.post('/calculators/epts', perRouteRateLimit, async (req) => calc.calculateEPTS(req.body));
};
