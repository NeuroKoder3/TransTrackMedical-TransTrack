-- OIDC auth state persistence (replaces in-memory Map)
CREATE TABLE IF NOT EXISTS oidc_auth_states (
  state TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_oidc_auth_states_expires
  ON oidc_auth_states (expires_at);
