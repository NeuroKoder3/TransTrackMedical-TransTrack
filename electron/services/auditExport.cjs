/**
 * TransTrack - Audit Trail Inspection Export
 *
 * 21 CFR 11.10(b) requires the ability to generate "accurate and complete
 * copies of records in both human readable and electronic form suitable for
 * inspection, review, and copying by the agency". HIPAA 164.308(a)(1)(ii)(D)
 * requires reviewing information system activity.
 *
 * The existing compliance:generate-audit-report handler returns JSON, which is
 * the electronic form. This module adds the human-readable forms — CSV for
 * spreadsheet review and a self-contained HTML document for reading, printing,
 * or handing to an inspector — plus a chain-verification statement so a
 * reviewer can see that the exported rows were integrity-checked.
 *
 * PHI HANDLING: an audit trail legitimately contains patient identifiers, so
 * these exports are PHI. They are only produced for admin/regulator roles, the
 * act of exporting is itself audited, and the caller is responsible for writing
 * the result to an access-controlled location. Set includePatientName=false to
 * produce a de-identified copy for operational review.
 */

'use strict';

const REPORT_TITLE = 'TransTrack Audit Trail — Inspection Copy';

/**
 * Columns included in the human-readable exports, in display order.
 * `phi: true` marks a column that is suppressed when includePatientName=false.
 */
const EXPORT_COLUMNS = [
  { key: 'created_at', label: 'Timestamp (UTC)' },
  { key: 'user_email', label: 'User' },
  { key: 'user_role', label: 'Role' },
  { key: 'action', label: 'Action' },
  { key: 'entity_type', label: 'Record Type' },
  { key: 'entity_id', label: 'Record ID' },
  { key: 'patient_name', label: 'Patient', phi: true },
  { key: 'outcome', label: 'Outcome' },
  { key: 'access_justification', label: 'Justification' },
  { key: 'details', label: 'Before / After Detail' },
  { key: 'request_id', label: 'Request ID' },
  { key: 'record_hash', label: 'Record Hash' },
];

function activeColumns(includePatientName) {
  return EXPORT_COLUMNS.filter((c) => includePatientName || !c.phi);
}

/**
 * Escape one CSV field per RFC 4180.
 *
 * The leading apostrophe on values starting with = + - @ is a CSV-injection
 * guard: without it, a crafted audit value would be executed as a formula when
 * the inspection copy is opened in Excel or Sheets.
 */
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let str = typeof value === 'string' ? value : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/["\n\r,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function htmlEscape(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the "before / after" detail column.
 *
 * Update entries store {message, before, after} JSON. Part 11.10(e) requires
 * that audit records not obscure previously recorded information, so the change
 * is spelled out field by field rather than shown as raw JSON.
 */
function formatDetails(details) {
  if (!details) return '';
  let parsed;
  try {
    parsed = JSON.parse(details);
  } catch {
    return String(details);
  }
  if (!parsed || typeof parsed !== 'object') return String(details);

  const { message, before, after } = parsed;
  if (!before && !after) {
    return message ? String(message) : String(details);
  }

  const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = [];
  for (const field of fields) {
    const from = before ? before[field] : undefined;
    const to = after ? after[field] : undefined;
    changes.push(`${field}: "${from === undefined || from === null ? '' : from}" -> "${to === undefined || to === null ? '' : to}"`);
  }

  return [message, ...changes].filter(Boolean).join('; ');
}

/**
 * Build the CSV (human-readable, spreadsheet-friendly) form.
 *
 * @param {object} report the object returned by compliance:generate-audit-report
 * @param {{includePatientName?: boolean}} [options]
 * @returns {string}
 */
function toCsv(report, options = {}) {
  const includePatientName = options.includePatientName !== false;
  const cols = activeColumns(includePatientName);
  const entries = Array.isArray(report?.entries) ? report.entries : [];

  const lines = [cols.map((c) => csvEscape(c.label)).join(',')];
  for (const entry of entries) {
    lines.push(
      cols
        .map((c) => csvEscape(c.key === 'details' ? formatDetails(entry.details) : entry[c.key]))
        .join(',')
    );
  }
  // Trailing newline so the file ends cleanly for line-based tooling.
  return `${lines.join('\r\n')}\r\n`;
}

function renderSummaryRows(summary) {
  if (!summary || typeof summary !== 'object') return '';
  const sections = [
    ['Actions', summary.by_action],
    ['Record types', summary.by_entity_type],
    ['Users', summary.by_user],
    ['Outcomes', summary.by_outcome],
  ];

  return sections
    .filter(([, group]) => group && Object.keys(group).length > 0)
    .map(([label, group]) => {
      const items = Object.entries(group)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `<li>${htmlEscape(name)}: <strong>${htmlEscape(count)}</strong></li>`)
        .join('');
      return `<div class="summary-block"><h3>${htmlEscape(label)}</h3><ul>${items}</ul></div>`;
    })
    .join('');
}

/**
 * Build a self-contained HTML document — no external assets, so it stays
 * readable from an air-gapped review machine or an archive.
 *
 * @param {object} report the object returned by compliance:generate-audit-report
 * @param {{includePatientName?: boolean, chainVerification?: object}} [options]
 * @returns {string}
 */
function toHtml(report, options = {}) {
  const includePatientName = options.includePatientName !== false;
  const cols = activeColumns(includePatientName);
  const entries = Array.isArray(report?.entries) ? report.entries : [];
  const chain = options.chainVerification;

  const headerCells = cols.map((c) => `<th>${htmlEscape(c.label)}</th>`).join('');
  const bodyRows = entries
    .map((entry) => {
      const cells = cols
        .map((c) => {
          const raw = c.key === 'details' ? formatDetails(entry.details) : entry[c.key];
          const cls = c.key === 'record_hash' ? ' class="hash"' : '';
          return `<td${cls}>${htmlEscape(raw)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('\n');

  let chainBanner = '';
  if (chain) {
    if (chain.ok) {
      chainBanner = `<p class="chain ok">Integrity verified: the audit hash chain for this organization is intact
        (${htmlEscape(chain.verified)} records replayed${chain.hmac?.checked ? `, ${htmlEscape(chain.hmac.checked)} additionally HMAC-verified` : ''}).</p>`;
    } else {
      chainBanner = `<p class="chain broken">INTEGRITY WARNING: audit chain verification failed at record
        ${htmlEscape(chain.brokenAt)} (${htmlEscape(chain.failure || 'unknown')}). This export must not be
        relied upon until investigated.</p>`;
    }
  }

  const phiNotice = includePatientName
    ? '<p class="notice">This document contains Protected Health Information. Handle under your organization&#39;s PHI controls.</p>'
    : '<p class="notice">Patient identifiers have been withheld from this copy.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>${htmlEscape(REPORT_TITLE)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 32px; color: #14181f; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 28px; }
  h3 { font-size: 13px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #4a5261; }
  .meta { color: #4a5261; font-size: 13px; line-height: 1.6; }
  .meta dt { font-weight: 600; float: left; width: 160px; clear: left; }
  .meta dd { margin: 0 0 4px 170px; }
  .notice { background: #fff8e1; border-left: 4px solid #f0b429; padding: 10px 14px; font-size: 13px; }
  .chain { padding: 10px 14px; font-size: 13px; border-left: 4px solid; }
  .chain.ok { background: #edf9f0; border-color: #2f9e5f; }
  .chain.broken { background: #fdecea; border-color: #c62828; font-weight: 600; }
  .summary { display: flex; flex-wrap: wrap; gap: 28px; }
  .summary-block ul { margin: 0; padding-left: 18px; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 12px; }
  th, td { border: 1px solid #d5d9e0; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f2f4f7; font-weight: 600; }
  tr:nth-child(even) td { background: #fafbfc; }
  td.hash { font-family: ui-monospace, Consolas, monospace; font-size: 10px; word-break: break-all; }
  footer { margin-top: 24px; font-size: 11px; color: #6b7280; }
</style>
</head>
<body>
<h1>${htmlEscape(REPORT_TITLE)}</h1>
<dl class="meta">
  <dt>Organization</dt><dd>${htmlEscape(report?.organization_name || report?.organization_id || 'Unknown')}</dd>
  <dt>Organization ID</dt><dd>${htmlEscape(report?.organization_id || '')}</dd>
  <dt>Period covered</dt><dd>${htmlEscape(report?.period?.start || '')} to ${htmlEscape(report?.period?.end || '')}</dd>
  <dt>Generated at</dt><dd>${htmlEscape(report?.generated_at || '')}</dd>
  <dt>Total records</dt><dd>${htmlEscape(report?.summary?.total_entries ?? entries.length)}</dd>
</dl>
${chainBanner}
${phiNotice}
<h2>Summary</h2>
<div class="summary">${renderSummaryRows(report?.summary)}</div>
<h2>Audit records (${htmlEscape(entries.length)})</h2>
<table>
<thead><tr>${headerCells}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
<footer>
  Audit records are append-only and protected by database triggers plus a SHA-256 hash chain.
  Timestamps are recorded in UTC by the application at the moment of the event.
</footer>
</body>
</html>
`;
}

/**
 * Produce every representation at once, for a single inspection package.
 *
 * @returns {{json: object, csv: string, html: string, filenameBase: string}}
 */
function buildInspectionPackage(report, options = {}) {
  const stamp = (report?.generated_at || new Date().toISOString()).replace(/[:.]/g, '-');
  return {
    json: report,
    csv: toCsv(report, options),
    html: toHtml(report, options),
    filenameBase: `transtrack-audit-${report?.organization_id || 'org'}-${stamp}`,
  };
}

module.exports = {
  toCsv,
  toHtml,
  buildInspectionPackage,
  formatDetails,
  csvEscape,
  htmlEscape,
  EXPORT_COLUMNS,
  REPORT_TITLE,
};
