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

-- Apply RLS to every tenant-scoped table.
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY[
        'users','password_history','sessions',
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

-- organizations table: readable when org_id matches OR caller is unscoped
-- (e.g. login, account provisioning). Modification is admin-only and
-- enforced in the application layer.
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
