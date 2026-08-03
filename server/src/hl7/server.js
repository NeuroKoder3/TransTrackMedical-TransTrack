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
 *
 * The listener is unauthenticated at the transport level unless mutual TLS
 * is configured, so it defaults to binding loopback only (HL7_MLLP_HOST) and
 * applies three resource bounds (H-9):
 *
 *   HL7_MLLP_MAX_MESSAGE_BYTES  cap on the unterminated frame buffer
 *   HL7_MLLP_IDLE_TIMEOUT_MS    per-connection idle / incomplete-frame timeout
 *   HL7_MLLP_MAX_CONNECTIONS    concurrent connection cap
 */

const fs = require('fs');
const net = require('net');
const tls = require('tls');
const { MllpFramer, MllpFrameTooLargeError, frame } = require('./mllp');
const { parseMessage, buildAck } = require('./messageParser');
const vendorProfileService = require('../services/vendorProfileService');
const ingestMod = require('./ingest');
const { getPool, withTransaction } = require('../db/pool');
const { SYSTEM_ORG_ID } = require('../db/systemOrg');

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

  const maxMessageBytes = config.HL7_MLLP_MAX_MESSAGE_BYTES;
  const idleTimeoutMs = config.HL7_MLLP_IDLE_TIMEOUT_MS;
  const maxConnections = config.HL7_MLLP_MAX_CONNECTIONS;

  function handleSocket(socket) {
    const peer = {
      address: socket.remoteAddress,
      port: socket.remotePort,
      certSubject: typeof socket.getPeerCertificate === 'function'
        ? socket.getPeerCertificate()?.subject?.CN
        : null,
    };
    logger.info({ peer }, 'mllp peer connected');

    // Drop a connection that stalls mid-frame (or idles between frames)
    // rather than holding its buffer indefinitely.
    socket.setTimeout(idleTimeoutMs);
    socket.on('timeout', () => {
      logger.warn({ peer, idleTimeoutMs }, 'mllp peer idle timeout; closing connection');
      socket.destroy();
    });

    const framer = new MllpFramer({ maxMessageBytes });
    socket.on('data', async (chunk) => {
      let messages;
      try {
        messages = framer.push(chunk);
      } catch (e) {
        if (e instanceof MllpFrameTooLargeError) {
          // Log the bound that was breached, never the bytes: an
          // unterminated frame may contain partial PHI.
          logger.warn({ peer, bufferedBytes: e.bufferedBytes, maxMessageBytes: e.maxBytes },
            'mllp frame exceeded maximum buffered size; destroying connection');
        } else {
          logger.warn({ peer, err: e.message }, 'mllp framing error; destroying connection');
        }
        socket.destroy();
        return;
      }
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
        const resolvedOrg = await resolveOrgFromSendingApp(parsed.sending_app, parsed.sending_facility);
        const orgId = resolvedOrg || config.HL7_DEFAULT_ORG_ID || null;
        if (!orgId) {
          logger.warn({ sendingApp: parsed.sending_app, msgId: parsed.message_control_id },
            'rejecting message: no org mapping and no HL7_DEFAULT_ORG_ID');
          await quarantineDeadLetter({
            raw, parsed, peer, logger,
            reason: 'No org mapping for sending application',
          });
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

  // Node stops accepting once maxConnections is reached and closes the
  // surplus socket, so a peer cannot exhaust file descriptors.
  server.maxConnections = maxConnections;

  server.listen(config.HL7_MLLP_PORT, config.HL7_MLLP_HOST, () => {
    logger.info({
      host: config.HL7_MLLP_HOST,
      port: config.HL7_MLLP_PORT,
      tls: !!useTls,
      mtls: !!useTls && tlsOpts.requestCert,
      maxMessageBytes,
      idleTimeoutMs,
      maxConnections,
    }, 'mllp listener started');
    if (!useTls && config.HL7_MLLP_HOST !== '127.0.0.1' && config.HL7_MLLP_HOST !== 'localhost') {
      logger.warn({ host: config.HL7_MLLP_HOST },
        'mllp listener is reachable off-host without TLS or peer authentication');
    }
  });

  server.on('error', (err) => logger.error({ err }, 'mllp listener error'));
  return server;
}

/**
 * Resolve org_id from the hl7_sending_apps table.
 *
 * Two keys are tried, most specific first:
 *   1. "<sending_app>|<sending_facility>" — lets one application name be
 *      routed to different tenants per facility (MSH-3 + MSH-4).
 *   2. "<sending_app>" — the plain MSH-3 mapping.
 *
 * This runs before any tenant context exists, so the query is unscoped; the
 * mllp_routing_lookup_hl7_sending_apps policy (migration 010) permits exactly
 * this SELECT and nothing else.
 */
async function resolveOrgFromSendingApp(sendingApp, sendingFacility) {
  if (!sendingApp) return null;
  const keys = [];
  if (sendingFacility) keys.push(`${sendingApp}|${sendingFacility}`);
  keys.push(sendingApp);
  try {
    const r = await getPool().query(
      `SELECT sending_app, org_id FROM hl7_sending_apps
       WHERE sending_app = ANY($1::text[]) AND is_active = TRUE`,
      [keys]
    );
    for (const key of keys) {
      const hit = r.rows.find((row) => row.sending_app === key);
      if (hit) return hit.org_id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * File an unroutable message in the dead-letter quarantine (M-27).
 *
 * The row is attributed to the reserved system organisation rather than
 * being written with a NULL org_id: NULL rows are invisible to every tenant
 * policy but also unowned, so nothing ever reclaims or expires them. The
 * reserved org has no members, so the quarantined PHI stays unreadable
 * through the API while remaining attributable to a concrete owner.
 */
async function quarantineDeadLetter({ raw, parsed, peer, logger, reason }) {
  try {
    await withTransaction({ orgId: SYSTEM_ORG_ID }, async (client) => {
      await client.query(
        `INSERT INTO hl7_dead_letters
           (org_id, raw_message, sending_app, sending_facility, message_type,
            trigger_event, message_control_id, error_reason, peer_address, transport)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'mllp')`,
        [SYSTEM_ORG_ID, raw, parsed.sending_app, parsed.sending_facility,
         parsed.message_type, parsed.trigger_event, parsed.message_control_id,
         reason, peer?.address || null]
      );
    });
  } catch (e) {
    logger.error({ err: e.message, msgId: parsed.message_control_id },
      'failed to quarantine unroutable hl7 message');
  }
}

module.exports = { start, resolveOrgFromSendingApp, quarantineDeadLetter };
