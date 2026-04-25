'use strict';

function searchset({ baseUrl, type, rows }) {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: rows.length,
    link: [{ relation: 'self', url: `${baseUrl}/${type}` }],
    entry: rows.map((row) => ({
      fullUrl: `${baseUrl}/${type}/${row.body.id}`,
      resource: row.body,
      search: { mode: 'match' },
    })),
  };
}

function operationOutcome({ severity = 'error', code = 'processing', diagnostics }) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity, code, diagnostics }],
  };
}

module.exports = { searchset, operationOutcome };
