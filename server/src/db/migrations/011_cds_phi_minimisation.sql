-- =============================================================================
-- 011_cds_phi_minimisation.sql
-- H-12 / L-15 — CDS Hooks audit trail.
--
-- cds_service_invocations.request_body and .response_body stored the complete
-- CDS Hooks request and response. A CDS Hooks request carries the patient
-- context plus every prefetched FHIR resource the EHR resolved on our behalf,
-- so the audit trail had quietly become a second, unredacted copy of the
-- clinical record with none of the retention or minimisation rules that apply
-- to the primary store.
--
-- The route now writes a structured, PHI-free summary instead. The raw
-- columns stay for deployments that deliberately opt in to full capture for
-- interface debugging; those rows are flagged and given a hard expiry so the
-- retention expectation is recorded on the row rather than in a runbook.
-- =============================================================================

ALTER TABLE cds_service_invocations
    ADD COLUMN IF NOT EXISTS request_summary  JSONB,
    ADD COLUMN IF NOT EXISTS response_summary JSONB,
    ADD COLUMN IF NOT EXISTS raw_payload_captured BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS raw_payload_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN cds_service_invocations.request_body IS
    'Raw CDS Hooks request. NULL unless CDS_CAPTURE_RAW_PAYLOADS is enabled. '
    'Contains PHI (patient context + prefetched FHIR resources); purge on or '
    'before raw_payload_expires_at.';
COMMENT ON COLUMN cds_service_invocations.response_body IS
    'Raw CDS Hooks response. NULL unless CDS_CAPTURE_RAW_PAYLOADS is enabled. '
    'Card detail text may quote patient data; purge on or before '
    'raw_payload_expires_at.';
COMMENT ON COLUMN cds_service_invocations.request_summary IS
    'PHI-free description of the request: hook, resource reference types and '
    'prefetch counts.';

CREATE INDEX IF NOT EXISTS idx_cds_raw_payload_expiry
    ON cds_service_invocations (raw_payload_expires_at)
    WHERE raw_payload_captured;

-- Historical rows predate the flag and were all captured in full.
UPDATE cds_service_invocations
   SET raw_payload_captured = TRUE
 WHERE request_body IS NOT NULL OR response_body IS NOT NULL;

-- ---------------------------------------------------------------------------
-- cds_service_feedback (L-15)
-- POST /cds-services/:id/feedback answered { acknowledged: true } and threw
-- the feedback away, so every EHR that used it believed we were recording
-- outcomes we never stored. Persist it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cds_service_feedback (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    service_id      TEXT NOT NULL,
    card_uuid       TEXT NOT NULL,
    outcome         TEXT NOT NULL CHECK (outcome IN ('accepted','overridden')),
    outcome_timestamp TIMESTAMPTZ,
    accepted_suggestion_id TEXT,
    override_reason_code   TEXT,
    override_reason_system TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cds_feedback_org
    ON cds_service_feedback(org_id, service_id, created_at DESC);

ALTER TABLE cds_service_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE cds_service_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cds_service_feedback ON cds_service_feedback
    USING (org_id = app_current_org_id())
    WITH CHECK (org_id = app_current_org_id());

-- =============================================================================
-- 011_cds_phi_minimisation.sql complete
-- =============================================================================
