/**
 * src/utils/index.js — shared renderer helpers.
 *
 * These sit between PHI records and what the clinician sees: an age computed a
 * day out, a priority band off by one, or a CSV export that breaks on an
 * embedded comma all change a clinical decision or corrupt an OPTN submission.
 * The module was at 5% line coverage (finding H-8).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createPageUrl,
  formatDate,
  formatDateTime,
  calculateAge,
  getPriorityClass,
  getPriorityLabel,
  formatBloodType,
  formatOrganType,
  exportToCSV,
  isValidEmail,
  generateId,
  debounce,
} from '@/utils';

describe('createPageUrl', () => {
  it('maps the Dashboard to the route root', () => {
    expect(createPageUrl('Dashboard')).toBe('/');
  });

  it('prefixes every other page name', () => {
    expect(createPageUrl('Patients')).toBe('/Patients');
    expect(createPageUrl('OrganOffers')).toBe('/OrganOffers');
  });
});

describe('formatDate / formatDateTime', () => {
  it('renders a missing date as N/A rather than "Invalid Date"', () => {
    for (const empty of [null, undefined, '']) {
      expect(formatDate(empty)).toBe('N/A');
      expect(formatDateTime(empty)).toBe('N/A');
    }
  });

  it('formats an ISO date in UTC with an explicit UTC marker (M-24)', () => {
    // Near a timezone boundary: local rendering could shift the calendar day;
    // UTC labelling must keep the stored day stable.
    expect(formatDate('2026-03-14T01:00:00Z')).toBe('Mar 14, 2026 UTC');
    expect(formatDate('2026-03-14T23:30:00Z')).toBe('Mar 14, 2026 UTC');
  });

  it('includes a time component and UTC marker for a timestamp (M-24)', () => {
    const out = formatDateTime('2026-03-14T12:00:00Z');
    expect(out).toContain('Mar 14, 2026');
    expect(out).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    expect(out.endsWith('UTC')).toBe(true);
  });
});

describe('calculateAge', () => {
  it('returns 0 for a missing date of birth instead of NaN', () => {
    expect(calculateAge(null)).toBe(0);
    expect(calculateAge(undefined)).toBe(0);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
      // Birthday later in March: still 39, not 40.
      expect(calculateAge('1986-03-15')).toBe(39);
      // Birthday earlier in the year: 40.
      expect(calculateAge('1986-01-15')).toBe(40);
      // Birthday today: counts.
      expect(calculateAge('1986-03-01')).toBe(40);
      // Same month, day not yet reached.
      expect(calculateAge('1986-03-02')).toBe(39);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('priority banding', () => {
  it('labels each band at its boundary', () => {
    expect(getPriorityLabel(100)).toBe('Critical');
    expect(getPriorityLabel(80)).toBe('Critical');
    expect(getPriorityLabel(79.9)).toBe('High');
    expect(getPriorityLabel(60)).toBe('High');
    expect(getPriorityLabel(59.9)).toBe('Medium');
    expect(getPriorityLabel(40)).toBe('Medium');
    expect(getPriorityLabel(39.9)).toBe('Low');
    expect(getPriorityLabel(0)).toBe('Low');
  });

  it('uses a distinct colour class per band, and the bands agree with the labels', () => {
    const classes = [100, 70, 50, 10].map(getPriorityClass);
    expect(new Set(classes).size).toBe(4);
    expect(getPriorityClass(80)).toContain('red');
    expect(getPriorityClass(60)).toContain('orange');
    expect(getPriorityClass(40)).toContain('yellow');
    expect(getPriorityClass(39)).toContain('green');
  });
});

describe('clinical value formatting', () => {
  it('never renders a blank blood type as empty', () => {
    expect(formatBloodType('')).toBe('Unknown');
    expect(formatBloodType(null)).toBe('Unknown');
    expect(formatBloodType('O+')).toBe('O+');
  });

  it('renders organ codes as hyphenated title case', () => {
    expect(formatOrganType('kidney')).toBe('Kidney');
    expect(formatOrganType('kidney_pancreas')).toBe('Kidney-Pancreas');
    expect(formatOrganType(null)).toBe('Unknown');
  });
});

describe('exportToCSV', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  /** Capture the CSV text the export would have written to disk. */
  async function capture(rows, filename = 'out.csv') {
    let blob = null;
    URL.createObjectURL = vi.fn((b) => { blob = b; return 'blob:mock'; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    exportToCSV(rows, filename);

    if (!blob) return { text: null, clicked: click.mock.calls.length };
    return { text: await blob.text(), clicked: click.mock.calls.length };
  }

  it('does nothing for an empty dataset rather than writing a headerless file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = await capture([]);
    const b = await capture(null);
    expect(a.text).toBeNull();
    expect(b.text).toBeNull();
    expect(a.clicked).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('emits a header row taken from the first record', async () => {
    const { text } = await capture([{ patient_id: 'MRN-1', organ: 'kidney' }]);
    expect(text.split('\n')[0]).toBe('patient_id,organ');
  });

  it('quotes values containing a comma, a quote, or a newline', async () => {
    const { text } = await capture([
      { name: 'Doe, Jane', note: 'said "urgent"', history: 'line1\nline2' },
    ]);
    const row = text.split('\n').slice(1).join('\n');
    // A surname containing a comma must not split into two columns — that is how
    // an OPTN submission silently shifts every field to the right.
    expect(row).toContain('"Doe, Jane"');
    expect(row).toContain('"said ""urgent"""');
    expect(row).toContain('"line1\nline2"');
  });

  it('renders null and undefined as empty, and serialises nested objects', async () => {
    const { text } = await capture([
      { a: null, b: undefined, c: { hla: 'A1' }, d: 7 },
    ]);
    const row = text.split('\n')[1];
    expect(row.startsWith(',,')).toBe(true);
    expect(row).toContain('hla');
    expect(row.endsWith(',7')).toBe(true);
  });

  it('triggers a download named after the caller\'s filename', async () => {
    let anchor = null;
    const append = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      anchor = node;
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    const { clicked } = await capture([{ a: 1 }], 'waitlist-2026.csv');

    expect(clicked).toBe(1);
    expect(anchor).not.toBeNull();
    expect(anchor.download).toBe('waitlist-2026.csv');
    append.mockRestore();
  });
});

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmail('coordinator@transtrack.local')).toBe(true);
  });

  it('rejects addresses with no domain, no user, spaces, or no dot', () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@c.d', '@example.com', 'a@', 'a@b c.de']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
});

describe('generateId', () => {
  it('returns a distinct identifier on each call', () => {
    const ids = new Set(Array.from({ length: 50 }, generateId));
    expect(ids.size).toBe(50);
  });

  it('falls back to getRandomValues when crypto.randomUUID is unavailable', () => {
    const original = crypto.randomUUID;
    try {
      // Some Electron/jsdom combinations expose crypto without randomUUID.
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});

describe('debounce', () => {
  it('runs once with the final arguments after the wait elapses', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debounced = debounce(fn, 200);
      debounced('a');
      debounced('b');
      debounced('c');
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(199);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('c');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs again for a call made after the previous one fired', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debounced = debounce(fn, 50);
      debounced(1);
      vi.advanceTimersByTime(50);
      debounced(2);
      vi.advanceTimersByTime(50);
      expect(fn.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });
});
