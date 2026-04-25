import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { MllpFramer, frame, SB, EB, CR } = require('../../src/hl7/mllp');

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
