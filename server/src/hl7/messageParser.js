'use strict';

/**
 * High-level HL7 v2 message parser.
 *
 * Composes:
 *   - the dependency-free base parser (electron/services/hl7v2.cjs)
 *   - extended segment extraction (extendedSegments.js)
 *   - Z-segment vendor extension hooks (zSegments.js)
 *   - message-type registry (messageTypes.js)
 *
 * Returns a single `parsed` object that the ingest service can persist as
 * JSONB and lift into native CRUD operations.
 */

const path = require('path');
// Re-use the existing battle-tested base parser. We import via relative path
// because the server lives next to the original Electron module tree.
const baseParser = require(path.join(__dirname, '..', '..', '..', 'electron', 'services', 'hl7v2.cjs'));

const extendedSegments = require('./extendedSegments');
const zSegments = require('./zSegments');
const messageTypes = require('./messageTypes');

/**
 * Parse an HL7 v2 message into the canonical shape.
 * @param {string} raw Raw HL7 v2 message (CR or LF segment separators tolerated).
 * @param {object} [vendorProfile] Optional matching vendor profile row.
 */
function parseMessage(raw, vendorProfile = null) {
  const base = baseParser.parseMessage(raw);
  const segments = baseParser.splitSegments(raw).map(baseParser.parseSegment);

  const extended = extendedSegments.extractAll(segments);
  const zExt = zSegments.extractZSegments(segments, vendorProfile);

  // Re-evaluate "supported" flag against the extended message-type registry.
  const supported = messageTypes.isSupported(base.message_type, base.trigger_event);
  const cat = messageTypes.category(base.message_type, base.trigger_event);

  // Pick out specific extracted views the ingest service uses heavily.
  const evn = extended.EVN || null;
  const pv2 = extended.PV2 || null;
  const allergies = []
    .concat(extended.AL1 || [])
    .concat(extended.IAM || []);
  const diagnoses = [].concat(extended.DG1 || []);
  const procedures = [].concat(extended.PR1 || []);
  const next_of_kin = [].concat(extended.NK1 || []);
  const guarantors = [].concat(extended.GT1 || []);
  const insurances = [].concat(extended.IN1 || []);
  const merge_info = extended.MRG || null;
  const orders = (base.orders || []);
  if (extended.ORC) {
    const list = Array.isArray(extended.ORC) ? extended.ORC : [extended.ORC];
    for (const orc of list) orders.push({ orc, source: 'ORC' });
  }
  const pharmacy_orders = []
    .concat(extended.RXO ? (Array.isArray(extended.RXO) ? extended.RXO : [extended.RXO]) : [])
    .concat(extended.RXE ? (Array.isArray(extended.RXE) ? extended.RXE : [extended.RXE]) : []);
  const pharmacy_dispenses = [].concat(extended.RXD || []);
  const routes = [].concat(extended.RXR || []);
  const financial_transactions = [].concat(extended.FT1 || []);
  const schedule = extended.SCH || null;
  const schedule_services = [].concat(extended.AIS || []);
  const schedule_resources = [].concat(extended.AIG || []);
  const schedule_locations = [].concat(extended.AIL || []);
  const schedule_personnel = [].concat(extended.AIP || []);
  const document = extended.TXA || null;
  const master_file = {
    mfi: extended.MFI || null,
    mfe: extended.MFE || null,
    staff: extended.STF || null,
    location: extended.LOC || null,
    clinical_study: extended.CM0 || null,
  };
  const notes = [].concat(extended.NTE || []);
  const specimens = [].concat(extended.SPM || []);

  return {
    ...base,
    supported,
    category: cat,
    vendor_profile: vendorProfile?.vendor_name || null,
    extended: {
      evn, pv2,
      allergies, diagnoses, procedures,
      next_of_kin, guarantors, insurances,
      merge_info,
      orders, pharmacy_orders, pharmacy_dispenses, routes,
      financial_transactions,
      schedule, schedule_services, schedule_resources, schedule_locations, schedule_personnel,
      document,
      master_file,
      notes, specimens,
    },
    z_segments: zExt,
  };
}

const buildAck = baseParser.buildAck;

module.exports = {
  parseMessage,
  buildAck,
  // Re-exports kept for downstream callers
  baseParser,
  extendedSegments,
  zSegments,
  messageTypes,
};
