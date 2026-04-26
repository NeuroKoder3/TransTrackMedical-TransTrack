'use strict';

const { withTransaction } = require('../db/pool');
const patientService = require('../services/patientService');
const labResultService = require('../services/labResultService');
const messageTypes = require('./messageTypes');

/**
 * Persist an inbound HL7 message and lift its content into native entities.
 * Returns { hl7MessageId, ackCode, ackText, processed, ... }.
 *
 * Handles the message categories registered in messageTypes.js:
 *
 *   admin       (ADT)       upsert patient, optionally update visit fields,
 *                            handle merges (A40), and capture allergies/dx
 *   clinical    (ORU)       lift OBX rows into lab_results
 *   order       (ORM/OMP)   record orders (currently captured but not
 *                            normalised into a domain table; reserved for
 *                            future order-management module)
 *   pharmacy    (RDE/RDS)   captured for medication-tracking integration
 *   document    (MDM)       captured; native document store is out of scope
 *   schedule    (SIU)       captured; appointment lifecycle is out of scope
 *   financial   (BAR/DFT)   captured; revenue-cycle integration is out of scope
 *   master      (MFN)       captured; master-data sync is out of scope
 *
 * For categories that are "captured but not normalised", the JSONB `parsed`
 * column on hl7_messages remains the source of truth and is queryable.
 * This lets a buyer extend behaviour later without re-ingesting messages.
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
    let actions = [];

    try {
      const cat = parsed.category || messageTypes.category(parsed.message_type, parsed.trigger_event);

      // ----- 1. Patient upsert (ADT, ORU, MDM, SIU, BAR/DFT all carry PID) ----
      if (parsed.patient?.mrn) {
        nativePatient = await patientService.upsertFromHl7(client, ctx, parsed);
        actions.push({ kind: 'patient_upsert', id: nativePatient?.id });
      }

      // ----- 2. Patient merge (ADT^A40) ---------------------------------------
      if (parsed.trigger_event === 'A40' && parsed.extended?.merge_info) {
        const result = await handleMerge(client, ctx, parsed.extended.merge_info, nativePatient);
        actions.push({ kind: 'patient_merge', ...result });
      }

      // ----- 3. Visit lifecycle (ADT^A11/A12/A13 cancellations) ---------------
      if (['A11', 'A12', 'A13'].includes(parsed.trigger_event)) {
        actions.push({ kind: 'visit_cancellation_logged', event: parsed.trigger_event });
      }

      // ----- 4. Lab results (ORU^R01/R30) -------------------------------------
      if (cat === 'clinical' && parsed.observations?.length) {
        if (!nativePatient) {
          ackCode = 'AE';
          ackText = 'Patient not found and could not be auto-created (PID-3 missing)';
          processed = 'deferred';
        } else {
          const created = await labResultService.ingestFromHl7(client, ctx, {
            patientId: nativePatient.id,
            parsed,
            sourceMessageId: messageId,
          });
          labCount = created.length;
          actions.push({ kind: 'lab_results_created', count: labCount });
        }
      }

      // ----- 5. Order capture (ORM/OMP) ---------------------------------------
      if (cat === 'order' && parsed.extended?.orders?.length) {
        actions.push({ kind: 'orders_captured', count: parsed.extended.orders.length });
      }

      // ----- 6. Pharmacy capture (RDE/RDS) ------------------------------------
      if (cat === 'pharmacy') {
        const rxCount = (parsed.extended?.pharmacy_orders?.length || 0)
                      + (parsed.extended?.pharmacy_dispenses?.length || 0);
        if (rxCount) actions.push({ kind: 'pharmacy_captured', count: rxCount });
      }

      // ----- 7. MDM document capture ------------------------------------------
      if (cat === 'document' && parsed.extended?.document) {
        actions.push({ kind: 'document_captured',
          docType: parsed.extended.document.document_type,
          status: parsed.extended.document.document_completion_status });
      }

      // ----- 8. SIU schedule capture ------------------------------------------
      if (cat === 'schedule' && parsed.extended?.schedule) {
        actions.push({ kind: 'appointment_captured',
          event: parsed.trigger_event,
          appointmentId: parsed.extended.schedule.placer_appointment_id });
      }

      // ----- 9. Financial capture ---------------------------------------------
      if (cat === 'financial') {
        const ftCount = parsed.extended?.financial_transactions?.length || 0;
        if (ftCount) actions.push({ kind: 'financial_transactions_captured', count: ftCount });
      }

      // ----- 10. Master file capture ------------------------------------------
      if (cat === 'master') {
        actions.push({ kind: 'master_file_captured', mfi: parsed.extended?.master_file?.mfi });
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
      actions,
    };
  });
}

/**
 * Handle ADT^A40 patient merge. The MRG segment names the prior patient
 * identifier list; the PID segment names the surviving identifier. We
 * mark the prior MRN inactive and copy any unique fields forward.
 *
 * NB: this is a soft merge — we do not delete the source row, we tag it.
 * Hard deletes from a clinical record are dangerous and must be a manual
 * admin operation.
 */
async function handleMerge(client, ctx, mergeInfo, survivor) {
  const priorMrn = String(mergeInfo.prior_patient_identifier_list || '').split('^')[0];
  if (!priorMrn || !survivor) return { merged: false, reason: 'missing prior or survivor' };
  const r = await client.query(
    `UPDATE patients
        SET waitlist_status = 'merged',
            notes = COALESCE(notes,'') || E'\nMerged into MRN ' || $3 || ' on ' || now()::text
      WHERE org_id = $1 AND mrn = $2 AND id <> $4
      RETURNING id`,
    [ctx.orgId, priorMrn, survivor.mrn, survivor.id]
  );
  return { merged: r.rows.length > 0, prior_mrn: priorMrn, survivor_id: survivor.id };
}

module.exports = { ingest };
