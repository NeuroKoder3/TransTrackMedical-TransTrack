'use strict';

/**
 * Extended HL7 v2 message-type registry.
 *
 * The base parser (electron/services/hl7v2.cjs, re-used by the server)
 * understands MSH/PID/PV1/OBR/OBX. This module knows which trigger events
 * to accept, what additional segments to extract, and how to map them into
 * native CRUD operations after persistence.
 *
 * Coverage (production-typical for a transplant center):
 *   ADT^A01  Admit                           (existing)
 *   ADT^A03  Discharge                        (existing)
 *   ADT^A04  Registration                     (existing)
 *   ADT^A08  Update demographics              (existing)
 *   ADT^A11  Cancel admit
 *   ADT^A12  Cancel transfer
 *   ADT^A13  Cancel discharge
 *   ADT^A28  Add person
 *   ADT^A31  Update person
 *   ADT^A40  Merge patient identifier list
 *   ADT^A60  Update allergy information
 *   ORU^R01  Lab/observation result            (existing)
 *   ORU^R30  Unsolicited point-of-care result
 *   ORM^O01  Order message
 *   OMP^O09  Pharmacy/treatment order
 *   RDE^O11  Pharmacy encoded order
 *   RDS^O13  Pharmacy dispense
 *   MDM^T01  Original document notification
 *   MDM^T02  Original document notification + content
 *   SIU^S12  Notification of new appointment
 *   SIU^S13  Notification of appointment rescheduling
 *   SIU^S14  Notification of appointment modification
 *   SIU^S15  Notification of appointment cancellation
 *   SIU^S26  Notification that patient did not show up
 *   BAR^P01  Add patient accounts
 *   BAR^P02  Purge patient accounts
 *   BAR^P05  Update account
 *   DFT^P03  Detail financial transactions (charges)
 *   DFT^P11  Post detail financial transaction
 *   FT1      Financial transaction (segment, included in DFT/BAR)
 *   MFN^M02  Master file - staff practitioner
 *   MFN^M05  Master file - patient location
 *   MFN^M06  Master file - clinical study
 *
 * Each entry describes:
 *   category      logical bucket (admin, clinical, order, pharmacy, document, schedule, financial, master)
 *   segments      additional segments worth extracting beyond MSH/PID/PV1
 *   ackByDefault  whether to send AA without further processing
 *   description   human-readable
 */

const MESSAGE_TYPES = {
  // ----- ADT (Admission/Discharge/Transfer) ---------------------------------
  'ADT^A01': { category: 'admin', segments: ['PV1','PV2','AL1','DG1','OBX','NK1','GT1','IN1'], description: 'Admit/visit notification' },
  'ADT^A03': { category: 'admin', segments: ['PV1','PV2','DG1'], description: 'Discharge/end visit' },
  'ADT^A04': { category: 'admin', segments: ['PV1','NK1','AL1','OBX','GT1','IN1'], description: 'Register a patient' },
  'ADT^A08': { category: 'admin', segments: ['PV1','PV2','AL1','DG1','OBX','NK1','GT1','IN1'], description: 'Update patient information' },
  'ADT^A11': { category: 'admin', segments: ['PV1'], description: 'Cancel admit/visit notification' },
  'ADT^A12': { category: 'admin', segments: ['PV1'], description: 'Cancel transfer' },
  'ADT^A13': { category: 'admin', segments: ['PV1'], description: 'Cancel discharge/end visit' },
  'ADT^A28': { category: 'admin', segments: ['PD1','NK1','AL1','OBX'], description: 'Add person information' },
  'ADT^A31': { category: 'admin', segments: ['PD1','NK1','AL1','OBX'], description: 'Update person information' },
  'ADT^A40': { category: 'admin', segments: ['MRG'], description: 'Merge patient – patient identifier list' },
  'ADT^A60': { category: 'admin', segments: ['IAM'], description: 'Update allergy information' },

  // ----- ORU / ORM / OMP / RDE / RDS (orders & results) ---------------------
  'ORU^R01': { category: 'clinical', segments: ['OBR','OBX','NTE','SPM'], description: 'Unsolicited observation message (lab results)' },
  'ORU^R30': { category: 'clinical', segments: ['OBR','OBX','NTE'], description: 'Unsolicited point-of-care observation' },
  'ORM^O01': { category: 'order', segments: ['ORC','OBR','RXO','RXR','OBX','NTE','DG1'], description: 'Order message (general)' },
  'OMP^O09': { category: 'order', segments: ['ORC','RXO','RXR','OBX','NTE'], description: 'Pharmacy/treatment order' },
  'RDE^O11': { category: 'pharmacy', segments: ['ORC','RXE','RXR','OBX','NTE'], description: 'Pharmacy/treatment encoded order' },
  'RDS^O13': { category: 'pharmacy', segments: ['ORC','RXE','RXD','RXR','OBX','NTE'], description: 'Pharmacy/treatment dispense' },

  // ----- MDM (clinical documents) -------------------------------------------
  'MDM^T01': { category: 'document', segments: ['EVN','TXA','OBX','NTE'], description: 'Original document notification' },
  'MDM^T02': { category: 'document', segments: ['EVN','TXA','OBX','NTE'], description: 'Original document notification and content' },

  // ----- SIU (scheduling) ---------------------------------------------------
  'SIU^S12': { category: 'schedule', segments: ['SCH','TQ1','NTE','PV1','PV2','RGS','AIS','AIG','AIL','AIP'], description: 'Notification of new appointment' },
  'SIU^S13': { category: 'schedule', segments: ['SCH','TQ1','NTE','PV1','RGS','AIS','AIG','AIL','AIP'], description: 'Notification of appointment rescheduling' },
  'SIU^S14': { category: 'schedule', segments: ['SCH','TQ1','NTE','PV1','RGS','AIS','AIG','AIL','AIP'], description: 'Notification of appointment modification' },
  'SIU^S15': { category: 'schedule', segments: ['SCH','TQ1','NTE','PV1'], description: 'Notification of appointment cancellation' },
  'SIU^S26': { category: 'schedule', segments: ['SCH','TQ1','NTE','PV1'], description: 'Notification that patient did not show up' },

  // ----- BAR / DFT (financial) ---------------------------------------------
  'BAR^P01': { category: 'financial', segments: ['EVN','PV1','DG1','GT1','IN1','ACC'], description: 'Add patient accounts' },
  'BAR^P02': { category: 'financial', segments: ['EVN'], description: 'Purge patient accounts' },
  'BAR^P05': { category: 'financial', segments: ['EVN','PV1','DG1','GT1','IN1','ACC'], description: 'Update account' },
  'DFT^P03': { category: 'financial', segments: ['EVN','PV1','PV2','DG1','PR1','GT1','IN1','FT1','PRA'], description: 'Post detail financial transaction' },
  'DFT^P11': { category: 'financial', segments: ['EVN','PV1','PV2','DG1','PR1','GT1','IN1','FT1','PRA'], description: 'Post detail financial transaction (with extended fields)' },

  // ----- MFN (master files) -------------------------------------------------
  'MFN^M02': { category: 'master', segments: ['MFI','MFE','STF','PRA','ORG'], description: 'Master file – staff practitioner' },
  'MFN^M05': { category: 'master', segments: ['MFI','MFE','LOC','LCH','LRL','LDP','LCC'], description: 'Master file – patient location' },
  'MFN^M06': { category: 'master', segments: ['MFI','MFE','CM0','CM1','CM2'], description: 'Master file – clinical study with phases and schedules' },

  // ----- ACK (acknowledgement) ---------------------------------------------
  'ACK': { category: 'admin', segments: ['MSA','ERR'], description: 'Acknowledgement', ackByDefault: true },
};

function describe(messageType, triggerEvent) {
  const key = `${messageType}^${triggerEvent}`;
  return MESSAGE_TYPES[key] || MESSAGE_TYPES[messageType] || null;
}

function isSupported(messageType, triggerEvent) {
  return !!describe(messageType, triggerEvent);
}

function category(messageType, triggerEvent) {
  const d = describe(messageType, triggerEvent);
  return d ? d.category : 'unknown';
}

function listSupported() {
  return Object.keys(MESSAGE_TYPES).filter(k => k !== 'ACK');
}

module.exports = {
  MESSAGE_TYPES,
  describe,
  isSupported,
  category,
  listSupported,
};
