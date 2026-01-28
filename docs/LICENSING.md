# TransTrack Licensing Documentation

## Overview

TransTrack uses a two-version distribution model with a license-tiered enterprise purchasing system designed for regulated healthcare organizations. This document outlines the licensing structure, feature entitlements, and purchasing process.

## Distribution Versions

### Evaluation Version

**Purpose:** Product evaluation only - NOT for clinical or operational use.

**Restrictions:**
- 14-day time limit
- Maximum 50 patients
- Maximum 5 donors
- Single user only
- No data export/import
- No FHIR integration
- Read-only audit logs
- Watermarked UI ("EVALUATION VERSION - NOT FOR CLINICAL USE")
- Cannot activate a license key

**Intended Use:**
- Demonstration to stakeholders
- Initial product evaluation
- Training (with mock data only)
- Feature exploration

**Download:** `TransTrack-Evaluation-[version].exe`

### Enterprise Version

**Purpose:** Licensed organizational use for production environments.

**Features:**
- Full feature set based on license tier
- Organization-based multi-tenancy
- Role-based access control
- Complete audit logging
- All compliance features
- License enforcement
- Data limits based on tier

**Download:** `TransTrack-Enterprise-[version].exe`

---

## License Tiers

### Starter License - $2,499

**Best for:** Small transplant programs, single-site operations

| Feature | Included |
|---------|----------|
| Installations | 1 workstation |
| Patients | Up to 500 |
| Users | Up to 3 |
| Support | Email (48hr response) |
| Updates | 1 year |
| Audit Reporting | Basic |
| FHIR Integration | ❌ |
| Custom Priority Config | ❌ |

**Annual Maintenance (after Year 1):** $499/year

---

### Professional License - $7,499

**Best for:** Growing programs, multi-site operations

| Feature | Included |
|---------|----------|
| Installations | Up to 5 workstations |
| Patients | Unlimited |
| Users | Up to 10 |
| Support | Priority Email (24hr response) |
| Updates | 2 years |
| Audit Reporting | Advanced |
| FHIR Integration | ✅ R4 Import/Export |
| Custom Priority Config | ✅ |
| Bulk Operations | ✅ |

**Annual Maintenance (after Year 2):** $1,499/year

---

### Enterprise License - $24,999

**Best for:** Large health systems, OPOs, multi-center networks

| Feature | Included |
|---------|----------|
| Installations | Unlimited |
| Patients | Unlimited |
| Users | Unlimited |
| Support | 24/7 Phone & Email |
| Updates | Lifetime |
| Audit Reporting | Full Compliance Suite |
| FHIR Integration | ✅ + Custom |
| Custom Priority Config | ✅ |
| Custom Integrations | ✅ |
| On-site Training | Optional |
| Source Code Escrow | ✅ |
| Custom Development | Hours included |

**Annual Maintenance:** $4,999/year (optional, for premium support continuation)

---

## Purchasing Process

### Step 1: Select Your Tier

Review the feature comparison above and select the tier that best fits your organization's needs.

### Step 2: Payment via PayPal

1. Click the "Pay with PayPal" button for your chosen tier in the application
2. Complete payment to: `lilnicole0383@gmail.com`
3. **Important:** Include your Organization ID in the payment note

### Step 3: Confirmation Email

Send an email to `Trans_Track@outlook.com` with:
- Payment confirmation/receipt
- Organization name
- Contact information
- Organization ID (found in Settings → License)
- Number of installations needed (for Professional tier)

### Step 4: Receive License Key

Within 24-48 business hours, you will receive:
- 25-character license key (format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)
- Activation instructions
- Welcome documentation

### Step 5: Activate License

1. Open TransTrack Enterprise version
2. Navigate to Settings → License
3. Enter your organization name
4. Enter the license key
5. Click "Activate License"

---

## License Key Format

License keys follow this format:
```
XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
```

**Prefix Indicators:**
- `ST***` - Starter tier
- `PR***` - Professional tier
- `EN***` - Enterprise tier

---

## Maintenance & Updates

### What's Included

**During Maintenance Period:**
- All software updates
- Security patches
- New feature releases
- Technical support (tier-dependent)

**After Maintenance Expiry:**
- Software continues to work (no lockout)
- No new updates available
- Support access disabled
- Warning banners displayed

### Renewal Process

1. Contact `Trans_Track@outlook.com` before expiry
2. Pay maintenance renewal via PayPal
3. Receive renewal confirmation
4. Banner notifications will clear automatically

### Grace Period

- 30 days after expiry before warnings appear
- Software remains fully functional
- Reminders encourage renewal

---

## Organization Binding

Licenses are bound to your Organization ID:
- Automatically generated on first run
- Unique to your installation
- Used for license verification
- Required for support requests

**Finding Your Organization ID:**
1. Open TransTrack
2. Navigate to Settings → License
3. Your Organization ID is displayed (format: `ORG-XXXXXXXX`)

---

## Multi-Installation (Professional & Enterprise)

### Installation Management

**Professional (5 installations):**
- Each workstation generates a unique machine ID
- License tracks active installations
- Contact support if you need to transfer installations

**Enterprise (unlimited):**
- No installation tracking required
- Deploy to any number of workstations
- Centralized configuration recommended

### Transferring Installations

To move a license to a new machine:
1. Deactivate on the old machine (Settings → License → Deactivate)
2. Install TransTrack on the new machine
3. Activate with your existing license key

---

## Compliance Considerations

### HIPAA

- License validation occurs locally (offline-capable)
- No PHI is transmitted during license checks
- Payment information is NOT stored locally
- Organization binding uses non-identifiable machine hashes

### FDA 21 CFR Part 11

- All license events are audited
- Immutable audit trail for license changes
- Timestamped activation records
- User attribution for all license actions

### AATB

- License tier does not affect compliance features
- All tiers include required documentation capabilities
- Audit trails are mandatory at all tiers

---

## Feature Gating Reference

### By Feature

| Feature | Evaluation | Starter | Professional | Enterprise |
|---------|------------|---------|--------------|------------|
| Patient Management | ✅ (50 max) | ✅ (500 max) | ✅ Unlimited | ✅ Unlimited |
| Donor Matching | ✅ (5 max) | ✅ | ✅ | ✅ |
| Audit Logs (View) | ✅ | ✅ | ✅ | ✅ |
| Audit Logs (Export) | ❌ | ✅ | ✅ | ✅ |
| FHIR Import/Export | ❌ | ❌ | ✅ | ✅ |
| Data Export | ❌ | ✅ | ✅ | ✅ |
| Priority Config | ❌ | ❌ | ✅ | ✅ |
| Multi-User | ❌ | ✅ (3) | ✅ (10) | ✅ Unlimited |
| Risk Dashboard | ✅ | ✅ | ✅ | ✅ |
| Readiness Barriers | ✅ | ✅ | ✅ | ✅ |
| Compliance Reports | ❌ | ✅ | ✅ | ✅ |
| Custom Reports | ❌ | ❌ | ✅ | ✅ |
| Backup/Restore | Create only | ✅ | ✅ | ✅ |

---

## Discounts

### Available Discounts

| Organization Type | Discount |
|-------------------|----------|
| Nonprofit Organizations | 25% |
| Academic Institutions | 40% |
| Multi-Year Commitment | Contact for quote |
| Volume Licensing (5+ sites) | Contact for quote |

### Requesting a Discount

1. Email `Trans_Track@outlook.com`
2. Provide proof of status (501(c)(3) letter, academic affiliation, etc.)
3. Specify the tier you're interested in
4. Receive discount code or adjusted invoice

---

## Support Contacts

**Sales Inquiries:**
- Email: `Trans_Track@outlook.com`
- Subject: "TransTrack License Inquiry"

**Technical Support:**
- Email: `Trans_Track@outlook.com`
- Include: Organization ID, license tier, issue description

**PayPal Payments:**
- Account: `lilnicole0383@gmail.com`

---

## Frequently Asked Questions

### Q: Can I upgrade my license tier later?

**A:** Yes! Contact sales with your current license key. You'll pay the difference between tiers, and we'll issue a new key.

### Q: What happens if I exceed my patient limit?

**A:** You'll receive a warning when approaching the limit. Once reached, you cannot add new patients until you upgrade or remove existing records.

### Q: Is there a trial for Enterprise features?

**A:** Contact us for a custom demo or extended evaluation with specific features enabled.

### Q: Can I get a refund?

**A:** Licenses are non-refundable once activated. We recommend using the Evaluation version to ensure TransTrack meets your needs.

### Q: How do I transfer my license to a colleague?

**A:** Licenses are organization-bound, not individual-bound. Any authorized user in your organization can use the licensed installation.

### Q: What if I lose my license key?

**A:** Contact support with your Organization ID and payment confirmation. We can retrieve your license information.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | January 2026 | Initial licensing model |

---

*This document is subject to change. Last updated: January 2026*
