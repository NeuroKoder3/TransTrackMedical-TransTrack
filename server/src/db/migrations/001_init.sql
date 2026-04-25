-- =============================================================================
-- 001_init.sql
-- Core schema: organizations, users, sessions, audit logs, password history,
-- MFA enrolments, account lockout, identity-provider mapping (SAML/OIDC).
-- All tenant tables are org-scoped and protected by row-level security.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'TRANSPLANT_CENTER'
                    CHECK (type IN ('TRANSPLANT_CENTER','OPO','TISSUE_BANK','HOSPITAL','CLINIC')),
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
    address         TEXT,
    phone           TEXT,
    email           CITEXT,
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_status ON organizations(status);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email                    CITEXT NOT NULL,
    password_hash            TEXT,                          -- nullable when SAML/OIDC-only
    full_name                TEXT,
    role                     TEXT NOT NULL DEFAULT 'user'
                             CHECK (role IN ('admin','coordinator','physician','user','viewer','regulator')),
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password     BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts    INTEGER NOT NULL DEFAULT 0,
    locked_until             TIMESTAMPTZ,
    last_login_at            TIMESTAMPTZ,
    last_login_ip            INET,
    last_password_change_at  TIMESTAMPTZ,
    auth_provider            TEXT NOT NULL DEFAULT 'local'
                             CHECK (auth_provider IN ('local','saml','oidc')),
    external_subject         TEXT,                          -- SAML NameID or OIDC sub
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, email),
    UNIQUE(auth_provider, external_subject)
);

CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_role ON users(role);

-- ---------------------------------------------------------------------------
-- password_history (regulatory: prevent reuse of last N)
-- ---------------------------------------------------------------------------
CREATE TABLE password_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_history_user ON password_history(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- mfa_enrollments (TOTP). Recovery codes are stored hashed.
-- ---------------------------------------------------------------------------
CREATE TABLE mfa_enrollments (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted BYTEA NOT NULL,
    label          TEXT NOT NULL,
    confirmed_at   TIMESTAMPTZ,
    last_used_at   TIMESTAMPTZ,
    recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of {hash, used_at}
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sessions (refresh tokens; JWT access tokens are stateless)
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    ip_address    INET,
    user_agent    TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- login_attempts (for lockout window)
-- ---------------------------------------------------------------------------
CREATE TABLE login_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT NOT NULL,
    org_id          UUID,
    ip_address      INET,
    success         BOOLEAN NOT NULL,
    reason          TEXT,
    attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_attempts_email_time ON login_attempts(email, attempted_at DESC);

-- ---------------------------------------------------------------------------
-- audit_logs (immutable, tamper-evident via hash chain in column prev_hash)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id),
    action        TEXT NOT NULL,
    entity_type   TEXT,
    entity_id     TEXT,
    patient_name  TEXT,
    details       JSONB,
    user_id       UUID,
    user_email    CITEXT,
    user_role     TEXT,
    ip_address    INET,
    user_agent    TEXT,
    prev_hash     TEXT,
    record_hash   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(org_id, entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_logs(org_id, user_email);

-- Immutability triggers (HIPAA 45 CFR 164.312(b)).
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs are immutable (HIPAA 164.312(b))';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- helper: updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER mfa_enrollments_updated BEFORE UPDATE ON mfa_enrollments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
