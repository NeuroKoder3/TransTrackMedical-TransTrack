/**
 * TransTrack — automatic PHI redaction in the logger (finding H-5).
 *
 * userData/logs/transtrack.log is a plain file on the workstation disk. It is
 * read by support, copied into diagnostic bundles, and — when a deploying
 * organisation configures SENTRY_DSN or TRANSTRACK_REMOTE_LOG_URL — its error
 * lines are POSTed off-box. Redaction was available (services/phiRedaction.cjs)
 * but opt-in per call site, so every `logger.error('...', { patient })` written
 * since was a disclosure, and the uncaughtException handler persisted whole
 * stack traces verbatim.
 *
 * The approach is the one used by tests/supportBundle.test.cjs: log
 * deliberately PHI-laden content with distinctive needle values, then sweep the
 * bytes that each sink actually received and assert no needle survives.
 *
 * Run standalone: node tests/loggerRedaction.test.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-loggerredact-'));

// The remote sink is configured before logger.cjs is required, because it reads
// the environment once at module load.
process.env.TRANSTRACK_REMOTE_LOG_URL = 'https://siem.example.invalid/ingest';
process.env.TRANSTRACK_REMOTE_LOG_LEVELS = 'error,fatal';

const shipped = [];
global.fetch = (url, options) => {
  shipped.push({ url, body: options?.body });
  return Promise.resolve({ ok: true });
};

const consoleLines = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };
function captureConsole(fn) {
  const record = (...args) => consoleLines.push(args.map((a) =>
    typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
  console.log = record; console.warn = record; console.error = record;
  try { return fn(); } finally { Object.assign(console, realConsole); }
}

require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: {
      // isPackaged false keeps the console mirror active so all three sinks are
      // exercised by a single call.
      getPath: (k) => path.join(SANDBOX, String(k)),
      isPackaged: false,
      getVersion: () => '1.2.1-test',
    },
    crashReporter: { start: () => {} },
  },
};

const { logger, getLogDir, closeLogger } = require('../electron/services/logger.cjs');
const { REDACTED } = require('../electron/services/phiRedaction.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function section(name) { cases.push({ section: name }); }

const NEEDLES = {
  lastName: 'Vasquez-Thornbury',
  mrn: 'MRN-99881122',
  dob: '1974-08-19',
  ssn: '412-55-8390',
  email: 'rosa.vasquez@stmarys.example.org',
  phone: '(415) 555-0142',
};

const logPath = path.join(getLogDir(), 'transtrack.log');

/**
 * Everything the disk sink has received so far.
 *
 * The sink is a write stream, so a line is not on disk the instant the call
 * returns; closing it flushes, and the next write reopens in append mode.
 */
async function diskContents() {
  closeLogger();
  await new Promise((resolve) => setTimeout(resolve, 25));
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

function assertNoNeedles(haystack, where) {
  for (const [field, value] of Object.entries(NEEDLES)) {
    assert.ok(
      !haystack.includes(value),
      `${where} leaked ${field} (${value})`
    );
  }
}

section('redaction is applied to every sink, without being asked');

test('structured metadata is redacted on disk, console and the remote sink', async () => {
  captureConsole(() => {
    logger.error('Failed to file chart note', {
      component: 'chartFiling',
      patient_name: NEEDLES.lastName,
      mrn: NEEDLES.mrn,
      date_of_birth: NEEDLES.dob,
      contact: { email: NEEDLES.email, phone: NEEDLES.phone },
    });
  });

  const disk = await diskContents();
  assert.ok(disk.includes('Failed to file chart note'), 'the diagnostic message must survive');
  assert.ok(disk.includes(REDACTED), 'the entry must show that fields were removed');
  assertNoNeedles(disk, 'the log file');
  assertNoNeedles(consoleLines.join('\n'), 'the console mirror');
  assertNoNeedles(shipped.map((s) => s.body).join('\n'), 'the remote sink');
});

test('nested metadata is redacted, not just the top level', async () => {
  logger.warn('Sync conflict', {
    conflict: { incoming: { last_name: NEEDLES.lastName, dob: NEEDLES.dob } },
  });
  assertNoNeedles(await diskContents(), 'nested metadata');
});

test('PHI embedded in the message string is redacted', async () => {
  logger.error(
    `Rejected import for ${NEEDLES.email} — ssn ${NEEDLES.ssn}, callback ${NEEDLES.phone}`
  );
  const disk = await diskContents();
  assert.ok(disk.includes('Rejected import for'), 'the surrounding message must survive');
  assertNoNeedles(disk, 'the message string');
});

test('a stack trace carrying PHI is redacted', async () => {
  // The shape the uncaughtException handler produces: message plus a full stack
  // whose frames can quote query arguments.
  const err = new Error(`insert failed: last_name=${NEEDLES.lastName} email=${NEEDLES.email}`);
  logger.fatal('Uncaught exception', { error: err.message, stack: err.stack });

  const disk = await diskContents();
  assert.ok(disk.includes('Uncaught exception'), 'the fatal marker must survive');
  assertNoNeedles(disk, 'the stack trace');
  assertNoNeedles(shipped.map((s) => s.body).join('\n'), 'the remote sink stack trace');
});

section('diagnostics remain usable');

test('timestamps, versions, identifiers and error codes are preserved', async () => {
  const before = (await diskContents()).length;
  logger.info('Migration applied', {
    component: 'migrations',
    migration: 'add_audit_log_sequence',
    version: '1.2.1',
    code: 'SQLITE_BUSY',
    startedAt: '2026-03-01T10:00:00.000Z',
    requestId: '7f3c2a10-4b21-4f0e-9f77-2b3c8d5e1a44',
    duration: 142,
  });

  const written = (await diskContents()).slice(before);
  for (const keep of [
    'add_audit_log_sequence', '1.2.1', 'SQLITE_BUSY',
    '2026-03-01T10:00:00.000Z', '7f3c2a10-4b21-4f0e-9f77-2b3c8d5e1a44', '142',
  ]) {
    assert.ok(written.includes(keep), `over-redacted: ${keep} was removed`);
  }
});

section('redaction cannot throw or recurse');

test('a self-logging getter does not recurse forever', async () => {
  let nested = 0;
  const meta = {
    component: 'trap',
    get patient_name() {
      nested += 1;
      // A getter that logs re-enters write() from inside redaction.
      logger.info('emitted from inside redaction', { last_name: NEEDLES.lastName });
      return NEEDLES.lastName;
    },
  };

  logger.error('Getter trap', meta);
  assert.ok(nested <= 1, `the getter ran ${nested} times; redaction re-entered itself`);
  const disk = await diskContents();
  assert.ok(disk.includes('SUPPRESSED'), 'the nested call must be answered with a fixed line');
  assertNoNeedles(disk, 'the re-entrant call');
});

test('an object that cannot be walked is dropped rather than written through', async () => {
  const hostile = {
    component: 'hostile',
    get boom() { throw new Error(`explodes with ${NEEDLES.mrn}`); },
  };

  assert.doesNotThrow(() => logger.error('Hostile metadata', hostile), 'the logger must not throw');
  const disk = await diskContents();
  assert.ok(disk.includes('REDACTION FAILED'), 'the failure must be visible in the log');
  assertNoNeedles(disk, 'the failed redaction');
});

test('circular metadata terminates', async () => {
  const cyclic = { component: 'cycle', mrn: NEEDLES.mrn };
  cyclic.self = cyclic;

  assert.doesNotThrow(() => logger.error('Circular metadata', cyclic));
  assertNoNeedles(await diskContents(), 'circular metadata');
});

test('no sink is bypassed: everything shipped remotely is redacted', async () => {
  assert.ok(shipped.length > 0, 'the remote sink must have received something to check');
  assertNoNeedles(shipped.map((s) => s.body).join('\n'), 'the accumulated remote payloads');
});

(async () => {
  for (const c of cases) {
    if (c.section) { console.log(`\n=== ${c.section} ===`); continue; }
    try { await c.fn(); PASS++; console.log(`  ok  ${c.name}`); }
    catch (e) { FAIL++; failures.push({ name: c.name, error: e }); console.log(`  FAIL ${c.name}: ${e.message}`); }
  }

  closeLogger();
  fs.rmSync(SANDBOX, { recursive: true, force: true });

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  if (FAIL > 0) {
    for (const f of failures) console.error(`\n${f.name}:\n${f.error.stack || f.error.message}`);
    process.exit(1);
  }
})();
