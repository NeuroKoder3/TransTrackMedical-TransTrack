-- =============================================================================
-- 010_tenant_rls_hardening.sql
-- H-3 / M-27 — three tenant tables shipped without row-level security:
--
--   hl7_dead_letters   (008) : quarantined raw HL7 v2 messages — full PHI.
--   hl7_sending_apps   (008) : MSH-3 sending application -> org routing table.
--   issued_licenses    (006) : documented as "protected by row-level security"
--                              but no RLS DDL was ever written.
--
-- Migrations are forward-only (see src/db/migrate.js), so the historical files
-- are left untouched and the controls are added here.
--
-- Handling of hl7_dead_letters.org_id NULLs (M-27)
-- ------------------------------------------------
-- 008 allowed a NULL org_id and the MLLP listener wrote NULLs whenever it
-- could not resolve a sending application to a tenant, so raw PHI accumulated
-- unattributed. A plain `org_id = app_current_org_id()` policy evaluates to
-- NULL (not TRUE) for those rows, so they would be invisible rather than
-- world-readable — but "invisible and unattributable" is not an acceptable
-- resting state for PHI either. Instead:
--
--   * a reserved system organisation is created with the all-zero UUID,
--   * existing NULL rows are re-attributed to it,
--   * the column becomes NOT NULL so the state cannot recur, and
--   * the FK moves from ON DELETE SET NULL to ON DELETE CASCADE, because
--     SET NULL is no longer a legal outcome.
--
-- No user can belong to the reserved organisation (it is INACTIVE and is
-- never handed out by provisioning), so system-owned quarantine rows are
-- readable by no tenant at all. Operators reach them with a direct,
-- separately-audited database session.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Reserved system organisation for unattributable inbound traffic.
-- ---------------------------------------------------------------------------
INSERT INTO organizations (id, name, type, status)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'TransTrack System (unattributed intake quarantine)',
    'TRANSPLANT_CENTER',
    'INACTIVE'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- hl7_dead_letters: attribute every row, then lock the column down.
-- ---------------------------------------------------------------------------
UPDATE hl7_dead_letters
   SET org_id = '00000000-0000-0000-0000-000000000000'
 WHERE org_id IS NULL;

ALTER TABLE hl7_dead_letters
    DROP CONSTRAINT IF EXISTS hl7_dead_letters_org_id_fkey;
ALTER TABLE hl7_dead_letters
    ADD CONSTRAINT hl7_dead_letters_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE hl7_dead_letters
    ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE hl7_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE hl7_dead_letters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_hl7_dead_letters ON hl7_dead_letters
    USING (org_id = app_current_org_id())
    WITH CHECK (org_id = app_current_org_id());

-- ---------------------------------------------------------------------------
-- hl7_sending_apps.
--
-- Writes are tenant-scoped exactly like every other tenant table. Reads need
-- one carve-out: the MLLP listener resolves MSH-3 to an org_id *before* any
-- tenant context can exist, so that lookup runs on an unscoped session. The
-- row holds no PHI (an application name and the org it routes to) and the
-- carve-out is SELECT-only, so an unscoped session can route but can neither
-- create nor retarget a mapping.
-- ---------------------------------------------------------------------------
ALTER TABLE hl7_sending_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE hl7_sending_apps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_hl7_sending_apps ON hl7_sending_apps
    USING (org_id = app_current_org_id())
    WITH CHECK (org_id = app_current_org_id());
CREATE POLICY mllp_routing_lookup_hl7_sending_apps ON hl7_sending_apps
    FOR SELECT
    USING (app_current_org_id() IS NULL);

-- ---------------------------------------------------------------------------
-- issued_licenses.
--
-- org_id here is TEXT (it carries the licensing org identifier supplied at
-- Stripe checkout, which is not guaranteed to be a UUID), so the policy
-- compares the raw session setting rather than going through
-- app_current_org_id(), which casts to UUID.
--
-- The Stripe webhook writes and renews licenses with no tenant context at all
-- — it is keyed by subscription id, not by org. Rather than weakening the
-- tenant policy to "unscoped sees everything", the webhook declares itself by
-- setting app.billing_context (see withBillingContext in src/db/pool.js). No
-- request-driven code path sets that variable, so an API caller cannot reach
-- another tenant's license through it.
-- ---------------------------------------------------------------------------
ALTER TABLE issued_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_licenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_issued_licenses ON issued_licenses
    USING (org_id = current_setting('app.current_org_id', true))
    WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY billing_webhook_issued_licenses ON issued_licenses
    USING (current_setting('app.billing_context', true) = 'stripe_webhook')
    WITH CHECK (current_setting('app.billing_context', true) = 'stripe_webhook');

COMMENT ON TABLE issued_licenses IS
    'Signed licenses issued via Stripe checkout. Row-level security is enabled '
    'by migration 010: tenants see only their own org_id, and the Stripe '
    'webhook reaches every row only while app.billing_context is set.';

-- =============================================================================
-- 010_tenant_rls_hardening.sql complete
-- =============================================================================
