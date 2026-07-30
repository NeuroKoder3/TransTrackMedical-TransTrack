'use strict';

/**
 * MLLP/TLS HL7 v2 listener.
 *
 * Designed to receive ADT, ORU, SIU, MDM messages from a hospital
 * interface engine (Mirth Connect, Rhapsody, Cloverleaf, Corepoint).
 *
 * Production mode requires:
 *   - HL7_MLLP_TLS_CERT_FILE / HL7_MLLP_TLS_KEY_FILE
 *   - HL7_MLLP_TLS_CA_FILE   (peer cert validation chain)
 *   - HL7_MLLP_TLS_REQUIRE_CLIENT_CERT=true   (mutual TLS)
 *
 * For local testing against Mirth Connect, the listener can run plaintext
 * by leaving the cert/key paths empty (DEV ONLY).
 */

const fs = require('fs');
const net = require('net');
const tls = require('tls');
const { MllpFramer, frame } = require('./mllp');
const { parseMessage, buildAck } = require('./messageParser');
const vendorProfileService = require('../services/vendorProfileService');
const ingestMod = require('./ingest');
const { getPool } = require('../db/pool');

function start({ config, logger }) {
  if (!config.HL7_MLLP_ENABLED) {
    logger.info('HL7 MLLP listener disabled by config');
    return null;
  }

  const useTls = config.HL7_MLLP_TLS_CERT_FILE && config.HL7_MLLP_TLS_KEY_FILE;
  const tlsOpts = useTls ? {
    cert: fs.readFileSync(config.HL7_MLLP_TLS_CERT_FILE),
    key: fs.readFileSync(config.HL7_MLLP_TLS_KEY_FILE),
    ca: config.HL7_MLLP_TLS_CA_FILE ? fs.readFileSync(config.HL7_MLLP_TLS_CA_FILE) : undefined,
    requestCert: !!config.HL7_MLLP_TLS_REQUIRE_CLIENT_CERT,
    rejectUnauthorized: !!config.HL7_MLLP_TLS_REQUIRE_CLIENT_CERT,
    minVersion: 'TLSv1.2',
  } : null;

  if (!useTls && config.NODE_ENV === 'production') {
    if (!config.HL7_ALLOW_PLAINTEXT) {
      throw new Error(
        'HL7 MLLP plaintext is not allowed in production. Provide HL7_MLLP_TLS_CERT_FILE ' +
        'and HL7_MLLP_TLS_KEY_FILE, or set HL7_ALLOW_PLAINTEXT=1 (NOT recommended).'
      );
    }
    logger.warn('HL7 MLLP listener running PLAINTEXT in production (HL7_ALLOW_PLAINTEXT=1). ' +
      'This is NOT recommended — configure TLS immediately.');
  }
  if (!useTls && config.NODE_ENV === 'test') {
    logger.info('HL7 MLLP running plaintext (test environment)');
  }

  function handleSocket(socket) {
    const peer = {
      address: socket.remoteAddress,
      port: socket.remotePort,
      certSubject: typeof socket.getPeerCertificate === 'function'
        ? socket.getPeerCertificate()?.subject?.CN
        : null,
    };
    logger.info({ peer }, 'mllp peer connected');

    const framer = new MllpFramer();
    socket.on('data', async (chunk) => {
      const messages = framer.push(chunk);
      for (const raw of messages) {
        // First pass: parse without vendor profile to extract sending_app.
        let parsed;
        try {
          parsed = parseMessage(raw);
        } catch (e) {
          logger.warn({ err: e.message }, 'mllp parse failed');
          const nack = buildAck({ message_control_id: 'UNKNOWN' }, 'AR', 'Message parse failure');
          socket.write(frame(nack));
          continue;
        }
        const resolvedOrg = await resolveOrgFromSendingApp(parsed.sending_app);
        const orgId = resolvedOrg || config.HL7_DEFAULT_ORG_ID || null;
        if (!orgId) {
          logger.warn({ sendingApp: parsed.sending_app, msgId: parsed.message_control_id },
            'rejecting message: no org mapping and no HL7_DEFAULT_ORG_ID');
          try {
            const pool = getPool();
            await pool.query(
              `INSERT INTO hl7_dead_letters
                 (raw_message, sending_app, sending_facility, message_type,
                  trigger_event, message_control_id, error_reason, peer_address, transport)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'mllp')`,
              [raw, parsed.sending_app, parsed.sending_facility, parsed.message_type,
               parsed.trigger_event, parsed.message_control_id,
               'No org mapping for sending application', peer?.address || null]
            );
          } catch { /* best-effort dead-letter */ }
          const nack = buildAck(parsed, 'AR', 'No org mapping for sending application');
          socket.write(frame(nack));
          continue;
        }
        const ctx = { orgId, userEmail: 'hl7-mllp@transtrack.system', role: 'system' };
        // Second pass: re-parse with the matching vendor profile so Z-segments
        // and quirks are interpreted in the vendor's namespace.
        try {
          const profile = await vendorProfileService.findFor(ctx, parsed.sending_app, parsed.sending_facility);
          if (profile) parsed = parseMessage(raw, profile);
        } catch (e) {
          logger.warn({ err: e.message }, 'mllp vendor-profile lookup failed; using defaults');
        }
        try {
          const result = await ingestMod.ingest({
            rawMessage: raw,
            parsed,
            ctx,
            peer,
            transport: 'mllp',
          });
          const ack = buildAck(parsed, result.ackCode, result.ackText);
          socket.write(frame(ack));
          logger.info({ msgId: parsed.message_control_id, processed: result.processed,
            patientId: result.patientId, labCount: result.labCount }, 'mllp ingested');
        } catch (e) {
          logger.error({ err: e }, 'mllp ingest threw');
          const nack = buildAck(parsed, 'AE', 'Internal processing error');
          socket.write(frame(nack));
        }
      }
    });

    socket.on('error', (err) => logger.warn({ err: err.message, peer }, 'mllp socket error'));
    socket.on('close', () => logger.info({ peer }, 'mllp peer disconnected'));
  }

  const server = useTls
    ? tls.createServer(tlsOpts, handleSocket)
    : net.createServer(handleSocket);

  server.listen(config.HL7_MLLP_PORT, config.HL7_MLLP_HOST, () => {
    logger.info({
      host: config.HL7_MLLP_HOST,
      port: config.HL7_MLLP_PORT,
      tls: !!useTls,
      mtls: !!useTls && tlsOpts.requestCert,
    }, 'mllp listener started');
  });

  server.on('error', (err) => logger.error({ err }, 'mllp listener error'));
  return server;
}

/**
 * Resolve org_id from the hl7_sending_apps table by exact match on
 * sending_app. Falls back to HL7_DEFAULT_ORG_ID if configured.
 */
async function resolveOrgFromSendingApp(sendingApp) {
  if (!sendingApp) return null;
  try {
    const r = await getPool().query(
      `SELECT org_id FROM hl7_sending_apps
       WHERE sending_app = $1 AND is_active = TRUE
       LIMIT 1`,
      [sendingApp]
    );
    return r.rows[0]?.org_id || null;
  } catch {
    return null;
  }
}

module.exports = { start, resolveOrgFromSendingApp };
