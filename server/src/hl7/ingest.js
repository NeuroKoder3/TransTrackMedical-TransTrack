'use strict';

const { withTransaction } = require('../db/pool');
const patientService = require('../services/patientService');
const labResultService = require('../services/labResultService');

/**
 * Persist an inbound HL7 message and lift its content into native entities.
 * Returns { hl7MessageId, ackCode, ackText, processed }.
 */
async function ingest({ rawMessage, parsed, ctx, peer, transport = 'mllp' }) {
  return withTransaction(ctx, async (client) => {
    const ins = await client.query(
      `INSERT INTO hl7_messages
         (org_id, direction, transport, sending_app, sending_facility,
          receiving_app, receiving_facility, message_type, trigger_event,
          message_control_id, raw_message, parsed, processed_status,
          peer_address, peer_cert_subject)
       VALUES ($1,'inbound',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'received',$12,$13)
       RETURNING id`,
      [
        ctx.orgId,
        transport,
        parsed.sending_app || null,
        parsed.sending_facility || null,
        parsed.receiving_app || null,
        parsed.receiving_facility || null,
        parsed.message_type || null,
        parsed.trigger_event || null,
        parsed.message_control_id || null,
        rawMessage,
        JSON.stringify(parsed),
        peer?.address || null,
        peer?.certSubject || null,
      ]
    );
    const messageId = ins.rows[0].id;

    let ackCode = 'AA';
    let ackText = 'Accepted';
    let processed = 'accepted';
    let nativePatient = null;
    let labCount = 0;

    try {
      if (parsed.patient?.mrn) {
        nativePatient = await patientService.upsertFromHl7(client, ctx, parsed);
      }
      if (parsed.observations?.length && nativePatient) {
        const created = await labResultService.ingestFromHl7(client, ctx, {
          patientId: nativePatient.id,
          parsed,
          sourceMessageId: messageId,
        });
        labCount = created.length;
      } else if (parsed.observations?.length && !nativePatient) {
        ackCode = 'AE';
        ackText = 'Patient not found and could not be auto-created (PID-3 missing)';
        processed = 'deferred';
      }
    } catch (e) {
      ackCode = 'AE';
      ackText = `Application error: ${e.message}`;
      processed = 'error';
      await client.query(
        `UPDATE hl7_messages SET processed_status='error', error_details=$1, processed_at=now() WHERE id=$2`,
        [String(e.stack || e.message), messageId]
      );
      return { hl7MessageId: messageId, ackCode, ackText, processed };
    }

    await client.query(
      `UPDATE hl7_messages
         SET processed_status=$1, ack_code=$2, ack_message=$3, processed_at=now()
       WHERE id=$4`,
      [processed, ackCode, ackText, messageId]
    );

    return {
      hl7MessageId: messageId,
      ackCode,
      ackText,
      processed,
      patientId: nativePatient?.id || null,
      labCount,
    };
  });
}

module.exports = { ingest };
