'use strict';

const meld = require('./meld.cjs');
const las = require('./las.cjs');
const kdpi = require('./kdpi.cjs');
const epts = require('./epts.cjs');

const REQUIRED_FIELDS = Object.freeze({
  ...meld.REQUIRED_FIELDS,
  ...las.REQUIRED_FIELDS,
  ...kdpi.REQUIRED_FIELDS,
  ...epts.REQUIRED_FIELDS,
});

module.exports = {
  calculateMELD: meld.calculateMELD,
  calculateMELDNa: meld.calculateMELDNa,
  calculateMELD3: meld.calculateMELD3,
  calculatePELD: meld.calculatePELD,
  calculateLAS: las.calculateLAS,
  calculateKDPI: kdpi.calculateKDPI,
  calculateEPTS: epts.calculateEPTS,
  DIAGNOSIS_GROUPS: las.DIAGNOSIS_GROUPS,
  REQUIRED_FIELDS,
  ALL_FORMULAS: ['MELD', 'MELD-Na', 'MELD-3.0', 'PELD', 'LAS', 'KDPI', 'EPTS'],
  DISCLAIMER: 'All calculator outputs are reference values only. Allocation occurs in OPTN/UNet. Do not use these values as the basis for clinical or allocation decisions without source-of-truth verification.',
};
