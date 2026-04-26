-- =============================================================================
-- 005_ehr_integration.sql
-- Tables required for full EHR integration surface:
--   - smart_clients         : SMART on FHIR registered apps (per RFC 7591 dyn reg)
--   - smart_authz_codes     : short-lived SMART OAuth authorization codes + PKCE
--   - smart_access_tokens   : opaque SMART access/refresh tokens with launch ctx
--   - cds_service_invocations : audit trail of CDS Hooks service invocations
--   - bulk_export_jobs      : FHIR Bulk Data Access ($export) async jobs
--   - bulk_export_files     : NDJSON output files produced by an export job
--   - fhir_subscriptions    : FHIR R4 Subscriptions for push notifications
--   - fhir_subscription_deliveries : per-event delivery audit
--   - hl7_vendor_profiles   : per-org per-vendor HL7 quirks + Z-segment maps
-- =============================================================================

-- ---------------------------------------------------------------------------
-- smart_clients
-- A SMART on FHIR registered application. Confidential clients have a
-- client_secret; public clients (mobile/SPA) use PKCE only. Backend-services
-- clients use a JWK (asymmetric) per the SMART Backend Services spec.
-- ---------------------------------------------------------------------------
CREATE TABLE smart_clients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_id           TEXT NOT NULL,
    client_secret_hash  TEXT,
    client_type         TEXT NOT NULL DEFAULT 'public'
                        CHECK (client_type IN ('public','confidential','backend')),
    client_name         TEXT NOT NULL,
    redirect_uris       JSONB NOT NULL DEFAULT '[]'::jsonb,
    scope               TEXT NOT NULL DEFAULT '',
    launch_uri          TEXT,
    logo_uri            TEXT,
    contacts            JSONB,
    jwks_uri            TEXT,
    jwks                JSONB,
    grant_types         JSONB NOT NULL DEFAULT '["authorization_code","refresh_token"]'::jsonb,
    response_types      JSONB NOT NULL DEFAULT '["code"]'::jsonb,
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, client_id)
);
CREATE INDEX idx_smart_clients_org ON smart_clients(org_id);
CREATE INDEX idx_smart_clients_active ON smart_clients(org_id, is_active);

CREATE TRIGGER smart_clients_updated BEFORE UPDATE ON smart_clients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- smart_authz_codes
-- Short-lived (5 min) authorization codes from /authorize that the client
-- exchanges at /token. Includes PKCE challenge and SMART launch context.
-- ---------------------------------------------------------------------------
CREATE TABLE smart_authz_codes (
    code_hash           TEXT PRIMARY KEY,
    org_id              UUID NOT NULL,
    client_id           TEXT NOT NULL,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri        TEXT NOT NULL,
    scope               TEXT NOT NULL,
    code_challenge      TEXT,
    code_challenge_method TEXT,
    launch_context      JSONB,                              -- patient, encounter, etc.
    nonce               TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_smart_authz_user ON smart_authz_codes(user_id);
CREATE INDEX idx_smart_authz_expires ON smart_authz_codes(expires_at);

-- ---------------------------------------------------------------------------
-- smart_access_tokens
-- Opaque access + refresh tokens issued at /token. Stored hashed.
-- We do not use JWTs for SMART tokens because EHR clients expect opaque
-- bearer tokens that the resource server can introspect or look up.
-- ---------------------------------------------------------------------------
CREATE TABLE smart_access_tokens (
    access_token_hash   TEXT PRIMARY KEY,
    org_id              UUID NOT NULL,
    client_id           TEXT NOT NULL,
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,  -- null for backend-services
    scope               TEXT NOT NULL,
    launch_context      JSONB,
    refresh_token_hash  TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    refresh_expires_at  TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_smart_tokens_refresh ON smart_access_tokens(refresh_token_hash);
CREATE INDEX idx_smart_tokens_expires ON smart_access_tokens(expires_at);
CREATE INDEX idx_smart_tokens_user ON smart_access_tokens(user_id);

-- ---------------------------------------------------------------------------
-- cds_service_invocations
-- Audit trail for every CDS Hooks service call. Useful for debugging
-- production CDS interactions and for proving CDS Hooks coverage to ONC
-- certifiers.
-- ---------------------------------------------------------------------------
CREATE TABLE cds_service_invocations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    service_id          TEXT NOT NULL,
    hook                TEXT NOT NULL,
    hook_instance       TEXT,
    fhir_server          TEXT,
    user_reference      TEXT,
    patient_reference   TEXT,
    encounter_reference TEXT,
    request_body        JSONB,
    response_body       JSONB,
    cards_returned      INTEGER NOT NULL DEFAULT 0,
    duration_ms         INTEGER,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cds_org ON cds_service_invocations(org_id, created_at DESC);
CREATE INDEX idx_cds_service ON cds_service_invocations(org_id, service_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- bulk_export_jobs
-- One row per FHIR Bulk Data Access $export operation. Status transitions:
--   queued -> in-progress -> (completed | failed | cancelled)
-- ---------------------------------------------------------------------------
CREATE TABLE bulk_export_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    requested_by        UUID REFERENCES users(id),
    requested_via_client TEXT,                              -- SMART client_id
    export_type         TEXT NOT NULL CHECK (export_type IN ('system','patient','group')),
    group_id            TEXT,                               -- FHIR Group id when type=group
    types_requested     JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["Patient","Observation"]
    since               TIMESTAMPTZ,
    out_format          TEXT NOT NULL DEFAULT 'application/fhir+ndjson',
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','in-progress','completed','failed','cancelled')),
    progress_percent    INTEGER NOT NULL DEFAULT 0,
    error_message       TEXT,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ                         -- after this, files purged
);
CREATE INDEX idx_bulk_jobs_org ON bulk_export_jobs(org_id, requested_at DESC);
CREATE INDEX idx_bulk_jobs_status ON bulk_export_jobs(status, requested_at DESC);

-- ---------------------------------------------------------------------------
-- bulk_export_files
-- NDJSON output files. Stored in DB as bytea for portability; production
-- deployments swap this for object storage (S3/GCS/Azure Blob).
-- ---------------------------------------------------------------------------
CREATE TABLE bulk_export_files (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES bulk_export_jobs(id) ON DELETE CASCADE,
    resource_type       TEXT NOT NULL,
    file_index          INTEGER NOT NULL DEFAULT 0,
    resource_count      INTEGER NOT NULL DEFAULT 0,
    byte_size           INTEGER NOT NULL DEFAULT 0,
    content             BYTEA NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bulk_files_job ON bulk_export_files(job_id, resource_type);

-- ---------------------------------------------------------------------------
-- fhir_subscriptions
-- FHIR R4 Subscription resource (the registry side; the actual Subscription
-- FHIR resource also lives in fhir_resources). channel.type currently
-- supported: rest-hook. websocket / message channels are stubbed.
-- ---------------------------------------------------------------------------
CREATE TABLE fhir_subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    fhir_resource_id    TEXT NOT NULL,                      -- Subscription/<id>
    status              TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested','active','error','off')),
    criteria            TEXT NOT NULL,                      -- e.g. "Observation?code=http://loinc.org|2160-0"
    channel_type        TEXT NOT NULL DEFAULT 'rest-hook'
                        CHECK (channel_type IN ('rest-hook','websocket','message','email','sms')),
    endpoint            TEXT,
    payload_mime        TEXT NOT NULL DEFAULT 'application/fhir+json',
    header              JSONB,
    reason              TEXT,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, fhir_resource_id)
);
CREATE INDEX idx_fhir_subs_org_active ON fhir_subscriptions(org_id, status);

CREATE TRIGGER fhir_subscriptions_updated BEFORE UPDATE ON fhir_subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- fhir_subscription_deliveries
-- Per-event delivery audit. status: pending, delivered, failed, retrying.
-- ---------------------------------------------------------------------------
CREATE TABLE fhir_subscription_deliveries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID NOT NULL REFERENCES fhir_subscriptions(id) ON DELETE CASCADE,
    org_id              UUID NOT NULL,
    event_type          TEXT NOT NULL,
    triggering_resource TEXT,                               -- Type/<id>
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    last_attempt_at     TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','delivered','failed','retrying')),
    response_status     INTEGER,
    response_body       TEXT,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fhir_deliveries_sub ON fhir_subscription_deliveries(subscription_id, created_at DESC);
CREATE INDEX idx_fhir_deliveries_pending ON fhir_subscription_deliveries(status, created_at)
    WHERE status IN ('pending','retrying');

-- ---------------------------------------------------------------------------
-- hl7_vendor_profiles
-- Per-org configuration for vendor-specific HL7 v2 quirks. Drives
-- routing decisions and Z-segment interpretation.
--
-- Examples:
--   Epic:    sending_app pattern '^EPIC.*$', mrn_authority 'EPIC',
--            z_segments {ZID:{purpose:patient_link,fields:[1]}, ZPV:{purpose:visit_extension}}
--   Cerner:  sending_app pattern '^MILLENNIUM.*$', mrn_authority 'CERNER'
--   Meditech: sending_app pattern '^MEDITECH.*$', mrn_authority 'MEDITECH'
--   Allscripts: sending_app pattern '^SUNRISE.*$' or '^TouchWorks.*$'
--   Athena:  sending_app pattern '^ATHENA.*$'
-- ---------------------------------------------------------------------------
CREATE TABLE hl7_vendor_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    vendor_name         TEXT NOT NULL,
    sending_app_pattern TEXT NOT NULL,                      -- regex
    mrn_authority       TEXT,                               -- value to match in PID-3.4
    config              JSONB NOT NULL DEFAULT '{}'::jsonb, -- Z-segments, version overrides
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendor_org ON hl7_vendor_profiles(org_id, is_active);

CREATE TRIGGER hl7_vendor_profiles_updated BEFORE UPDATE ON hl7_vendor_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS for new tenant tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY[
        'smart_clients','cds_service_invocations',
        'bulk_export_jobs','fhir_subscriptions',
        'hl7_vendor_profiles'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY %I ON %I USING (org_id = app_current_org_id()) '
            'WITH CHECK (org_id = app_current_org_id())',
            'tenant_isolation_' || tbl, tbl
        );
    END LOOP;
END
$$;

-- bulk_export_files inherits tenant scope through its job
ALTER TABLE bulk_export_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_export_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bulk_files ON bulk_export_files
    USING (
        EXISTS (SELECT 1 FROM bulk_export_jobs j
                WHERE j.id = bulk_export_files.job_id
                  AND j.org_id = app_current_org_id())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM bulk_export_jobs j
                WHERE j.id = bulk_export_files.job_id
                  AND j.org_id = app_current_org_id())
    );

ALTER TABLE fhir_subscription_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fhir_subscription_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_subdeliveries ON fhir_subscription_deliveries
    USING (org_id = app_current_org_id())
    WITH CHECK (org_id = app_current_org_id());

-- smart_authz_codes and smart_access_tokens: keyed by org_id but the
-- /authorize and /token endpoints run unscoped. We still scope by org
-- where set, allow when unscoped (e.g. token introspection paths).
ALTER TABLE smart_authz_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_authz_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_smart_authz ON smart_authz_codes
    USING (app_current_org_id() IS NULL OR org_id = app_current_org_id())
    WITH CHECK (app_current_org_id() IS NULL OR org_id = app_current_org_id());

ALTER TABLE smart_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_access_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_smart_tokens ON smart_access_tokens
    USING (app_current_org_id() IS NULL OR org_id = app_current_org_id())
    WITH CHECK (app_current_org_id() IS NULL OR org_id = app_current_org_id());

-- =============================================================================
-- 005_ehr_integration.sql complete
-- =============================================================================
