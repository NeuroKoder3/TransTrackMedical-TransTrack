#!/usr/bin/env node
/**
 * TransTrack — consistency gate for the validation package.
 *
 * The validation package is only useful if its cross-references hold. A
 * duplicate requirement ID, a matrix row pointing at a requirement that was
 * renamed, or a Mandatory requirement with no OQ case are all defects an
 * auditor will find, and all of them are mechanically detectable. This script
 * checks what the documents claim about themselves:
 *
 *   1. Requirement IDs in the SRS are unique.
 *   2. Every requirement in the SRS appears in the traceability matrix, and
 *      every matrix row refers to a requirement that exists.
 *   3. Every Mandatory requirement traces to at least one verification
 *      artifact, and every OQ id cited by the matrix exists in the protocol.
 *   4. Every SDS section referenced by the matrix exists.
 *   5. Every risk cited in the matrix's risk linkage exists in the register.
 *
 * Run: node scripts/check-compliance-docs.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs', 'compliance');

const read = (p) => readFileSync(join(DOCS, p), 'utf8');

const srs = read('SYSTEM_REQUIREMENTS_SPECIFICATION.md');
const matrix = read('TRACEABILITY_MATRIX.md');
const sds = read('SOFTWARE_DESIGN_SPECIFICATION.md');
const risks = read('RISK_REGISTER.md');
const oq = read(join('templates', 'OQ_PROTOCOL_TEMPLATE.md'));

const problems = [];
const fail = (msg) => problems.push(msg);

/** Rows of a markdown table, as arrays of trimmed cells. */
function tableRows(text) {
  return text
    .split('\n')
    .filter((l) => l.trimStart().startsWith('|'))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c) || c === ''));
}

// ---------------------------------------------------------------- 1. SRS IDs

const srsReqs = new Map(); // id -> priority
for (const cells of tableRows(srs)) {
  const m = /^TT-R(\d+)$/.exec(cells[0]);
  if (!m) continue;
  const id = cells[0];
  if (srsReqs.has(id)) {
    fail(`SRS: duplicate requirement id ${id}. Requirement ids must be unique — a duplicate breaks every downstream trace.`);
  }
  srsReqs.set(id, cells[1]);
}

if (srsReqs.size === 0) fail('SRS: parsed no requirements. The table format probably changed.');

// --------------------------------------------------------- 2 & 3. The matrix

const matrixRows = new Map(); // id -> { design, impl, verification }
let inRiskLinkage = false;
const riskLinks = [];

for (const line of matrix.split('\n')) {
  if (/^##\s+Risk linkage/i.test(line)) { inRiskLinkage = true; continue; }
  if (/^##\s/.test(line) && inRiskLinkage) inRiskLinkage = false;
  if (!line.trimStart().startsWith('|')) continue;

  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  if (cells.every((c) => /^:?-+:?$/.test(c) || c === '')) continue;

  if (inRiskLinkage) {
    const rm = /^(R-\d+)/.exec(cells[0]);
    if (rm) riskLinks.push({ risk: rm[1], reqs: (cells[1] || '').match(/TT-R\d+/g) || [] });
    continue;
  }

  const m = /^TT-R\d+$/.exec(cells[0]);
  if (!m) continue;
  if (matrixRows.has(cells[0])) {
    fail(`Traceability matrix: duplicate row for ${cells[0]}.`);
  }
  matrixRows.set(cells[0], { design: cells[1] || '', impl: cells[2] || '', verification: cells[3] || '' });
}

for (const [id, pri] of srsReqs) {
  if (!matrixRows.has(id)) {
    fail(`Traceability matrix: ${id} (priority ${pri}) is specified in the SRS but has no matrix row.`);
  }
}
for (const id of matrixRows.keys()) {
  if (!srsReqs.has(id)) {
    fail(`Traceability matrix: row ${id} refers to a requirement that does not exist in the SRS.`);
  }
}

// Mandatory requirements need a verification artifact.
for (const [id, pri] of srsReqs) {
  if (pri !== 'M') continue;
  const row = matrixRows.get(id);
  if (!row) continue;
  if (row.verification === '') {
    fail(`Traceability matrix: ${id} is Mandatory but names no verification artifact.`);
  }
}

// ------------------------------------------------------------ 3b. OQ ids

const oqIds = new Set();
for (const cells of tableRows(oq)) {
  const m = /^(OQ-\d+)$/.exec(cells[0]);
  if (m) {
    if (oqIds.has(m[1])) fail(`OQ protocol: duplicate test case id ${m[1]}.`);
    oqIds.add(m[1]);
  }
}

for (const [id, row] of matrixRows) {
  for (const cited of row.verification.match(/OQ-\d+/g) || []) {
    if (!oqIds.has(cited)) {
      fail(`Traceability matrix: ${id} cites ${cited}, which does not exist in the OQ protocol template.`);
    }
  }
}

// ------------------------------------------------------------ 4. SDS sections

const sdsSections = new Set();
for (const m of sds.matchAll(/^##+\s+(\d+)(?:\.\d+)?\.\s/gm)) sdsSections.add(m[1]);

for (const [id, row] of matrixRows) {
  for (const cited of row.design.match(/§(\d+)/g) || []) {
    const n = cited.slice(1);
    if (!sdsSections.has(n)) {
      fail(`Traceability matrix: ${id} points at SDS §${n}, which does not exist.`);
    }
  }
}

// ------------------------------------------------------------ 5. Risk linkage

const riskIds = new Set();
for (const cells of tableRows(risks)) {
  const m = /^(R-\d+)$/.exec(cells[0]);
  if (m) {
    if (riskIds.has(m[1])) fail(`Risk register: duplicate risk id ${m[1]}.`);
    riskIds.add(m[1]);
  }
}

for (const { risk, reqs } of riskLinks) {
  if (!riskIds.has(risk)) {
    fail(`Traceability matrix: risk linkage cites ${risk}, which is not in the risk register.`);
  }
  if (reqs.length === 0) {
    fail(`Traceability matrix: risk linkage for ${risk} names no controlling requirement.`);
  }
  for (const r of reqs) {
    if (!srsReqs.has(r)) {
      fail(`Traceability matrix: risk linkage for ${risk} cites ${r}, which does not exist in the SRS.`);
    }
  }
}

// ---------------------------------------------------------------- Report

if (problems.length > 0) {
  console.error('Validation package consistency: FAIL\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log('Validation package consistency: PASS');
console.log(`  ${srsReqs.size} requirements, ${matrixRows.size} matrix rows, ${oqIds.size} OQ cases, ${riskIds.size} risks.`);
