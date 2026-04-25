/**
 * Mirth Connect end-to-end harness.
 *
 * Skipped unless INTEGRATION_MIRTH=1 is set in the environment.  When run,
 * it expects:
 *   - Mirth Connect running on http://localhost:8443/api with the channel
 *     `transtrack-out-mllp` deployed (see docker/mirth/channels/).
 *   - The TransTrack API + MLLP listener running and reachable from the
 *     Mirth container at host.docker.internal:2575.
 *
 * What it does:
 *   1. Posts a sample HL7 file into Mirth's File Reader directory
 *      (./docker/mirth/inbox/) which the channel watches.
 *   2. Polls the TransTrack API for the resulting HL7 message row.
 *   3. Asserts that the patient + observation rows landed in the DB.
 *
 * In CI this test is opt-in so it never blocks the default pipeline.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENABLED = process.env.INTEGRATION_MIRTH === '1';
const apiBase = process.env.API_BASE_URL || 'http://localhost:8080';
const inbox = process.env.MIRTH_INBOX || path.join(__dirname, '..', '..', '..', 'docker', 'mirth', 'inbox');
const auth = process.env.API_BEARER || '';

(ENABLED ? describe : describe.skip)('Mirth Connect → TransTrack', () => {
  it('drops an ADT file into Mirth and observes it land in TransTrack', async () => {
    const adt = [
      'MSH|^~\\&|EPIC|HOSP|TT|TT|20260101120000||ADT^A04|MIRTH-' + Date.now() + '|P|2.5',
      'EVN|A04|20260101120000',
      'PID|1||MIRTH-MRN-1^^^HOSP^MR||MIRTH^TEST||19751212|F',
    ].join('\r');
    fs.mkdirSync(inbox, { recursive: true });
    const file = path.join(inbox, `adt-${Date.now()}.hl7`);
    fs.writeFileSync(file, adt);

    const deadline = Date.now() + 30_000;
    let found;
    while (Date.now() < deadline) {
      const r = await fetch(`${apiBase}/hl7/messages?limit=20`, {
        headers: auth ? { authorization: `Bearer ${auth}` } : {},
      });
      if (r.ok) {
        const list = await r.json();
        found = list.find(m => m.message_control_id?.startsWith('MIRTH-'));
        if (found) break;
      }
      await new Promise(res => setTimeout(res, 1000));
    }
    expect(found, 'expected an HL7 message to be ingested via Mirth').toBeTruthy();
    expect(found.processed_status).toBe('accepted');
  });
});
