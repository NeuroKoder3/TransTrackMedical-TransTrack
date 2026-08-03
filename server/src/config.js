'use strict';

/**
 * Centralised, validated config loader. Reads from process.env.
 * Throws at startup if required variables are missing or malformed.
 */

const { z } = require('zod');

/**
 * Env-safe boolean. Zod's `z.coerce.boolean()` treats the string "false" as
 * true (Boolean("false") === true). Parse common truthy/falsy env spellings
 * instead.
 */
const envBool = z.preprocess((val) => {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null || val === '') return undefined;
  const s = String(val).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return val;
}, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: envBool.default(false),

  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
  PGSSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  // PEM bundle used to verify the PostgreSQL server certificate. When empty
  // the Node default trust store is used. Both `require` and `verify-full`
  // verify the chain (M-13); they differ only in hostname checking.
  PGSSL_CA_FILE: z.string().optional().default(''),
  // Escape hatch for a server presenting a certificate that cannot be
  // verified. Named for what it does, refused in production, and never
  // implied by PGSSL=require.
  PGSSL_ALLOW_UNVERIFIED: envBool.default(false),
  PG_POOL_MAX: z.coerce.number().int().positive().default(20),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30000),

  // TLS termination enforcement
  REQUIRE_TLS_TERMINATION: envBool.default(true),
  HTTPS_CERT: z.string().optional().default(''),
  HTTPS_KEY: z.string().optional().default(''),
  ALLOW_INSECURE_HTTP: envBool.default(false),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 bytes'),
  JWT_ISSUER: z.string().default('transtrack'),
  JWT_AUDIENCE: z.string().default('transtrack-api'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),

  MFA_ISSUER_LABEL: z.string().default('TransTrack'),
  MFA_REQUIRED_FOR_ROLES: z.string().default('admin,coordinator,physician,regulator'),

  LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  LOCKOUT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(30),

  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
  PASSWORD_HISTORY_COUNT: z.coerce.number().int().nonnegative().default(10),

  SAML_ENABLED: envBool.default(false),
  SAML_ENTRY_POINT: z.string().optional().default(''),
  SAML_ISSUER: z.string().optional().default('urn:transtrack:sp'),
  SAML_CALLBACK_URL: z.string().optional().default(''),
  SAML_IDP_CERT: z.string().optional().default(''),
  SAML_ROLE_ATTRIBUTE: z.string().optional().default('urn:oid:1.3.6.1.4.1.5923.1.1.1.7'),
  SAML_EMAIL_ATTRIBUTE: z.string().optional().default('urn:oid:0.9.2342.19200300.100.1.3'),
  SAML_NAME_ATTRIBUTE: z.string().optional().default('urn:oid:2.16.840.1.113730.3.1.241'),

  OIDC_ENABLED: envBool.default(false),
  OIDC_ISSUER: z.string().optional().default(''),
  OIDC_CLIENT_ID: z.string().optional().default(''),
  OIDC_CLIENT_SECRET: z.string().optional().default(''),
  OIDC_REDIRECT_URI: z.string().optional().default(''),
  OIDC_SCOPES: z.string().optional().default('openid profile email'),
  OIDC_ROLE_CLAIM: z.string().optional().default('transtrack_role'),

  SSO_ROLE_MAP: z.string().optional().default(''),
  SSO_UNKNOWN_ROLE_POLICY: z.enum(['deny', 'default_user']).default('default_user'),

  HL7_MLLP_ENABLED: envBool.default(true),
  // The MLLP listener has no transport authentication unless mutual TLS is
  // configured, so it binds loopback by default (H-9). Operators that front
  // it with an interface engine on another host must widen this explicitly.
  HL7_MLLP_HOST: z.string().default('127.0.0.1'),
  HL7_MLLP_PORT: z.coerce.number().int().min(0).default(2575),
  // Resource bounds for the listener (H-9).
  HL7_MLLP_MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
  HL7_MLLP_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  HL7_MLLP_MAX_CONNECTIONS: z.coerce.number().int().positive().default(64),
  HL7_MLLP_TLS_CERT_FILE: z.string().optional().default(''),
  HL7_MLLP_TLS_KEY_FILE: z.string().optional().default(''),
  HL7_MLLP_TLS_CA_FILE: z.string().optional().default(''),
  HL7_MLLP_TLS_REQUIRE_CLIENT_CERT: envBool.default(true),
  HL7_ALLOW_PLAINTEXT: envBool.default(false),
  HL7_DEFAULT_ORG_ID: z.string().optional().default(''),
  HL7_RAW_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(90),

  FHIR_BASE_URL: z.string().default('http://localhost:8080/fhir'),
  FHIR_REQUIRE_AUTH: envBool.default(true),

  SIEM_ENABLED: envBool.default(false),
  SIEM_ENDPOINT: z.string().optional().default(''),
  SIEM_TOKEN: z.string().optional().default(''),

  CORS_ALLOWED_ORIGINS: z.string().optional().default(''),
  SUBSCRIPTION_DISPATCH_MS: z.coerce.number().int().positive().default(5000),
  SMART_DEFAULT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // ---------------------------------------------------------------------------
  // SMART/OIDC ID token signing (M-26).
  //
  // ID tokens are signed asymmetrically and the public half is published at
  // /.well-known/jwks.json, so relying parties never need — and never receive
  // — a server secret. Point SMART_ID_TOKEN_KEY_FILE at a PEM private key
  // (RSA for RS256, EC P-256 for ES256). Production refuses to mint an ID
  // token without one; development falls back to an ephemeral key pair that
  // is regenerated on every boot.
  // ---------------------------------------------------------------------------
  SMART_ID_TOKEN_KEY_FILE: z.string().optional().default(''),
  SMART_ID_TOKEN_ALG: z.enum(['RS256', 'ES256']).default('RS256'),
  SMART_ID_TOKEN_KID: z.string().optional().default('transtrack-id-token-1'),
  SMART_ID_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // ---------------------------------------------------------------------------
  // CDS Hooks invocation audit (H-12).
  //
  // The invocation audit stores a PHI-free summary by default. Raw request and
  // response payloads carry patient context and prefetched FHIR resources, so
  // capturing them creates a second unredacted PHI store; it is opt-in, the
  // rows record that they were captured, and captured payloads are given an
  // explicit expiry that operators must actually enforce.
  // ---------------------------------------------------------------------------
  CDS_CAPTURE_RAW_PAYLOADS: envBool.default(false),
  CDS_RAW_PAYLOAD_RETENTION_DAYS: z.coerce.number().int().positive().default(7),

  // Epic on FHIR integration (optional). When EPIC_SANDBOX_CLIENT_ID and
  // EPIC_PRIVATE_KEY_FILE are set, /integrations/epic/import accepts the
  // server-fetch mode (server pulls patient data from Epic directly).
  EPIC_SANDBOX_CLIENT_ID: z.string().optional().default(''),
  EPIC_PRIVATE_KEY_FILE: z.string().optional().default(''),
  EPIC_TOKEN_URL: z.string().optional().default(''),
  EPIC_FHIR_BASE: z.string().optional().default(''),
  EPIC_KID: z.string().optional().default('transtrack-epic-1'),
  EPIC_SCOPE: z.string().optional().default(''),
  EPIC_DEFAULT_PATIENT_ID: z.string().optional().default(''),

  // ---------------------------------------------------------------------------
  // Stripe billing & license provisioning (see server/src/routes/billing.js).
  // All of these are optional — the routes return 503 if Stripe isn't
  // configured, so existing pilot/integration deploys are unaffected.
  // ---------------------------------------------------------------------------
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_BILLING_RETURN_URL: z.string().optional().default(''),
  STRIPE_PRICE_ID_STARTER: z.string().optional().default(''),
  STRIPE_PRICE_ID_PROFESSIONAL: z.string().optional().default(''),
  STRIPE_PRICE_ID_ENTERPRISE: z.string().optional().default(''),

  // Path to the Ed25519 private key used to sign licenses issued by the
  // webhook handler. NEVER commit this; mount it as a Docker secret.
  LICENSE_PRIVATE_KEY_PATH: z.string().optional().default(''),

  // Optional SMTP for emailing license files to customers post-checkout.
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
  SMTP_SECURE: envBool.optional().default(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default(''),
});

/**
 * Placeholder secrets that have shipped in .env.example / docker-compose.yml
 * or that are otherwise guessable (M-15). They satisfy the 32-byte length
 * floor while being fully predictable, so length alone cannot be the only
 * check. Matching is case-insensitive and substring-based so that
 * "dev-jwt-secret-change-me-aaaa..." is caught by "change-me".
 */
const PLACEHOLDER_SECRET_MARKERS = Object.freeze([
  'change-me', 'changeme', 'change_me', 'replace-me', 'replaceme', 'replace_me',
  'dev-jwt-secret', 'dev-secret', 'devsecret', 'insecure', 'placeholder',
  'example-secret', 'not-a-secret', 'password', 'secret-secret', 'transtrack-dev',
  'xxxxxxxx', '00000000', '12345678',
]);

/**
 * Both shipped defaults reach the 32-byte floor by padding with a repeated
 * character ("...-aaaaaaaaaaaa"). A run of eight or more identical characters
 * is filler, not entropy; randomly generated secrets do not produce one.
 */
const FILLER_RUN = /(.)\1{7,}/;

function isPredictableSecret(value) {
  if (typeof value !== 'string' || value === '') return true;
  const lower = value.toLowerCase();
  if (PLACEHOLDER_SECRET_MARKERS.some((marker) => lower.includes(marker))) return true;
  if (FILLER_RUN.test(value)) return true;
  return false;
}

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  cfg.MFA_REQUIRED_FOR_ROLES_SET = new Set(
    cfg.MFA_REQUIRED_FOR_ROLES.split(',').map(s => s.trim()).filter(Boolean)
  );
  cfg.OIDC_SCOPES_LIST = cfg.OIDC_SCOPES.split(/\s+/).filter(Boolean);

  cfg.SSO_ROLE_MAP_PARSED = {};
  if (cfg.SSO_ROLE_MAP) {
    try { cfg.SSO_ROLE_MAP_PARSED = JSON.parse(cfg.SSO_ROLE_MAP); }
    catch { throw new Error('SSO_ROLE_MAP must be valid JSON (e.g. {"IdPAdmin":"admin","IdPViewer":"viewer"})'); }
  }

  // Production TLS fail-closed: reject PGSSL=disable in production
  if (cfg.NODE_ENV === 'production' && cfg.PGSSL === 'disable') {
    throw new Error(
      'PGSSL=disable is not allowed in production. Set PGSSL=verify-full (recommended) or PGSSL=require.'
    );
  }

  // M-13: an unverified TLS connection to the database is an accepted risk
  // for a developer poking at a self-signed instance and nothing more.
  if (cfg.NODE_ENV === 'production' && cfg.PGSSL_ALLOW_UNVERIFIED) {
    throw new Error(
      'PGSSL_ALLOW_UNVERIFIED is not allowed in production. Supply the server CA ' +
      'via PGSSL_CA_FILE and use PGSSL=verify-full.'
    );
  }

  // M-15: refuse to run in production on a secret anyone can look up.
  if (cfg.NODE_ENV === 'production' && isPredictableSecret(cfg.JWT_SECRET)) {
    throw new Error(
      'JWT_SECRET is a known placeholder or otherwise predictable value and is refused in ' +
      'production. Generate one with: openssl rand -base64 48'
    );
  }

  if (cfg.SAML_ENABLED && (!cfg.SAML_ENTRY_POINT || !cfg.SAML_IDP_CERT)) {
    throw new Error('SAML_ENABLED=true requires SAML_ENTRY_POINT and SAML_IDP_CERT');
  }
  if (cfg.OIDC_ENABLED && (!cfg.OIDC_ISSUER || !cfg.OIDC_CLIENT_ID || !cfg.OIDC_CLIENT_SECRET)) {
    throw new Error('OIDC_ENABLED=true requires OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET');
  }

  return Object.freeze(cfg);
}

module.exports = { load, isPredictableSecret };
