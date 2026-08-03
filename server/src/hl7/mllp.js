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
 *
 * H-9: the framer buffers whatever has not yet been terminated by an end
 * block. A peer that opens a connection and streams bytes without ever
 * sending <EB> would otherwise grow that buffer without limit, which is a
 * trivial remote memory-exhaustion DoS. The buffer is therefore capped; on
 * breach the framer discards what it holds and throws MllpFrameTooLargeError
 * so the listener can destroy the connection. The listener additionally
 * applies a per-connection idle timeout and a concurrent-connection cap.
 */

const SB = 0x0B;
const EB = 0x1C;
const CR = 0x0D;

/** 1 MiB. Real HL7 v2 messages are a few kilobytes; ORU with embedded
 *  reports are the large end and still sit far below this. */
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

class MllpFrameTooLargeError extends Error {
  constructor(bufferedBytes, maxBytes) {
    super(`MLLP frame exceeds ${maxBytes} bytes (buffered ${bufferedBytes})`);
    this.name = 'MllpFrameTooLargeError';
    this.code = 'MLLP_FRAME_TOO_LARGE';
    this.bufferedBytes = bufferedBytes;
    this.maxBytes = maxBytes;
  }
}

class MllpFramer {
  constructor({ maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES } = {}) {
    this.buffer = Buffer.alloc(0);
    this.maxMessageBytes = maxMessageBytes > 0 ? maxMessageBytes : DEFAULT_MAX_MESSAGE_BYTES;
  }
  /**
   * Append data and yield each fully-framed message string (without
   * the start/end markers).  Caller iterates the returned array.
   *
   * Throws MllpFrameTooLargeError once the unparsed buffer exceeds
   * maxMessageBytes. The framer is left empty so the caller may safely
   * discard the connection.
   */
  push(chunk) {
    const combined = Buffer.concat([this.buffer, chunk]);
    if (combined.length > this.maxMessageBytes) {
      this.buffer = Buffer.alloc(0);
      throw new MllpFrameTooLargeError(combined.length, this.maxMessageBytes);
    }
    this.buffer = combined;
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

  /** Bytes currently held awaiting an end block. */
  get bufferedBytes() {
    return this.buffer.length;
  }
}

function frame(message) {
  return Buffer.concat([
    Buffer.from([SB]),
    Buffer.from(message, 'utf8'),
    Buffer.from([EB, CR]),
  ]);
}

module.exports = {
  MllpFramer, MllpFrameTooLargeError, frame,
  SB, EB, CR, DEFAULT_MAX_MESSAGE_BYTES,
};
