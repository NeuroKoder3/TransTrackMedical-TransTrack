'use strict';

/**
 * Centralised, validated config loader. Reads from process.env.
 * Throws at startup if required variables are missing or malformed.
 */

const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.coerce.boolean().default(false),

  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
  PGSSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(20),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30000),

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

  SAML_ENABLED: z.coerce.boolean().default(false),
  SAML_ENTRY_POINT: z.string().optional().default(''),
  SAML_ISSUER: z.string().optional().default('urn:transtrack:sp'),
  SAML_CALLBACK_URL: z.string().optional().default(''),
  SAML_IDP_CERT: z.string().optional().default(''),
  SAML_ROLE_ATTRIBUTE: z.string().optional().default('urn:oid:1.3.6.1.4.1.5923.1.1.1.7'),
  SAML_EMAIL_ATTRIBUTE: z.string().optional().default('urn:oid:0.9.2342.19200300.100.1.3'),
  SAML_NAME_ATTRIBUTE: z.string().optional().default('urn:oid:2.16.840.1.113730.3.1.241'),

  OIDC_ENABLED: z.coerce.boolean().default(false),
  OIDC_ISSUER: z.string().optional().default(''),
  OIDC_CLIENT_ID: z.string().optional().default(''),
  OIDC_CLIENT_SECRET: z.string().optional().default(''),
  OIDC_REDIRECT_URI: z.string().optional().default(''),
  OIDC_SCOPES: z.string().optional().default('openid profile email'),
  OIDC_ROLE_CLAIM: z.string().optional().default('transtrack_role'),

  HL7_MLLP_ENABLED: z.coerce.boolean().default(true),
  HL7_MLLP_HOST: z.string().default('0.0.0.0'),
  HL7_MLLP_PORT: z.coerce.number().int().positive().default(2575),
  HL7_MLLP_TLS_CERT_FILE: z.string().optional().default(''),
  HL7_MLLP_TLS_KEY_FILE: z.string().optional().default(''),
  HL7_MLLP_TLS_CA_FILE: z.string().optional().default(''),
  HL7_MLLP_TLS_REQUIRE_CLIENT_CERT: z.coerce.boolean().default(true),
  HL7_DEFAULT_ORG_ID: z.string().optional().default(''),

  FHIR_BASE_URL: z.string().default('http://localhost:8080/fhir'),
  FHIR_REQUIRE_AUTH: z.coerce.boolean().default(true),

  SIEM_ENABLED: z.coerce.boolean().default(false),
  SIEM_ENDPOINT: z.string().optional().default(''),
  SIEM_TOKEN: z.string().optional().default(''),

  CORS_ALLOWED_ORIGINS: z.string().optional().default(''),
  SUBSCRIPTION_DISPATCH_MS: z.coerce.number().int().positive().default(5000),
  SMART_DEFAULT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

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
});

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

  if (cfg.SAML_ENABLED && (!cfg.SAML_ENTRY_POINT || !cfg.SAML_IDP_CERT)) {
    throw new Error('SAML_ENABLED=true requires SAML_ENTRY_POINT and SAML_IDP_CERT');
  }
  if (cfg.OIDC_ENABLED && (!cfg.OIDC_ISSUER || !cfg.OIDC_CLIENT_ID || !cfg.OIDC_CLIENT_SECRET)) {
    throw new Error('OIDC_ENABLED=true requires OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET');
  }

  return Object.freeze(cfg);
}

module.exports = { load };
