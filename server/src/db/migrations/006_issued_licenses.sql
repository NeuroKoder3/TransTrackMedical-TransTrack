-- 006_issued_licenses.sql
-- TransTrack — licenses issued via Stripe checkout webhook.
--
-- Stores the metadata of every license we have signed and emailed to a
-- customer, so the sales/support team can:
--   * look up a customer's license from a Stripe session/customer/subscription ID
--   * re-issue / re-send the license file if a customer loses it
--   * reconcile against Stripe's records during audit
--
-- The full signed wire-format string is stored in `wire_format` so we
-- never have to re-derive it from raw payload + private key during
-- re-send. This row IS sensitive (it contains a valid license) and is
-- protected by row-level security plus the database-at-rest encryption
-- that already protects the rest of the schema.

CREATE TABLE IF NOT EXISTS issued_licenses (
  license_id              TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL,
  customer_name           TEXT NOT NULL,
  customer_email          TEXT NOT NULL,
  tier                    TEXT NOT NULL CHECK (tier IN ('evaluation', 'starter', 'professional', 'enterprise')),
  issued_at               TIMESTAMPTZ NOT NULL,
  expires_at              TIMESTAMPTZ NOT NULL,
  canceled_at             TIMESTAMPTZ,
  stripe_session_id       TEXT,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  wire_format             TEXT NOT NULL,
  machine_bindings_count  INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issued_licenses_email      ON issued_licenses(customer_email);
CREATE INDEX IF NOT EXISTS idx_issued_licenses_org        ON issued_licenses(org_id);
CREATE INDEX IF NOT EXISTS idx_issued_licenses_stripe_sub ON issued_licenses(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_issued_licenses_expires    ON issued_licenses(expires_at);
