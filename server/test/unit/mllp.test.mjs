import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const {
  MllpFramer, MllpFrameTooLargeError, frame,
  SB, EB, CR, DEFAULT_MAX_MESSAGE_BYTES,
} = require('../../src/hl7/mllp');

describe('MLLP framer', () => {
  it('frames an outbound message with SB/EB/CR', () => {
    const out = frame('MSH|^~\\&|TEST|TEST|RX|RX|20260101||ACK|1|P|2.5');
    expect(out[0]).toBe(SB);
    expect(out[out.length - 2]).toBe(EB);
    expect(out[out.length - 1]).toBe(CR);
  });

  it('parses a single complete message', () => {
    const f = new MllpFramer();
    const msg = 'MSH|^~\\&|EPIC|HOSP|TT|TT|||ADT^A04|1|P|2.5';
    const wire = Buffer.concat([Buffer.from([SB]), Buffer.from(msg), Buffer.from([EB, CR])]);
    const out = f.push(wire);
    expect(out).toEqual([msg]);
  });

  it('handles message split across two TCP frames', () => {
    const f = new MllpFramer();
    const msg = 'MSH|^~\\&|EPIC|HOSP|TT|TT|||ADT^A04|1|P|2.5';
    const wire = Buffer.concat([Buffer.from([SB]), Buffer.from(msg), Buffer.from([EB, CR])]);
    const half = Math.floor(wire.length / 2);
    const a = f.push(wire.slice(0, half));
    expect(a).toEqual([]);
    const b = f.push(wire.slice(half));
    expect(b).toEqual([msg]);
  });

  it('handles two messages in one TCP frame', () => {
    const f = new MllpFramer();
    const m1 = 'MSH|^~\\&|A|A|B|B|||ADT^A04|1|P|2.5';
    const m2 = 'MSH|^~\\&|A|A|B|B|||ORU^R01|2|P|2.5';
    const wire = Buffer.concat([
      Buffer.from([SB]), Buffer.from(m1), Buffer.from([EB, CR]),
      Buffer.from([SB]), Buffer.from(m2), Buffer.from([EB, CR]),
    ]);
    const out = f.push(wire);
    expect(out).toEqual([m1, m2]);
  });
});

// ---------------------------------------------------------------------------
// H-9 — the framer must not buffer without limit
// ---------------------------------------------------------------------------

describe('MLLP framer buffer bound', () => {
  it('defaults to a 1 MiB cap', () => {
    expect(DEFAULT_MAX_MESSAGE_BYTES).toBe(1024 * 1024);
    expect(new MllpFramer().maxMessageBytes).toBe(DEFAULT_MAX_MESSAGE_BYTES);
  });

  it('throws once an unterminated frame exceeds the cap', () => {
    const f = new MllpFramer({ maxMessageBytes: 64 });
    // Start block, then a stream that never sends an end block.
    expect(f.push(Buffer.concat([Buffer.from([SB]), Buffer.alloc(32, 0x41)]))).toEqual([]);
    expect(() => f.push(Buffer.alloc(64, 0x41))).toThrow(MllpFrameTooLargeError);
  });

  it('reports the bound it breached without exposing the buffered bytes', () => {
    const f = new MllpFramer({ maxMessageBytes: 16 });
    let caught;
    try {
      f.push(Buffer.concat([Buffer.from([SB]), Buffer.from('PATIENT NAME DOE^JANE 900001')]));
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(MllpFrameTooLargeError);
    expect(caught.code).toBe('MLLP_FRAME_TOO_LARGE');
    expect(caught.maxBytes).toBe(16);
    expect(caught.bufferedBytes).toBeGreaterThan(16);
    expect(caught.message).not.toContain('DOE');
  });

  it('releases the buffer on breach so a dropped connection frees its memory', () => {
    const f = new MllpFramer({ maxMessageBytes: 16 });
    expect(() => f.push(Buffer.alloc(64, SB))).toThrow(MllpFrameTooLargeError);
    expect(f.bufferedBytes).toBe(0);
  });

  it('does not grow without limit across many partial writes', () => {
    const f = new MllpFramer({ maxMessageBytes: 1024 });
    f.push(Buffer.from([SB]));
    let threw = false;
    for (let i = 0; i < 100; i++) {
      try { f.push(Buffer.alloc(64, 0x41)); } catch { threw = true; break; }
    }
    expect(threw).toBe(true);
    expect(f.bufferedBytes).toBeLessThanOrEqual(1024);
  });

  it('still accepts a complete message that fits inside the cap', () => {
    const f = new MllpFramer({ maxMessageBytes: 4096 });
    const msg = 'MSH|^~\\&|EPIC|HOSP|TT|TT|||ADT^A04|1|P|2.5';
    const out = f.push(Buffer.concat([Buffer.from([SB]), Buffer.from(msg), Buffer.from([EB, CR])]));
    expect(out).toEqual([msg]);
    expect(f.bufferedBytes).toBe(0);
  });
});

describe('MLLP listener resource bounds', () => {
  const serverSource = fs.readFileSync(path.resolve('src/hl7/server.js'), 'utf8');
  const configSource = fs.readFileSync(path.resolve('src/config.js'), 'utf8');

  it('destroys a connection that breaches the frame bound', () => {
    expect(serverSource).toContain('MllpFrameTooLargeError');
    expect(serverSource).toContain('socket.destroy()');
  });

  it('applies a per-connection idle timeout', () => {
    expect(serverSource).toContain('socket.setTimeout(idleTimeoutMs)');
    expect(serverSource).toContain("socket.on('timeout'");
    expect(configSource).toContain('HL7_MLLP_IDLE_TIMEOUT_MS');
  });

  it('caps concurrent connections', () => {
    expect(serverSource).toContain('server.maxConnections = maxConnections');
    expect(configSource).toContain('HL7_MLLP_MAX_CONNECTIONS');
  });

  it('binds loopback by default', () => {
    expect(configSource).toMatch(/HL7_MLLP_HOST: z\.string\(\)\.default\('127\.0\.0\.1'\)/);
  });
});
