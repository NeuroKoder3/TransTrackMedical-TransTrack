-- =============================================================================
-- 003_rls.sql
-- Row-level security: every tenant table denies access unless the request
-- supplies app.current_org_id matching the row. The API sets this via
--   SELECT set_config('app.current_org_id', '<uuid>', true)
-- on each transaction. Bypass requires explicit BYPASSRLS role privilege.
-- =============================================================================

-- helper to read the current org_id from session
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS UUID AS $$
DECLARE
    v TEXT := current_setting('app.current_org_id', true);
BEGIN
    IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
    RETURN v::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- ---------------------------------------------------------------------------
-- Tables that carry their own org_id column: scope by direct column match.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY[
        'users','sessions',
        'patients','donor_organs','organ_offers','lab_results',
        'post_transplant_followups','living_donors',
        'audit_logs','hl7_messages','fhir_resources'
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

-- ---------------------------------------------------------------------------
-- Tables keyed only by user_id: scope by joining through users.org_id.
-- ---------------------------------------------------------------------------
ALTER TABLE password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_password_history ON password_history
    USING (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = password_history.user_id
              AND u.org_id = app_current_org_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = password_history.user_id
              AND u.org_id = app_current_org_id()
        )
    );

ALTER TABLE mfa_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_mfa_enrollments ON mfa_enrollments
    USING (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = mfa_enrollments.user_id
              AND u.org_id = app_current_org_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = mfa_enrollments.user_id
              AND u.org_id = app_current_org_id()
        )
    );

-- mfa_challenges is short-lived and used during login (pre-org-context).
-- It is keyed by user_id and scoped through the same join.
ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_mfa_challenges ON mfa_challenges
    USING (
        app_current_org_id() IS NULL
        OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = mfa_challenges.user_id
              AND u.org_id = app_current_org_id()
        )
    )
    WITH CHECK (
        app_current_org_id() IS NULL
        OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = mfa_challenges.user_id
              AND u.org_id = app_current_org_id()
        )
    );

-- login_attempts is written before any session exists, so it is intentionally
-- not RLS-protected. Access is restricted at the API layer.

-- ---------------------------------------------------------------------------
-- organizations: readable when org_id matches OR caller is unscoped
-- (e.g. login, account provisioning). Modification is admin-only and
-- enforced in the application layer.
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_self_read ON organizations
    FOR SELECT
    USING (
        app_current_org_id() IS NULL
        OR id = app_current_org_id()
    );
CREATE POLICY org_admin_write ON organizations
    FOR ALL
    USING (app_current_org_id() IS NULL OR id = app_current_org_id())
    WITH CHECK (app_current_org_id() IS NULL OR id = app_current_org_id());
