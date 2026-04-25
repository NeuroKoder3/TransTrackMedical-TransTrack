import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { VALID_TRANSITIONS } = require('../../src/services/organOfferService');

const canTransition = (from, to) => (VALID_TRANSITIONS[from] || []).includes(to);

describe('organ offer state machine', () => {
  it('exposes the allowed transitions table', () => {
    expect(VALID_TRANSITIONS.OFFERED).toEqual(
      expect.arrayContaining(['ACCEPTED', 'DECLINED', 'EXPIRED', 'BACKUP'])
    );
    expect(VALID_TRANSITIONS.ACCEPTED).toEqual(
      expect.arrayContaining(['IMPLANTED', 'DECLINED'])
    );
    expect(VALID_TRANSITIONS.IMPLANTED).toEqual([]);
    expect(VALID_TRANSITIONS.DECLINED).toEqual([]);
    expect(VALID_TRANSITIONS.EXPIRED).toEqual([]);
  });

  it('permits valid transitions', () => {
    expect(canTransition('OFFERED', 'ACCEPTED')).toBe(true);
    expect(canTransition('OFFERED', 'DECLINED')).toBe(true);
    expect(canTransition('ACCEPTED', 'IMPLANTED')).toBe(true);
    expect(canTransition('BACKUP', 'ACCEPTED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('OFFERED', 'IMPLANTED')).toBe(false);
    expect(canTransition('DECLINED', 'ACCEPTED')).toBe(false);
    expect(canTransition('IMPLANTED', 'DECLINED')).toBe(false);
    expect(canTransition('EXPIRED', 'ACCEPTED')).toBe(false);
  });
});
