# Breach Notification Policy (Template)

| Document control | |
|---|---|
| Document ID | TT-POL-BN-001 |
| Version | 1.0 |

## 1. Purpose

Implement the HIPAA Breach Notification Rule (45 CFR §§164.400–414) and any
applicable state breach-notification laws.

## 2. Definitions

* **Breach** — acquisition, access, use, or disclosure of unsecured PHI in a
  manner not permitted by the HIPAA Privacy Rule which compromises the
  security or privacy of the PHI.
* **Unsecured PHI** — PHI not rendered unusable, unreadable, or indecipherable
  to unauthorized persons through one of the technologies and methodologies
  specified in HHS guidance (encryption, destruction). PHI in TransTrack is
  considered **secured** while it remains in the SQLCipher-encrypted database
  with keys uncompromised.
* **Discovery** — first day on which the breach is known, or by reasonable
  diligence should have been known, to any workforce member.

## 3. Risk assessment

Per §164.402, conduct a four-factor risk assessment for any impermissible
use/disclosure of PHI:

1. Nature and extent of PHI involved (identifiers, sensitivity).
2. Unauthorized person who used the PHI or to whom it was disclosed.
3. Whether the PHI was actually acquired or viewed.
4. Extent to which the risk to the PHI has been mitigated.

Documented presumption of breach unless the risk assessment demonstrates a low
probability of compromise.

## 4. Notifications

### 4.1 Individuals (§164.404)

* Method: written notice by first-class mail (or email if individual has
  consented).
* Timing: ≤60 calendar days from discovery.
* Content: brief description, type of PHI, steps individual should take,
  what entity is doing, contact information.

### 4.2 Media (§164.406)

* Triggered when ≥500 individuals in a single state/jurisdiction.
* Method: prominent media outlets in the state/jurisdiction.
* Timing: ≤60 calendar days.

### 4.3 HHS Secretary (§164.408)

* ≥500 individuals: notify concurrently with individual notice.
* <500 individuals: log and submit annually within 60 days of calendar year end.

### 4.4 Business Associates (§164.410)

* Notify Covered Entity ≤60 days of discovery.

### 4.5 State authorities

* Notify per applicable state law (varies by state).

## 5. Documentation

For each event:

* Risk assessment (four-factor analysis)
* Notification copies and timestamps
* HHS submission confirmation
* Media releases (if applicable)
* Lessons learned
* Risk Register update

Retention: 6 years.

## 6. Workforce training

All workforce members receive annual training on identifying and reporting
suspected breaches.

| Role | Signature | Date |
|---|---|---|
| HIPAA Privacy Officer | | |
| ISO | | |
| Legal Counsel | | |
