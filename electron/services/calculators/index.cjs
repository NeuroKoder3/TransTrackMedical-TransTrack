'use strict';

const meld = require('./meld.cjs');
const las = require('./las.cjs');
const kdpi = require('./kdpi.cjs');
const epts = require('./epts.cjs');
const referenceData = require('./referenceData.cjs');

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
  calculatePELDLegacy2016: meld.calculatePELDLegacy2016,
  calculateTTLI: las.calculateTTLI,
  calculateLAS: las.calculateLAS,
  calculateKDPI: kdpi.calculateKDPI,
  calculateEPTS: epts.calculateEPTS,
  DIAGNOSIS_GROUPS: las.DIAGNOSIS_GROUPS,
  REQUIRED_FIELDS,
  ALL_FORMULAS: ['MELD', 'MELD-Na', 'MELD-3.0', 'PELD', 'TTLI', 'KDPI', 'EPTS'],
  /**
   * Provenance of every constant the calculators depend on, for the Compliance
   * Center and the health check. A stale or missing entry here is the visible
   * signal that finding H-10 said was absent.
   */
  referenceDataStatus: referenceData.statusReport,
  DISCLAIMER:
    'All calculator outputs are reference values only. Allocation occurs in ' +
    'OPTN/UNet. Do not use these values as the basis for clinical or allocation ' +
    'decisions without source-of-truth verification. TTLI is a TransTrack ' +
    'internal triage index, not the OPTN Lung Allocation Score.',
};
