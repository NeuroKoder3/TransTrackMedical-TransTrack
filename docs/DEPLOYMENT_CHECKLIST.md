# Production Deployment Checklist

## Pre-Deployment (2 weeks before)

### Security & Compliance
- [ ] Third-party security audit completed (recommended)
- [ ] All `npm audit` vulnerabilities at moderate+ level resolved
- [ ] HIPAA Business Associate Agreement signed with customer
- [ ] Legal review of BAA completed
- [ ] Data residency requirements confirmed with customer
- [ ] Encryption key management procedures documented and reviewed

### Code Quality
- [ ] All tests passing (`npm test`)
- [ ] Cross-organization isolation tests passing (`npm run test:security`)
- [ ] Business logic tests passing (`npm run test:business`)
- [ ] ESLint clean (`npm run lint`)
- [ ] No `console.log` statements in production code paths
- [ ] DevTools confirmed disabled in production builds

### Build Verification
- [ ] Production build completes without errors (`npm run build:enterprise:win`)
- [ ] Application starts from packaged build
- [ ] Database encryption verified in packaged build
- [ ] **Licensing not applicable in v1.x** — `electron/license/` is a no-op shim; no key validation or tier check exists in the v1.x build (see `docs/DEPLOYMENT_PRODUCTION.md` §4.3 and `docs/DUE_DILIGENCE.md` §6)

## Deployment Day

### Build & Sign
- [ ] Set build version to enterprise: `node scripts/set-build-version.cjs enterprise`
- [ ] Build production package: `npm run build:enterprise:<platform>`
- [ ] Code signing certificate applied (Windows: Authenticode, macOS: Developer ID)
- [ ] Installer hash (SHA-256) computed and recorded
- [ ] Installer tested on clean machine

### Database & Data
- [ ] Fresh database initialization verified
- [ ] Default admin account created with strong password requirement
- [ ] Organization configured with correct name and type
- [ ] Backup/restore cycle tested (3 successful cycles minimum)

### Configuration
- [ ] `.env.production` created from `.env.PRODUCTION.example` (NOT committed)
- [ ] EHR integration credentials configured (if applicable)
- [ ] Data residency policy configured
- [ ] Audit log retention policy configured

## Post-Deployment (first week)

### Verification
- [ ] Application accessible on all target workstations
- [ ] All user accounts created and tested
- [ ] Role-based access verified (admin, coordinator, viewer)
- [ ] Audit logs generating correctly
- [ ] Backup schedule configured and first backup verified

### Training
- [ ] Admin training completed (backup, user management, audit review)
- [ ] Coordinator training completed (patient management, donor matching)
- [ ] Emergency procedures reviewed with IT staff
- [ ] Disaster recovery contact list distributed

### Documentation
- [ ] Operations manual provided to customer
- [ ] Encryption key backup stored securely (offline)
- [ ] Support contact information shared
- [ ] Maintenance/update schedule agreed upon

## Ongoing Maintenance

### Weekly
- [ ] Verify backup integrity (automated or manual)
- [ ] Review audit logs for anomalies

### Monthly
- [ ] Run `npm audit` for new vulnerabilities
- [ ] Review access logs for unauthorized access patterns

### Quarterly
- [ ] Full disaster recovery test
- [ ] Key rotation (if policy requires)
- [ ] Security patch review and application
- [ ] Compliance audit trail report generation

### Annually
- [ ] Third-party security assessment
- [ ] HIPAA compliance review
- [ ] BAA renewal/review
- [ ] Disaster recovery plan update

---

*Checklist version: 1.1 | Last updated: 2026-05-01*

> **v1.1 changes** — removed all license-activation, license-key, and
> license-expiration steps. The publicly distributed v1.x build has no license
> enforcement (`electron/license/` is a no-op shim — see
> `docs/DEPLOYMENT_PRODUCTION.md` §4.3 and `docs/DUE_DILIGENCE.md` §6).
