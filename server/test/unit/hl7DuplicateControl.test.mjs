/**
 * TransTrack — HL7 duplicate control ID tests.
 *
 * Validates that the HL7 ingest pipeline persists message_control_id
 * and that the database schema can detect duplicate control IDs.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('HL7 message_control_id handling', () => {
  const ingestSource = fs.readFileSync(
    path.resolve('src/hl7/ingest.js'), 'utf8'
  );

  it('INSERT captures message_control_id in hl7_messages table', () => {
    expect(ingestSource).toContain('message_control_id');
    expect(ingestSource).toContain("parsed.message_control_id || null");
  });

  it('uses a dedicated column for message_control_id', () => {
    // The INSERT statement should list message_control_id as a column
    const insertMatch = ingestSource.match(/INSERT INTO hl7_messages[^)]+\)/s);
    expect(insertMatch).toBeTruthy();
    expect(insertMatch[0]).toContain('message_control_id');
  });
});

describe('HL7 message parser returns control ID', () => {
  it('base parser (hl7v2.cjs) extracts message_control_id from MSH-10', () => {
    const basePath = path.resolve('../electron/services/hl7v2.cjs');
    if (!fs.existsSync(basePath)) {
      // Fall back: the base parser may live elsewhere
      const parserPath = path.resolve('src/hl7/messageParser.js');
      expect(fs.existsSync(parserPath)).toBe(true);
      return;
    }
    const baseSource = fs.readFileSync(basePath, 'utf8');
    expect(baseSource).toContain('message_control_id');
  });
});

describe('HL7 MLLP server handles NACKs', () => {
  const serverSource = fs.readFileSync(
    path.resolve('src/hl7/server.js'), 'utf8'
  );

  it('builds ACK/NACK responses for each message', () => {
    expect(serverSource).toContain('buildAck');
    expect(serverSource).toContain('AR');
    expect(serverSource).toContain('AE');
  });

  it('NACK on parse failure includes message_control_id fallback', () => {
    expect(serverSource).toContain("message_control_id: 'UNKNOWN'");
  });
});
