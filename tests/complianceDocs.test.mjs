/**
 * TransTrack — validation package consistency.
 *
 * The SRS, SDS, traceability matrix, OQ protocol and risk register only have
 * value as a set. A requirement id used twice, a matrix row pointing at a
 * requirement that was renumbered, or an OQ case cited but never written are
 * exactly the defects an auditor finds first, and they appear silently: the
 * documents still render, and nothing in the build notices.
 *
 * That happened here. Six chart-filing requirements were numbered TT-R137–R142,
 * colliding with the pre-existing cross-cutting TT-R140–R142, and the collision
 * survived review of both documents because neither is wrong when read alone.
 *
 * This suite runs `scripts/check-compliance-docs.mjs`, which resolves every
 * cross-reference between the documents. Keeping it in the normal test group
 * means the validation package is checked on the same cadence as the code it
 * describes.
 *
 * Run standalone: node tests/complianceDocs.test.mjs
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const checker = join(repoRoot, 'scripts', 'check-compliance-docs.mjs');

let PASS = 0, FAIL = 0;
const failures = [];
function test(name, fn) {
  try { fn(); PASS++; console.log(`  ok  ${name}`); }
  catch (e) { FAIL++; failures.push({ name, error: e }); console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('\nValidation package consistency');

// No `shell: true`: process.execPath contains spaces on a default Windows
// install, and the shell splits it into a bogus command.
const run = spawnSync(process.execPath, [checker], { cwd: repoRoot, encoding: 'utf8' });

test('the consistency checker runs', () => {
  assert.strictEqual(run.error, undefined, `could not spawn the checker: ${run.error?.message}`);
});

test('every cross-reference in the validation package resolves', () => {
  assert.strictEqual(
    run.status,
    0,
    `the validation package is inconsistent:\n${run.stderr || run.stdout}`,
  );
});

test('the checker reports what it inspected', () => {
  assert.match(
    run.stdout,
    /\d+ requirements, \d+ matrix rows, \d+ OQ cases, \d+ risks/,
    'the checker should report its counts so a silently empty parse is visible',
  );
});

test('the checker is not silently parsing nothing', () => {
  const m = /(\d+) requirements, (\d+) matrix rows, (\d+) OQ cases, (\d+) risks/.exec(run.stdout);
  assert.ok(m, 'counts not found');
  const [, reqs, rows, oq, risks] = m.map(Number);
  // A format change that broke parsing would report zero and pass every other
  // check vacuously.
  assert.ok(reqs > 50, `expected the SRS to yield >50 requirements, got ${reqs}`);
  assert.strictEqual(rows, reqs, 'every requirement must have exactly one matrix row');
  assert.ok(oq > 50, `expected >50 OQ cases, got ${oq}`);
  assert.ok(risks > 20, `expected >20 risks, got ${risks}`);
});

console.log(`\n${PASS} passed, ${FAIL} failed\n`);
if (FAIL > 0) {
  for (const f of failures) console.error(`${f.name}\n${f.error.message}\n`);
  process.exit(1);
}
