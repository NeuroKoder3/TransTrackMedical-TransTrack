/**
 * TransTrack — CMS IOTA waitlist status notice generator.
 *
 * The generator's job is not merely to produce a letter; it is to make three
 * claims defensible under CMS IOTA § 512.442(d):
 *
 *   • all five required elements are stated, and a center cannot edit one out
 *     of its own template;
 *   • the 10-day deadline and the annual anniversary derive from the
 *     transition's effective time, not from wall-clock time at generation; and
 *   • the same inputs always produce the same bytes, so the content hash is a
 *     usable integrity control and idempotency key.
 *
 * Run standalone: node tests/iotaNoticeGenerator.test.cjs
 */

'use strict';

const assert = require('assert');
const { createHash } = require('node:crypto');

const gen = require('../electron/services/iotaNoticeGenerator.cjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) {
    FAIL++; failures.push({ name, error: e });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const TRANSITION = Object.freeze({
  id: 'trans-1',
  fromStatus: 'active',
  toStatus: 'inactive',
  reasonCode: 'EVAL_EXPIRED',
  reasonNote: null,
  effectiveAt: '2026-07-01T14:30:00Z',
  offerEligibilityImpact: 'blocks_offers',
});

const PATIENT = Object.freeze({
  firstName: 'Camila',
  lastName: 'Lopez',
  mrn: 'MRN-00421',
  isEsrd: true,
  dialysisFacilityName: 'Riverside Dialysis Center',
});

const CENTER = Object.freeze({
  name: 'Example Kidney Transplant Program',
  contact: 'Transplant Office, (555) 010-2000, transplant@example.org',
  reactivationSteps:
    'Call the transplant office to schedule your annual evaluation. Once it is '
    + 'complete and reviewed, we will return you to active status.',
  coordinatorName: 'A. Coordinator, RN',
  coordinatorPhone: '(555) 010-2001',
});

function makeArgs(overrides = {}) {
  return {
    transition: { ...TRANSITION, ...(overrides.transition || {}) },
    patient: { ...PATIENT, ...(overrides.patient || {}) },
    center: { ...CENTER, ...(overrides.center || {}) },
    // `in` rather than an undefined check, so a test can pass an explicitly
    // undefined template instead of silently getting the example one.
    template: 'template' in overrides ? overrides.template : gen.EXAMPLE_TEMPLATE,
  };
}

console.log('\nTemplate validation — a center cannot remove a required element');

test('the exported example template is itself valid', () => {
  const report = gen.validateTemplate(gen.EXAMPLE_TEMPLATE);
  assert.ok(report.ok, `example template should validate: ${JSON.stringify(report)}`);
  assert.deepStrictEqual(report.missing, []);
  assert.deepStrictEqual(report.unknown, []);
});

test('all five required placeholders are enforced', () => {
  assert.deepStrictEqual([...gen.REQUIRED_TOKENS].sort(), [
    'centerContact',
    'inactiveSinceDate',
    'offerEligibilityStatement',
    'reactivationSteps',
    'statusChangeReason',
  ]);
});

for (const token of gen.REQUIRED_TOKENS) {
  test(`removing {{${token}}} makes the template invalid`, () => {
    const stripped = gen.EXAMPLE_TEMPLATE.replace(
      new RegExp(`\\{\\{${token}\\}\\}`, 'g'), '',
    );
    const report = gen.validateTemplate(stripped);
    assert.strictEqual(report.ok, false);
    assert.ok(report.missing.includes(token));
  });

  test(`generateNotice refuses a template missing {{${token}}}`, () => {
    const stripped = gen.EXAMPLE_TEMPLATE.replace(
      new RegExp(`\\{\\{${token}\\}\\}`, 'g'), '',
    );
    assert.throws(
      () => gen.generateNotice(makeArgs({ template: stripped })),
      new RegExp(`required element placeholder\\(s\\).*${token}`),
    );
  });
}

test('an unknown placeholder is rejected rather than rendered literally', () => {
  const template = `${gen.EXAMPLE_TEMPLATE}\nAccount: {{acccountNumber}}`;
  const report = gen.validateTemplate(template);
  assert.strictEqual(report.ok, false);
  assert.deepStrictEqual(report.unknown, ['acccountNumber']);
  assert.throws(
    () => gen.generateNotice(makeArgs({ template })),
    /unknown placeholder\(s\): acccountNumber/,
  );
});

test('an empty or non-string template is rejected', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    assert.strictEqual(gen.validateTemplate(bad).ok, false);
    assert.throws(() => gen.generateNotice(makeArgs({ template: bad })), /required element/);
  }
});

test('no rendered notice ever contains an unsubstituted placeholder', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.ok(!/\{\{/.test(notice.content), 'content should have no {{ left in it');
});

console.log('\nRequired content — the five elements are actually stated');

test('every required element appears in the rendered notice', () => {
  const notice = gen.generateNotice(makeArgs());
  for (const [key, value] of Object.entries(notice.requiredElements)) {
    assert.ok(
      notice.content.includes(value),
      `${key} value should appear verbatim in the notice`,
    );
  }
});

test('the inactive-since date is the transition effective date, rendered plainly', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.strictEqual(notice.requiredElements.inactiveSinceDate, 'July 1, 2026');
  assert.ok(notice.content.includes('July 1, 2026'));
});

test('the offer-eligibility statement is system-supplied, not template-supplied', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.strictEqual(
    notice.requiredElements.offerEligibilityStatement,
    gen.OFFER_ELIGIBILITY_STATEMENT,
  );
  assert.match(notice.content, /cannot receive organ offers/);
});

test('a reason code is rendered as patient-facing wording, not the code', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.strictEqual(
    notice.requiredElements.statusChangeReason,
    gen.DEFAULT_REASON_LABELS.EVAL_EXPIRED,
  );
  assert.ok(!notice.content.includes('EVAL_EXPIRED'), 'raw codes must not reach the patient');
});

test('an unmapped reason code falls back to the free-text note', () => {
  const notice = gen.generateNotice(makeArgs({
    transition: { reasonCode: 'CENTER_SPECIFIC_XYZ', reasonNote: 'we need updated cardiac clearance' },
  }));
  assert.strictEqual(notice.requiredElements.statusChangeReason, 'we need updated cardiac clearance');
});

test('a center may supply wording for its own reason codes', () => {
  const notice = gen.generateNotice(makeArgs({
    transition: { reasonCode: 'CENTER_SPECIFIC_XYZ', reasonNote: null },
  }), {
    reasonLabels: { CENTER_SPECIFIC_XYZ: 'we need updated cardiac clearance' },
  });
  assert.strictEqual(notice.requiredElements.statusChangeReason, 'we need updated cardiac clearance');
});

test('a transition with no usable reason is refused rather than left blank', () => {
  assert.throws(
    () => gen.generateNotice(makeArgs({
      transition: { reasonCode: null, reasonNote: null },
    })),
    /neither a mapped reasonCode nor a reasonNote/,
  );
});

test('missing center reactivation steps or contact are refused', () => {
  assert.throws(
    () => gen.generateNotice(makeArgs({ center: { reactivationSteps: '' } })),
    /center\.reactivationSteps is required/,
  );
  assert.throws(
    () => gen.generateNotice(makeArgs({ center: { contact: '   ' } })),
    /center\.contact is required/,
  );
});

console.log('\nDeadlines — derived from the transition, not from the clock');

test('the due date is exactly 10 days after the effective time', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.strictEqual(notice.effectiveAt, '2026-07-01T14:30:00Z');
  assert.strictEqual(notice.dueAt, '2026-07-11T14:30:00Z');
});

test('the annual anniversary is 365 days after the effective time', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.strictEqual(notice.nextAnnualDueAt, '2027-07-01T14:30:00Z');
});

test('a late generation does not move the deadline', () => {
  const notice = gen.generateNotice(makeArgs(), { generatedAt: '2026-07-09T08:00:00Z' });
  assert.strictEqual(notice.dueAt, '2026-07-11T14:30:00Z', 'deadline follows the change, not the letter');
  assert.strictEqual(notice.generatedAt, '2026-07-09T08:00:00Z');
});

test('generation before the change it describes is refused', () => {
  assert.throws(
    () => gen.generateNotice(makeArgs(), { generatedAt: '2026-06-30T00:00:00Z' }),
    /precedes transition\.effectiveAt/,
  );
});

test('an unparseable effective time is refused', () => {
  assert.throws(
    () => gen.generateNotice(makeArgs({ transition: { effectiveAt: 'last Tuesday' } })),
    /not a parseable ISO 8601 timestamp/,
  );
  assert.throws(
    () => gen.generateNotice(makeArgs({ transition: { effectiveAt: null } })),
    /transition\.effectiveAt is required/,
  );
});

console.log('\nScope — a notice is only owed when offers are actually blocked');

test('a reactivation does not produce an inactivation notice', () => {
  assert.throws(
    () => gen.generateNotice(makeArgs({
      transition: {
        fromStatus: 'inactive', toStatus: 'active',
        offerEligibilityImpact: 'restores_offers',
      },
    })),
    /only owed for a transition with offerEligibilityImpact "blocks_offers"/,
  );
});

test('an eligibility-neutral change does not produce a notice', () => {
  for (const impact of ['none', 'unknown']) {
    assert.throws(
      () => gen.generateNotice(makeArgs({ transition: { offerEligibilityImpact: impact } })),
      /blocks_offers/,
    );
  }
});

console.log('\nSecondary recipient — routed per § 512.442(d)');

test('an ESRD patient routes the copy to the dialysis facility', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.strictEqual(notice.secondaryRecipientType, 'dialysis_facility');
  assert.strictEqual(notice.secondaryRecipientName, 'Riverside Dialysis Center');
});

test('a non-ESRD patient routes the copy to the referring provider', () => {
  const notice = gen.generateNotice(makeArgs({
    patient: { isEsrd: false, referringProviderName: 'Dr. R. Nephrology' },
  }));
  assert.strictEqual(notice.secondaryRecipientType, 'referring_provider');
  assert.strictEqual(notice.secondaryRecipientName, 'Dr. R. Nephrology');
});

test('unknown ESRD status is refused rather than guessed', () => {
  for (const value of [undefined, null, 'yes', 1]) {
    assert.throws(
      () => gen.generateNotice(makeArgs({ patient: { isEsrd: value } })),
      /patient\.isEsrd must be true or false/,
    );
  }
});

console.log('\nDeterminism and content identity');

test('identical input produces identical bytes and hash', () => {
  const a = gen.generateNotice(makeArgs());
  const b = gen.generateNotice(makeArgs());
  assert.strictEqual(a.content, b.content);
  assert.strictEqual(a.contentSha256, b.contentSha256);
});

test('the hash is the SHA-256 of the rendered content', () => {
  const notice = gen.generateNotice(makeArgs());
  const expected = createHash('sha256').update(notice.content, 'utf8').digest('hex');
  assert.strictEqual(notice.contentSha256, expected);
  assert.match(notice.contentSha256, /^[0-9a-f]{64}$/);
});

test('a changed reason changes the hash', () => {
  const a = gen.generateNotice(makeArgs());
  const b = gen.generateNotice(makeArgs({ transition: { reasonCode: 'LABS_EXPIRED' } }));
  assert.notStrictEqual(a.contentSha256, b.contentSha256);
});

test('the idempotency key identifies the obligation, not the rendering', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.strictEqual(notice.idempotencyKey, `${TRANSITION.id}:status_change:r0`);
  assert.strictEqual(notice.revision, 0);
});

test('a retry on a later day reuses the key, so no second copy can be filed', () => {
  // The regression this guards: generatedAt renders into the letterhead date, so
  // a retry hashes differently. If the key were content-derived, the UNIQUE
  // constraint would not catch the duplicate and the patient's chart would
  // receive the same notice twice.
  const first = gen.generateNotice(makeArgs(), { generatedAt: '2026-07-02T09:00:00Z' });
  const retry = gen.generateNotice(makeArgs(), { generatedAt: '2026-07-03T09:00:00Z' });
  assert.notStrictEqual(retry.contentSha256, first.contentSha256, 'content does differ');
  assert.strictEqual(retry.idempotencyKey, first.idempotencyKey, 'but the key must not');
});

test('superseding a filed notice requires an explicit revision bump', () => {
  const original = gen.generateNotice(makeArgs());
  const reissue = gen.generateNotice(makeArgs(), { revision: 1 });
  assert.strictEqual(reissue.idempotencyKey, `${TRANSITION.id}:status_change:r1`);
  assert.notStrictEqual(reissue.idempotencyKey, original.idempotencyKey);
});

test('an invalid revision is refused', () => {
  for (const bad of [-1, 1.5, '1', null]) {
    assert.throws(
      () => gen.generateNotice(makeArgs(), { revision: bad }),
      /options\.revision must be a non-negative integer/,
    );
  }
});

test('a status change and its annual reminder have distinct keys', () => {
  const change = gen.generateNotice(makeArgs());
  const annual = gen.generateNotice(makeArgs(), { noticeKind: 'annual_inactive' });
  assert.notStrictEqual(annual.idempotencyKey, change.idempotencyKey);
});

test('the generator stamps its version for reproducibility', () => {
  const notice = gen.generateNotice(makeArgs());
  assert.strictEqual(notice.generatorVersion, gen.GENERATOR_VERSION);
  assert.match(notice.generatorVersion, /^\d+\.\d+\.\d+$/);
});

console.log('\nAnnual reminder and HTML rendering');

test('an annual reminder is a distinct notice kind', () => {
  const notice = gen.generateNotice(makeArgs(), { noticeKind: 'annual_inactive' });
  assert.strictEqual(notice.noticeKind, 'annual_inactive');
  assert.ok(notice.idempotencyKey.includes(':annual_inactive:'));
  assert.strictEqual(notice.nextAnnualDueAt, '2027-07-01T14:30:00Z');
});

test('an unsupported notice kind is refused', () => {
  assert.throws(
    () => gen.generateNotice(makeArgs(), { noticeKind: 'whenever' }),
    /unsupported noticeKind/,
  );
});

test('HTML rendering escapes patient data so it cannot inject markup', () => {
  const notice = gen.generateNotice(
    makeArgs({ patient: { lastName: 'Lopez <script>alert(1)</script>' } }),
    { contentFormat: 'html' },
  );
  assert.ok(!notice.content.includes('<script>'), 'markup must be escaped');
  assert.ok(notice.content.includes('&lt;script&gt;'));
  assert.strictEqual(notice.contentFormat, 'html');
});

test('text rendering leaves content unescaped', () => {
  const notice = gen.generateNotice(makeArgs({ center: { name: 'Example & Partners' } }));
  assert.ok(notice.content.includes('Example & Partners'));
});

test('an unsupported content format is refused', () => {
  assert.throws(
    () => gen.generateNotice(makeArgs(), { contentFormat: 'pdf' }),
    /unsupported contentFormat/,
  );
});

console.log('\nPurity');

test('the generator does not mutate its arguments', () => {
  const args = makeArgs();
  const snapshot = JSON.stringify(args);
  gen.generateNotice(args);
  assert.strictEqual(JSON.stringify(args), snapshot);
});

test('the generator needs no clock when generatedAt is omitted', () => {
  const realNow = Date.now;
  Date.now = () => { throw new Error('generateNotice must not read the clock'); };
  try {
    const notice = gen.generateNotice(makeArgs());
    assert.strictEqual(notice.generatedAt, notice.effectiveAt);
  } finally {
    Date.now = realNow;
  }
});

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.stack}\n`);
  process.exit(1);
}
