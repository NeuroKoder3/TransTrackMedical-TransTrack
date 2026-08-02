'use strict';

/**
 * Reserved organisation used to attribute inbound traffic that cannot be
 * resolved to a real tenant (M-27). Created by migration 010; it is INACTIVE
 * and is never handed out by provisioning, so no user is ever a member of it
 * and its rows are unreadable through the tenant row-level-security policies.
 *
 * Anything filed against it is quarantined, not delivered: it must never be
 * used as a working context for ingest.
 */
const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

function isSystemOrg(orgId) {
  return orgId === SYSTEM_ORG_ID;
}

module.exports = { SYSTEM_ORG_ID, isSystemOrg };
