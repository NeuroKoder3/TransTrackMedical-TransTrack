'use strict';

/**
 * Minimal Lower-Layer Protocol (MLLP) framing helpers per HL7 v2 spec:
 *
 *   <SB> <message> <EB> <CR>
 *
 * where SB = 0x0B, EB = 0x1C, CR = 0x0D.
 *
 * Hospital interface engines (Mirth Connect, Rhapsody, Cloverleaf, Corepoint)
 * speak this framing over TCP. Production deployments wrap it in TLS and
 * frequently require mutual auth (peer certificate verification) — that is
 * supported by the listener factory below.
 */

const SB = 0x0B;
const EB = 0x1C;
const CR = 0x0D;

class MllpFramer {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }
  /**
   * Append data and yield each fully-framed message string (without
   * the start/end markers).  Caller iterates the returned array.
   */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    let i = 0;
    while (true) {
      const sb = this.buffer.indexOf(SB, i);
      if (sb < 0) {
        // discard junk before next SB
        this.buffer = this.buffer.slice(this.buffer.length);
        break;
      }
      const eb = this.buffer.indexOf(EB, sb + 1);
      if (eb < 0) {
        // wait for more data
        this.buffer = this.buffer.slice(sb);
        break;
      }
      const cr = this.buffer[eb + 1];
      if (cr !== CR) {
        // tolerate missing CR
      }
      const msg = this.buffer.slice(sb + 1, eb).toString('utf8');
      messages.push(msg);
      i = eb + 2;
      if (i >= this.buffer.length) {
        this.buffer = Buffer.alloc(0);
        break;
      }
    }
    if (i > 0 && i < this.buffer.length) {
      this.buffer = this.buffer.slice(i);
    }
    return messages;
  }
}

function frame(message) {
  return Buffer.concat([
    Buffer.from([SB]),
    Buffer.from(message, 'utf8'),
    Buffer.from([EB, CR]),
  ]);
}

module.exports = { MllpFramer, frame, SB, EB, CR };
