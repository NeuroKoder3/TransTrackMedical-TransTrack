/**
 * TransTrack — support bundle and PHI redaction.
 *
 * A support bundle is designed to leave the safeguarded environment: it gets
 * attached to a ticket and emailed. So the only claim that really matters is
 * that it contains no PHI, and that claim has to be tested adversarially rather
 * than by inspection.
 *
 * The approach: feed the pure assembler deliberately PHI-laden input — patient
 * names, MRNs, dates of birth, SSNs, emails, phone numbers, nested inside
 * objects and embedded in log lines — then assert that none of those literals
 * survives anywhere in the serialised output. The needle values are distinctive
 * so a single `includes` sweep over the whole JSON is a meaningful check.
 *
 * The suite also covers the opposite failure: over-redaction. A bundle stripped
 * of timestamps, versions and identifiers is useless for support, and if
 * diagnostics are useless people stop collecting them.
 *
 * Run standalone: node tests/supportBundle.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bundleSvc = require('../electron/services/supportBundle.cjs');
const redaction = require('../electron/services/phiRedaction.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

/**
 * Distinctive PHI needles. Every one must be absent from a serialised bundle.
 */
const NEEDLES = {
  firstName: 'Zephyrina',
  lastName: 'Quibblesworth',
  mrn: 'MRN-987654321',
  dob: '1974-03-22',
  ssn: '123-45-6789',
  email: 'zephyrina.quibblesworth@example.org',
  phone: '(555) 867-5309',
  address: '4417 Nonexistent Parkway',
  note: 'Patient mentioned she lives with her sister Marguerite',
};

function phiLadenInput() {
  return {
    generatedAt: '2026-08-01T12:00:00Z',
    app: { name: 'TransTrack', version: '1.2.0', platform: 'win32', arch: 'x64', node: 'v24.13.0' },
    health: {
      status: 'warn',
      components: {
        database: { status: 'ok', tableCount: 42 },
        // A subsystem that unwisely included a record in its diagnostic payload.
        lastError: {
          message: `Failed to update patient ${NEEDLES.firstName} ${NEEDLES.lastName}`,
          patient: {
            first_name: NEEDLES.firstName,
            last_name: NEEDLES.lastName,
            mrn: NEEDLES.mrn,
            date_of_birth: NEEDLES.dob,
            contact: { email: NEEDLES.email, phone: NEEDLES.phone, address: NEEDLES.address },
          },
        },
      },
    },
    migrationStatus: { currentVersion: 17, applied: [{ version: 17, name: 'add_iota' }] },
    counts: { patients: 412, users: 9, auditLogs: 88213 },
    backups: [{
      createdAt: '2026-07-31T23:00:00Z',
      type: 'automatic',
      // Operator free text, which in the field does contain patient names.
      description: `Backup before fixing ${NEEDLES.firstName} ${NEEDLES.lastName} record`,
      checksum: 'a'.repeat(64),
      checksumAlgorithm: 'sha256',
      stats: { fileSizeBytes: 12345678, patientCount: 412, auditCount: 88213 },
    }],
    logLines: [
      JSON.stringify({ level: 'error', ts: '2026-08-01T11:59:00Z', message: 'update failed', meta: { mrn: NEEDLES.mrn, patient_name: `${NEEDLES.firstName} ${NEEDLES.lastName}` } }),
      JSON.stringify({ level: 'info', ts: '2026-08-01T11:59:01Z', message: 'contacted patient', meta: { email: NEEDLES.email, phone: NEEDLES.phone } }),
      `2026-08-01T11:59:02Z WARN ssn=${NEEDLES.ssn} verification failed`,
      `plain text line mentioning ${NEEDLES.email} and ${NEEDLES.phone}`,
      JSON.stringify({ level: 'debug', message: 'note recorded', meta: { note: NEEDLES.note } }),
    ],
    environment: { nodeEnv: 'production', backupDirConfigured: true },
    notes: { reportedBy: 'site admin', detail: `Problem started after editing ${NEEDLES.lastName}` },
  };
}

console.log('\nDefault mode: no PHI survives, including names in prose');

const built = bundleSvc.assembleBundle(phiLadenInput());
const serialized = bundleSvc.serializeBundle(built).json;

for (const [label, needle] of Object.entries(NEEDLES)) {
  test(`the ${label} literal does not appear anywhere in the bundle`, () => {
    assert.ok(
      !serialized.includes(needle),
      `found PHI (${label}: "${needle}") in the serialised support bundle`,
    );
  });
}

test('a patient name embedded in an error message is withheld', () => {
  // This is the case that field-name redaction cannot solve and that motivated
  // withholding free text rather than trying to scrub it.
  assert.ok(!serialized.includes('Quibblesworth'));
  assert.match(JSON.stringify(built.health), /FREE_TEXT_OMITTED/);
});

test('backup descriptions are dropped entirely rather than redacted', () => {
  assert.strictEqual(built.backups.length, 1);
  assert.ok(!('description' in built.backups[0]), 'description must not be present');
});

test('the bundle declares no PHI, and that free text was withheld', () => {
  assert.strictEqual(built.redactionPolicy.mode, 'no-free-text');
  assert.strictEqual(built.redactionPolicy.containsPhi, false);
  assert.strictEqual(built.redactionPolicy.handleAsPhi, false);
  assert.match(built.redactionPolicy.freeTextHandling, /WITHHELD/);
  assert.ok(built.redactionPolicy.neverIncluded.includes('patient records'));
});

test('withheld values carry a length hint so support knows what it is missing', () => {
  assert.match(JSON.stringify(built), /\[FREE_TEXT_OMITTED\] \(\d+ chars\)/);
});

console.log('\nOpt-in full-text mode is explicit and self-labelling');

const verbose = bundleSvc.assembleBundle({ ...phiLadenInput(), includeFreeText: true });
const verboseJson = bundleSvc.serializeBundle(verbose).json;

test('full-text mode refuses to claim the bundle is PHI-free', () => {
  assert.strictEqual(verbose.redactionPolicy.mode, 'full-text');
  assert.strictEqual(verbose.redactionPolicy.containsPhi, 'unknown');
  assert.strictEqual(verbose.redactionPolicy.handleAsPhi, true);
  assert.match(verbose.redactionPolicy.freeTextHandling, /Handle this bundle as PHI/);
});

test('full-text mode still strips PHI-named fields and matchable patterns', () => {
  // Names in prose survive here by design; structured identifiers must not.
  for (const label of ['mrn', 'dob', 'ssn', 'email', 'phone', 'address']) {
    assert.ok(
      !verboseJson.includes(NEEDLES[label]),
      `${label} must still be removed even in full-text mode`,
    );
  }
});

test('full-text mode actually includes message bodies', () => {
  assert.ok(verboseJson.includes('update failed'), 'log messages should be present in full-text mode');
  assert.strictEqual(verbose.logTail.freeTextIncluded, true);
});

console.log('\nThe bundle is still useful (redaction is not indiscriminate)');

test('aggregate counts are preserved', () => {
  assert.strictEqual(built.counts.patients, 412);
  assert.strictEqual(built.counts.auditLogs, 88213);
});

test('version, platform and schema information are preserved', () => {
  assert.strictEqual(built.app.version, '1.2.0');
  assert.strictEqual(built.app.platform, 'win32');
  assert.strictEqual(built.migrations.currentVersion, 17);
});

test('migration names survive redaction', () => {
  // Over-redaction regression: a bare `name` key was once treated as PHI, which
  // blanked the applied-migration list — the single most useful field when
  // diagnosing a failed upgrade — while protecting nothing, since patient
  // identity lives in first_name/last_name.
  assert.strictEqual(built.migrations.applied[0].name, 'add_iota');
  assert.ok(!redaction.isPhiKey('name'), 'bare `name` must not be treated as PHI');
  for (const key of ['patient_name', 'first_name', 'last_name', 'full_name']) {
    assert.ok(redaction.isPhiKey(key), `${key} must still be treated as PHI`);
  }
});

test('timestamps survive redaction', () => {
  assert.strictEqual(built.generatedAt, '2026-08-01T12:00:00Z');
  assert.strictEqual(built.backups[0].createdAt, '2026-07-31T23:00:00Z');
  assert.ok(serialized.includes('2026-08-01T11:59:00Z'), 'log timestamps are needed to sequence a failure');
});

test('non-PHI health detail survives', () => {
  assert.strictEqual(built.health.components.database.tableCount, 42);
  assert.strictEqual(built.health.status, 'warn');
});

test('log event sequence is preserved even with messages withheld', () => {
  // The skeleton must still let support reconstruct what happened when.
  const first = JSON.parse(built.logTail.lines[0]);
  assert.strictEqual(first.level, 'error');
  assert.strictEqual(first.ts, '2026-08-01T11:59:00Z');
  assert.deepStrictEqual(
    first.metaKeys, ['mrn', 'patient_name'],
    'metadata key names show which fields were involved without exposing values',
  );
});

test('an unstructured log line is reduced to a placeholder, not leaked', () => {
  const unstructured = built.logTail.lines.find((l) => l.includes('unstructured'));
  assert.ok(unstructured, 'the plain-text line should be reduced to a marker');
  assert.ok(!unstructured.includes(NEEDLES.email));
});

test('checksums and hex digests are not mangled', () => {
  assert.strictEqual(built.backups[0].checksumPresent, true);
  assert.strictEqual(redaction.redactText('a'.repeat(64)), 'a'.repeat(64));
});

test('every log line is accounted for, none silently dropped', () => {
  assert.strictEqual(built.logTail.lineCount, 5);
  assert.strictEqual(built.logTail.lines.length, 5);
  assert.ok(built.logTail.lines.every((l) => typeof l === 'string' && l.length > 0));
  assert.strictEqual(built.logTail.freeTextIncluded, false);
});

console.log('\nRedaction primitives');

test('PHI keys are matched regardless of case and separators', () => {
  for (const key of ['date_of_birth', 'dateOfBirth', 'DATE-OF-BIRTH', 'DOB', 'medicalRecordNumber']) {
    assert.ok(redaction.isPhiKey(key), `${key} should be treated as PHI`);
  }
  for (const key of ['status', 'version', 'createdAt', 'tableCount', 'id']) {
    assert.ok(!redaction.isPhiKey(key), `${key} should NOT be treated as PHI`);
  }
});

test('nested PHI is redacted at depth', () => {
  const out = redaction.redactValue({ a: { b: { c: { mrn: NEEDLES.mrn, keep: 'yes' } } } });
  assert.strictEqual(out.a.b.c.mrn, redaction.REDACTED);
  assert.strictEqual(out.a.b.c.keep, 'yes');
});

test('PHI inside arrays is redacted', () => {
  const out = redaction.redactValue({ items: [{ ssn: NEEDLES.ssn }, { ok: 1 }] });
  assert.strictEqual(out.items[0].ssn, redaction.REDACTED);
  assert.strictEqual(out.items[1].ok, 1);
});

test('circular structures do not hang the redactor', () => {
  const cyclic = { name: 'x' };
  cyclic.self = cyclic;
  const out = redaction.redactValue(cyclic);
  assert.strictEqual(out.self, '[CIRCULAR]');
});

test('free-text emails, SSNs and phone numbers are masked', () => {
  assert.ok(!redaction.redactText(`contact ${NEEDLES.email}`).includes(NEEDLES.email));
  assert.ok(!redaction.redactText(`ssn ${NEEDLES.ssn}`).includes(NEEDLES.ssn));
  assert.ok(!redaction.redactText(`call ${NEEDLES.phone}`).includes(NEEDLES.phone));
});

test('UUIDs and ISO timestamps in free text are left intact', () => {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  assert.strictEqual(redaction.redactText(uuid), uuid);
  assert.strictEqual(redaction.redactText('2026-08-01T12:00:00Z'), '2026-08-01T12:00:00Z');
});

test('a malformed log line is still redacted as text', () => {
  const out = redaction.redactLogLine(`{not really json ${NEEDLES.email}`);
  assert.ok(!out.includes(NEEDLES.email));
});

test('logger.redactPhi now redacts nested objects', () => {
  // Regression guard: the original implementation was shallow, so PHI one level
  // down reached the log file untouched.
  const { redactPhi } = require('../electron/services/logger.cjs');
  const out = redactPhi({ outer: { mrn: NEEDLES.mrn } });
  assert.strictEqual(out.outer.mrn, redaction.REDACTED);
});

console.log('\nLog tail reading');

test('reads only the last N lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-logtail-'));
  const file = path.join(dir, 'transtrack.log');
  const lines = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ n: i }));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);

  const tail = bundleSvc.readLogTail(file, 50);
  assert.strictEqual(tail.length, 50);
  assert.ok(tail[tail.length - 1].includes('"n":999'), 'must end at the newest line');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing log file yields no lines rather than throwing', () => {
  assert.deepStrictEqual(bundleSvc.readLogTail(path.join(os.tmpdir(), 'definitely-absent.log')), []);
  assert.deepStrictEqual(bundleSvc.readLogTail(null), []);
});

console.log('\nAssembly contract');

test('generatedAt is required', () => {
  assert.throws(() => bundleSvc.assembleBundle({}), /generatedAt is required/);
});

test('an empty bundle assembles without throwing', () => {
  const b = bundleSvc.assembleBundle({ generatedAt: '2026-08-01T00:00:00Z' });
  assert.strictEqual(b.logTail.lineCount, 0);
  assert.deepStrictEqual(b.backups, []);
  assert.strictEqual(b.health, null);
});

test('serialisation is deterministic and checksummed', () => {
  const a = bundleSvc.serializeBundle(built);
  const b = bundleSvc.serializeBundle(built);
  assert.strictEqual(a.checksum, b.checksum);
  assert.match(a.checksum, /^[0-9a-f]{64}$/);
});

test('the suggested filename is filesystem-safe', () => {
  const name = bundleSvc.suggestFileName(new Date('2026-08-01T12:34:56.789Z'));
  assert.ok(!/[:*?"<>|]/.test(name), `filename must avoid reserved characters: ${name}`);
  assert.match(name, /^transtrack-support-.*\.json$/);
});

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.stack}\n`);
  process.exit(1);
}
