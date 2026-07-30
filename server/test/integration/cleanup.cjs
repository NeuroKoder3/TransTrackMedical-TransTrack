'use strict';

/**
 * Tear down an integration-test organization and dependent rows.
 * Patient read/list auditing leaves audit_logs that block org DELETE.
 */
async function destroyTestOrg(query, orgId) {
  if (!orgId) return;
  const statements = [
    `DELETE FROM audit_logs WHERE org_id = $1`,
    `DELETE FROM sessions WHERE org_id = $1`,
    `DELETE FROM login_attempts WHERE org_id = $1`,
    `DELETE FROM mfa_challenges WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`,
    `DELETE FROM mfa_enrollments WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`,
    `DELETE FROM lab_results WHERE org_id = $1`,
    `DELETE FROM fhir_resources WHERE org_id = $1`,
    `DELETE FROM fhir_subscription_deliveries WHERE org_id = $1`,
    `DELETE FROM fhir_subscriptions WHERE org_id = $1`,
    `DELETE FROM hl7_dead_letters WHERE org_id = $1`,
    `DELETE FROM hl7_messages WHERE org_id = $1`,
    `DELETE FROM hl7_sending_apps WHERE org_id = $1`,
    `DELETE FROM patients WHERE org_id = $1`,
    `DELETE FROM users WHERE org_id = $1`,
    `DELETE FROM organizations WHERE id = $1`,
  ];
  for (const sql of statements) {
    try {
      await query(sql, [orgId]);
    } catch {
      /* table may not exist in older schemas */
    }
  }
}

module.exports = { destroyTestOrg };
