/**
 * TransTrack — PHI redaction for anything that leaves the encrypted database.
 *
 * Log files, crash metadata and support bundles all travel: they get copied off
 * a workstation, attached to a ticket, or forwarded to a SIEM. Under HIPAA those
 * destinations are usually outside the safeguards protecting the database, so
 * anything written there has to be scrubbed at the point of writing rather than
 * trusted to be clean.
 *
 * There was previously a shallow, object-only `redactPhi()` in logger.cjs with
 * no callers. Shallow was not enough for the two shapes that actually occur —
 * nested metadata objects, and whole log lines that are JSON strings — so this
 * module provides one implementation for all of them and logger.cjs delegates to
 * it. One definition, one test suite, no drift.
 *
 * Design choices worth knowing:
 *
 *   • Key-based redaction is the primary mechanism, because it is precise: if a
 *     field is named `date_of_birth`, its value goes regardless of format.
 *   • Pattern-based redaction of free text is a backstop for strings that were
 *     assembled before anyone thought about structure (error messages, SQL
 *     fragments). It is deliberately conservative: patterns that would eat
 *     timestamps, version numbers, UUIDs or hex digests are not used, because a
 *     log stripped of those is useless for support and people then turn logging
 *     off entirely.
 *   • Redaction is not reversible and not a hash. Nothing here should be relied
 *     on for correlation.
 */

'use strict';

const REDACTED = '[REDACTED]';

/**
 * Field names whose values are PHI or directly identifying. Compared
 * case-insensitively and ignoring separators, so `dateOfBirth`, `date_of_birth`
 * and `DATE-OF-BIRTH` all match one entry.
 */
const PHI_KEYS = [
  // Deliberately NOT bare `name`: the patients table stores identity in
  // first_name/last_name, while `name` is used throughout for migrations,
  // components, files and organisations. Redacting it removed the migration name
  // from a diagnostics bundle, which is exactly the detail support needs, and
  // bought no protection.
  'patient_name', 'patientname', 'first_name', 'last_name', 'middle_name',
  'full_name', 'maiden_name', 'preferred_name',
  'date_of_birth', 'dob', 'birth_date',
  'ssn', 'social_security_number',
  'address', 'address_line1', 'address_line2', 'street', 'city', 'postal_code', 'zip', 'zipcode',
  'phone', 'phone_number', 'mobile', 'home_phone', 'cell',
  'email', 'email_address',
  'mrn', 'medical_record_number', 'medicalrecordnumber', 'record_number',
  'hla_typing', 'hla',
  'insurance_id', 'member_id', 'policy_number',
  'unos_id', 'donor_id_external',
  'notes', 'note', 'comment', 'comments', 'reason_note', 'description_phi',
  'emergency_contact', 'next_of_kin', 'guardian_name',
];

const normalizeKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const PHI_KEY_SET = new Set(PHI_KEYS.map(normalizeKey));

function isPhiKey(key) {
  return PHI_KEY_SET.has(normalizeKey(key));
}

/**
 * Free-text patterns. Ordered so more specific patterns run first.
 *
 * Explicitly NOT matched: ISO timestamps, semver, UUIDs and hex digests. Those
 * are load-bearing for diagnosis and contain no PHI.
 */
const TEXT_PATTERNS = [
  // Email addresses.
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // US SSN, with or without separators.
  { name: 'ssn', re: /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g },
  // Phone numbers in common North American shapes, including +1 and parens.
  { name: 'phone', re: /(?:\+1[-. ]?)?(?:\(\d{3}\)[-. ]?|\b\d{3}[-. ])\d{3}[-. ]?\d{4}\b/g },
];

/**
 * Redact PHI-looking substrings from free text.
 *
 * Strings that are entirely a timestamp, UUID or hex digest are returned
 * untouched, so a message that is just an identifier is never mangled.
 */
function redactText(value) {
  if (typeof value !== 'string' || value.length === 0) return value;

  // Leave pure identifiers/timestamps alone.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(value)) return value;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  if (/^[0-9a-f]{32,}$/i.test(value)) return value;

  let out = value;
  for (const { re } of TEXT_PATTERNS) {
    out = out.replace(re, REDACTED);
  }

  // JSON-ish "key": "value" pairs embedded in a message.
  out = out.replace(
    /("|')([A-Za-z0-9_]+)\1(\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}\s]+)/g,
    (match, q, key, sep, val) => (isPhiKey(key) ? `${q}${key}${q}${sep}"${REDACTED}"` : match),
  );

  // key=value pairs in a log message.
  out = out.replace(
    /\b([A-Za-z0-9_]+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;)]+)/g,
    (match, key) => (isPhiKey(key) ? `${key}=${REDACTED}` : match),
  );

  return out;
}

/**
 * Deep-redact a value: objects by key, strings by pattern.
 *
 * Cycles are broken and depth is capped so a pathological object cannot hang or
 * blow the stack on a path whose whole purpose is diagnostics.
 */
function redactValue(value, options = {}) {
  const { maxDepth = 8, scrubText = true } = options;
  const seen = new WeakSet();

  const walk = (val, depth) => {
    if (val === null || val === undefined) return val;

    if (typeof val === 'string') return scrubText ? redactText(val) : val;
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return val;
    if (typeof val === 'function') return '[Function]';
    if (val instanceof Date) return val.toISOString();

    if (depth >= maxDepth) return '[TRUNCATED]';

    if (Array.isArray(val)) {
      if (seen.has(val)) return '[CIRCULAR]';
      seen.add(val);
      return val.map((item) => walk(item, depth + 1));
    }

    if (typeof val === 'object') {
      if (seen.has(val)) return '[CIRCULAR]';
      seen.add(val);
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = isPhiKey(k) ? REDACTED : walk(v, depth + 1);
      }
      return out;
    }

    return String(val);
  };

  return walk(value, 0);
}

/**
 * Redact a single line from the structured log.
 *
 * Log lines are JSON objects when written by logger.cjs, but a line can also be
 * a stack-trace continuation or a stray write. Structured lines are redacted by
 * key (precise); anything else falls back to text patterns.
 */
function redactLogLine(line) {
  if (typeof line !== 'string') return line;
  const trimmed = line.trim();
  if (trimmed === '') return line;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.stringify(redactValue(JSON.parse(trimmed)));
    } catch {
      // Not valid JSON after all — treat as text.
    }
  }
  return redactText(line);
}

/**
 * Shallow, object-only redaction kept for the original logger.redactPhi
 * contract. Prefer redactValue for anything nested.
 */
function redactShallow(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = isPhiKey(k) ? REDACTED : v;
  }
  return out;
}

module.exports = {
  REDACTED,
  PHI_KEYS,
  isPhiKey,
  redactText,
  redactValue,
  redactLogLine,
  redactShallow,
};
