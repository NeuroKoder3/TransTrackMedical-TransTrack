-- =============================================================================
-- 004_audit_clock_timestamp.sql
-- Use clock_timestamp() (statement-level) instead of now() (transaction-level)
-- for audit_logs.created_at, so multiple rows written inside the same
-- transaction get strictly increasing timestamps. Combined with an id
-- tiebreaker on the read side, this gives a stable hash-chain order.
-- =============================================================================

ALTER TABLE audit_logs
    ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- Concurrency safety: if two transactions pick the same `prev` row, the
-- second INSERT fails on this constraint, forcing a retry. The chain stays
-- linear and unforked.
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_logs_org_prev
    ON audit_logs (org_id, prev_hash);
