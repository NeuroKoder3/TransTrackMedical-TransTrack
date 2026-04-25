/**
 * MLLP listener integration test. Connects a TCP client (no TLS) to the
 * running listener, sends a framed ADT and ORU, and asserts an AA ACK is
 * returned. Requires the API + Postgres to be running with migrations.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import net from 'net';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { build } = require('../../src/index');
const hl7Server = require('../../src/hl7/server');
const { withTransaction, query } = require('../../src/db/pool');
const { frame, MllpFramer } = require('../../src/hl7/mllp');

let app, mllp, port, orgId;

beforeAll(async () => {
  process.env.HL7_MLLP_PORT = '0'; // any free port
  process.env.HL7_MLLP_TLS_CERT_FILE = '';
  process.env.HL7_MLLP_TLS_KEY_FILE = '';
  const built = await build();
  app = built.app;

  await withTransaction({}, async (client) => {
    const o = await client.query(
      `INSERT INTO organizations (name) VALUES ('MLLP Test') RETURNING id`
    );
    orgId = o.rows[0].id;
  });
  process.env.HL7_DEFAULT_ORG_ID = orgId;
  // Re-load config + start listener on dynamic port
  const cfg = require('../../src/config').load();
  mllp = hl7Server.start({ config: { ...cfg, HL7_MLLP_PORT: 0, HL7_DEFAULT_ORG_ID: orgId },
                           logger: app.log.child({ component: 'mllp-test' }) });
  await new Promise(resolve => mllp.once('listening', resolve));
  port = mllp.address().port;
});

afterAll(async () => {
  if (mllp) await new Promise(r => mllp.close(r));
  if (orgId) await query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  await app.close();
});

function sendAndCollectAck(host, p, message) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: p }, () => sock.write(frame(message)));
    const framer = new MllpFramer();
    sock.on('data', (chunk) => {
      const acks = framer.push(chunk);
      if (acks.length) {
        sock.end();
        resolve(acks[0]);
      }
    });
    sock.on('error', reject);
    sock.setTimeout(5000, () => reject(new Error('mllp ack timeout')));
  });
}

describe('mllp ingest', () => {
  it('accepts ADT^A04 and returns AA', async () => {
    const msg = [
      'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||ADT^A04|MLLP1|P|2.5',
      'EVN|A04|20260101120000',
      'PID|1||MLLP-MRN-1^^^HOSP^MR||SMITH^JOHN||19700101|M',
      'PV1|1|O|CLINIC',
    ].join('\r');
    const ack = await sendAndCollectAck('127.0.0.1', port, msg);
    expect(ack).toMatch(/MSA\|AA\|MLLP1/);
  });

  it('accepts ORU^R01 and creates lab rows', async () => {
    const msg = [
      'MSH|^~\\&|LAB|HOSP|TT|TT|20260101120000||ORU^R01|MLLP2|P|2.5',
      'PID|1||MLLP-MRN-1^^^HOSP^MR||SMITH^JOHN',
      'OBR|1|O1||CHEM7^Chem 7^L|||20260101120000',
      'OBX|1|NM|2160-0^Creatinine^LN||1.0|mg/dL|||||F|||20260101120000',
    ].join('\r');
    const ack = await sendAndCollectAck('127.0.0.1', port, msg);
    expect(ack).toMatch(/MSA\|AA\|MLLP2/);
    // Verify the lab landed in the database
    const r = await query(
      `SELECT count(*)::int AS n FROM lab_results WHERE org_id = $1 AND test_code = '2160-0'`,
      [orgId]
    );
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});
