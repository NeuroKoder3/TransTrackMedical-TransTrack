/**
 * TransTrack — filing an IOTA notice into the patient's chart.
 *
 * CMS IOTA Model § 512.442(d) requires a copy of the waitlist status notice to
 * be recorded in the patient's medical record. This module turns a notice into
 * a FHIR R4 DocumentReference and decides how far that filing is allowed to
 * go.
 *
 * THREE MODES, AND WHY:
 *
 *   dry_run — build and validate the resource, show it, send nothing. This is
 *     the default and the only mode available before a site's Epic team has
 *     enabled DocumentReference.Create. It exists because "we will be ready
 *     when you enable it" is a claim that has to be demonstrable *before*
 *     enablement, not after.
 *
 *   manual — the coordinator filed the notice by another route (printed into
 *     the chart, or via the site's own interface engine). Recorded so the
 *     obligation shows as discharged with an honest channel, rather than
 *     forcing a site without write access to leave every notice looking unmet.
 *
 *   fhir_documentreference — an actual create against Epic. Requires an
 *     injected transport; this module never opens a socket itself.
 *
 * WHY THE TRANSPORT IS INJECTED: TransTrack is an offline-first desktop
 * application. Reaching an external endpoint is a deployment decision made per
 * site, not a property of the software, and a module that could quietly
 * acquire network access is exactly what a security reviewer must be able to
 * rule out by reading it. `submit` is supplied by the caller or filing is
 * refused.
 */

'use strict';

const { createHash } = require('crypto');

/** LOINC 74213-0 "Transplant summary note" is the closest standard code, but
 *  the operative coding is whatever the site's Epic team maps. Exported as a
 *  starting point for that conversation, never applied implicitly. */
const SUGGESTED_TYPE_CODING = {
  system: 'http://loinc.org',
  code: '74213-0',
  display: 'Transplant summary note',
};

const MODES = ['dry_run', 'manual', 'fhir_documentreference'];

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`chartFiling: ${field} is required`);
  }
  return value;
}

/**
 * Build the DocumentReference for a generated notice.
 *
 * Pure: same notice in, same resource out, with no clock and no I/O. The
 * caller supplies `epicPatientId` because the mapping between a TransTrack
 * patient and an Epic FHIR id is site-specific.
 *
 * @param {Object} notice   a row from iota_notifications (with `content`)
 * @param {Object} opts
 * @param {string} opts.epicPatientId
 * @param {Object} [opts.typeCoding]  site-negotiated document type
 * @param {string} [opts.title]
 * @returns {Object} a FHIR R4 DocumentReference
 */
function buildDocumentReference(notice, opts = {}) {
  if (!notice) throw new Error('chartFiling: notice is required');
  const epicPatientId = requireText(opts.epicPatientId, 'epicPatientId');
  const content = requireText(notice.content, 'notice.content');

  // The stored hash is frozen by database trigger. Refusing to file a body
  // that no longer matches it stops an altered document being written into a
  // chart under the authority of a record that says it was not altered.
  const actual = createHash('sha256').update(content, 'utf8').digest('hex');
  if (notice.content_sha256 && actual !== notice.content_sha256) {
    throw new Error(
      'chartFiling: refusing to file — the notice body does not match its recorded hash',
    );
  }

  const typeCoding = opts.typeCoding || SUGGESTED_TYPE_CODING;

  return {
    resourceType: 'DocumentReference',
    status: 'current',
    docStatus: 'final',
    type: { coding: [typeCoding] },
    subject: { reference: `Patient/${epicPatientId}` },
    date: notice.generated_at || undefined,
    description: opts.title
      || 'Kidney transplant waiting list status notification (CMS IOTA § 512.442(d))',
    // Carrying the idempotency key into the chart record lets a site
    // reconcile what TransTrack believes it filed against what Epic holds,
    // which is the only way to detect a duplicate after the fact.
    identifier: notice.idempotency_key
      ? [{ system: 'urn:transtrack:iota-notification', value: notice.idempotency_key }]
      : undefined,
    content: [
      {
        attachment: {
          contentType: notice.content_format === 'html' ? 'text/html' : 'text/plain',
          data: Buffer.from(content, 'utf8').toString('base64'),
          title: opts.title || 'Waiting list status notification',
          hash: Buffer.from(actual, 'hex').toString('base64'),
        },
      },
    ],
  };
}

/**
 * Structural check before anything is sent. Epic rejects a malformed
 * DocumentReference with an OperationOutcome that is hard to act on, so the
 * predictable failures are caught locally where the message can be specific.
 */
function validateDocumentReference(resource) {
  const problems = [];
  if (!resource || resource.resourceType !== 'DocumentReference') {
    return { ok: false, problems: ['not a DocumentReference resource'] };
  }
  if (!resource.subject?.reference?.startsWith('Patient/')) {
    problems.push('subject must reference a Patient');
  }
  if (!resource.type?.coding?.[0]?.code) {
    problems.push('a document type coding is required (negotiate this with the site)');
  }
  const attachment = resource.content?.[0]?.attachment;
  if (!attachment?.data) problems.push('content.attachment.data is empty');
  if (!attachment?.contentType) problems.push('content.attachment.contentType is missing');
  if (resource.status !== 'current') problems.push("status must be 'current'");
  return { ok: problems.length === 0, problems };
}

/**
 * Prepare a filing without performing it.
 *
 * @returns {{ mode, resource, validation, wouldSendTo, previewBytes }}
 */
function prepareFiling(notice, opts = {}) {
  const resource = buildDocumentReference(notice, opts);
  const validation = validateDocumentReference(resource);
  return {
    mode: 'dry_run',
    resource,
    validation,
    wouldSendTo: opts.fhirBase ? `${String(opts.fhirBase).replace(/\/+$/, '')}/DocumentReference` : null,
    previewBytes: JSON.stringify(resource).length,
  };
}

/**
 * Execute a filing in the requested mode.
 *
 * Returns the fields the caller should persist onto iota_notifications; it
 * performs no database work of its own so the outcome can be recorded inside
 * the caller's transaction.
 *
 * @param {Object} notice
 * @param {Object} opts
 * @param {'dry_run'|'manual'|'fhir_documentreference'} opts.mode
 * @param {Function} [opts.submit]  async (resource) => { id, location, status }
 */
async function fileNotice(notice, opts = {}) {
  const mode = opts.mode || 'dry_run';
  if (!MODES.includes(mode)) {
    throw new Error(`chartFiling: unknown mode '${mode}'`);
  }

  if (mode === 'manual') {
    return {
      chart_write_status: 'filed',
      chart_write_channel: 'manual',
      chart_write_attempted_at: new Date().toISOString(),
      chart_write_error: null,
      epic_document_reference_id: null,
    };
  }

  const prepared = prepareFiling(notice, opts);
  if (!prepared.validation.ok) {
    return {
      chart_write_status: 'failed',
      chart_write_channel: mode === 'dry_run' ? null : 'fhir_documentreference',
      chart_write_attempted_at: new Date().toISOString(),
      chart_write_error: `Document rejected before sending: ${prepared.validation.problems.join('; ')}`,
      epic_document_reference_id: null,
      prepared,
    };
  }

  if (mode === 'dry_run') {
    return {
      chart_write_status: 'dry_run',
      chart_write_channel: null,
      chart_write_attempted_at: new Date().toISOString(),
      chart_write_error: null,
      epic_document_reference_id: null,
      prepared,
    };
  }

  if (typeof opts.submit !== 'function') {
    throw new Error(
      'chartFiling: live filing requires a submit transport. Epic DocumentReference.Create '
      + 'must be enabled for this organisation before notices can be filed automatically.',
    );
  }

  try {
    const result = await opts.submit(prepared.resource);
    return {
      chart_write_status: 'filed',
      chart_write_channel: 'fhir_documentreference',
      chart_write_attempted_at: new Date().toISOString(),
      chart_write_error: null,
      epic_document_reference_id: result?.id || null,
      prepared,
    };
  } catch (err) {
    // A failed create is recorded, not thrown away: the obligation is still
    // outstanding and the operator needs to see why the attempt failed.
    return {
      chart_write_status: 'failed',
      chart_write_channel: 'fhir_documentreference',
      chart_write_attempted_at: new Date().toISOString(),
      chart_write_error: String(err?.message || err).slice(0, 500),
      epic_document_reference_id: null,
      prepared,
    };
  }
}

module.exports = {
  MODES,
  SUGGESTED_TYPE_CODING,
  buildDocumentReference,
  validateDocumentReference,
  prepareFiling,
  fileNotice,
};
