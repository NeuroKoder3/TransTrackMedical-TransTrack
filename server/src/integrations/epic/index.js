'use strict';

const client = require('./client');
const importPatient = require('./importPatient');

module.exports = {
  ...client,
  ...importPatient,
};
