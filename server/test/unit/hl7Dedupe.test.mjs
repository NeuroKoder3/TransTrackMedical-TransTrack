import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('HL7 ingest deduplication', () => {
  const ingestSource = fs.readFileSync(
    path.resolve('src/hl7/ingest.js'), 'utf8'
  );

  it('uses ON CONFLICT DO NOTHING for message_control_id deduplication', () => {
    expect(ingestSource).toContain('ON CONFLICT (org_id, message_control_id)');
    expect(ingestSource).toContain('DO NOTHING');
  });

  it('returns duplicate ack when INSERT returns zero rows', () => {
    expect(ingestSource).toContain('ins.rows.length === 0');
    expect(ingestSource).toContain("processed: 'duplicate'");
    expect(ingestSource).toContain("ackCode: 'AA'");
    expect(ingestSource).toContain('Duplicate message (already processed)');
  });

  it('proceeds normally when INSERT returns a row (new message)', () => {
    expect(ingestSource).toContain('const messageId = ins.rows[0].id');
  });

  it('exports a deadLetter function for failed messages', () => {
    expect(ingestSource).toContain('async function deadLetter');
    expect(ingestSource).toContain('hl7_dead_letters');
    expect(ingestSource).toContain("module.exports = { ingest, deadLetter }");
  });
});
