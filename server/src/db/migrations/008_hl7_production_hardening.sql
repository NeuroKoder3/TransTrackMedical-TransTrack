-- =============================================================================
-- 008_hl7_production_hardening.sql
-- Production hardening for HL7 ingest:
--   - Unique constraint on (org_id, message_control_id) for deduplication
--   - hl7_sending_apps table for sending_app → org mapping
--   - hl7_dead_letters table for failed ingest replay
--   - next_attempt_at column on fhir_subscription_deliveries for backoff
-- =============================================================================

-- ---------------------------------------------------------------------------
-- HL7 message deduplication: unique constraint on (org_id, message_control_id)
-- Only for inbound messages with a non-null control ID.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_hl7_messages_dedupe
    ON hl7_messages (org_id, message_control_id)
    WHERE direction = 'inbound' AND message_control_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- hl7_sending_apps: maps MSH-3 sending application to an org_id.
-- Used by the MLLP listener to route inbound messages to the correct tenant.
-- ---------------------------------------------------------------------------
CREATE TABLE hl7_sending_apps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sending_app     TEXT NOT NULL,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sending_app)
);
CREATE INDEX idx_hl7_sending_apps_active ON hl7_sending_apps(sending_app, is_active);

CREATE TRIGGER hl7_sending_apps_updated BEFORE UPDATE ON hl7_sending_apps
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- hl7_dead_letters: messages that failed ingest and need admin review/replay.
-- ---------------------------------------------------------------------------
CREATE TABLE hl7_dead_letters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
    raw_message     TEXT NOT NULL,
    sending_app     TEXT,
    sending_facility TEXT,
    message_type    TEXT,
    trigger_event   TEXT,
    message_control_id TEXT,
    error_reason    TEXT NOT NULL,
    error_details   TEXT,
    peer_address    TEXT,
    transport       TEXT NOT NULL DEFAULT 'mllp',
    replay_status   TEXT NOT NULL DEFAULT 'pending'
                    CHECK (replay_status IN ('pending','replayed','discarded')),
    replayed_at     TIMESTAMPTZ,
    replayed_message_id UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hl7_dead_letters_status ON hl7_dead_letters(replay_status, created_at DESC);
CREATE INDEX idx_hl7_dead_letters_org ON hl7_dead_letters(org_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- FHIR subscription deliveries: add next_attempt_at for exponential backoff
-- and in_progress status value
-- ---------------------------------------------------------------------------
ALTER TABLE fhir_subscription_deliveries
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- Allow in_progress status for claimed jobs
ALTER TABLE fhir_subscription_deliveries
    DROP CONSTRAINT IF EXISTS fhir_subscription_deliveries_status_check;
ALTER TABLE fhir_subscription_deliveries
    ADD CONSTRAINT fhir_subscription_deliveries_status_check
    CHECK (status IN ('pending','in_progress','delivered','failed','retrying'));

-- =============================================================================
-- 008_hl7_production_hardening.sql complete
-- =============================================================================
