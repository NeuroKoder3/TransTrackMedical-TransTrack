/**
 * TransTrack - IPC Handler Coordinator
 *
 * Registers all domain-specific IPC handler modules.
 * Each module handles a specific set of IPC channels.
 *
 * Security Features:
 * - SQL injection prevention via parameterized queries and column whitelisting
 * - Session expiration validation
 * - Account lockout after failed login attempts
 * - Password strength requirements
 * - Audit logging for all operations
 * - Organization isolation on all data access
 */

const authHandlers = require('./handlers/auth.cjs');
const entityHandlers = require('./handlers/entities.cjs');
const adminHandlers = require('./handlers/admin.cjs');
const licenseHandlers = require('./handlers/license.cjs');
const barrierHandlers = require('./handlers/barriers.cjs');
const ahhqHandlers = require('./handlers/ahhq.cjs');
const labsHandlers = require('./handlers/labs.cjs');
const clinicalHandlers = require('./handlers/clinical.cjs');
const operationsHandlers = require('./handlers/operations.cjs');

function setupIPCHandlers() {
  authHandlers.register();
  entityHandlers.register();
  adminHandlers.register();
  licenseHandlers.register();
  barrierHandlers.register();
  ahhqHandlers.register();
  labsHandlers.register();
  clinicalHandlers.register();
  operationsHandlers.register();
}

module.exports = { setupIPCHandlers };
