-- =============================================================================
-- 012_smart_launch_and_replay.sql
-- M-11 — server-side SMART launch context.
-- L-14 — replay cache for SMART Backend Services client assertions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- smart_launch_contexts (M-11)
--
-- The consent form used to carry launch_patient as a hidden field and
-- /oauth2/authorize trusted whatever came back in the POST body, so anyone
-- who could reach the consent endpoint could name an arbitrary patient and
-- receive an authorization code whose launch context pointed at them.
--
-- The launch context is now resolved once, server-side, at GET /authorize and
-- stored here. The form carries only an opaque handle; the POST looks the
-- context up by handle and ignores any patient named by the client.
--
-- Rows are short-lived (the length of a consent interaction), single-use, and
-- bound to the client that started the launch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smart_launch_contexts (
    handle_hash     TEXT PRIMARY KEY,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_id       TEXT NOT NULL,
    context         JSONB NOT NULL DEFAULT '{}'::jsonb,
    consumed_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smart_launch_contexts_expires
    ON smart_launch_contexts (expires_at);

-- ---------------------------------------------------------------------------
-- smart_client_assertion_jtis (L-14)
--
-- verifyAssertion required a jti but kept no record of the ones it had seen,
-- so a captured client assertion could be replayed until its exp — the jti
-- requirement bought nothing. Each accepted (client_id, jti) is recorded and
-- rejected on second use; rows are dropped once the assertion they cover
-- could no longer be valid anyway.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smart_client_assertion_jtis (
    client_id   TEXT NOT NULL,
    jti         TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, jti)
);
CREATE INDEX IF NOT EXISTS idx_smart_assertion_jtis_expires
    ON smart_client_assertion_jtis (expires_at);

-- =============================================================================
-- 012_smart_launch_and_replay.sql complete
-- =============================================================================
