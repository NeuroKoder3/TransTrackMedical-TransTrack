# Legal documentation

| Document ID | TT-LEG-INDEX |
| --- | --- |
| Version | 1.0 |
| Status | Approved |
| Effective date | 2026-08-02 |
| Applies to | TransTrack 1.3.0 |
| Owner | Quality Assurance Officer |

This directory holds legal documentation that is **part of the regulated
product**: material a deploying organization needs in order to install, operate
or validate TransTrack, or that governs the software itself.

## Product legal documents

These live at the repository root because tooling and distribution channels
expect them there:

| Document | Purpose |
|---|---|
| [`../../LICENSE`](../../LICENSE) | Software licence terms |
| [`../../LEGAL_NOTICE.md`](../../LEGAL_NOTICE.md) | Ownership, authorized distribution channels, impersonation notice |
| [`../../TRADEMARK.md`](../../TRADEMARK.md) | Trademark policy and reporting of unauthorized use |
| [`../HIPAA_BAA_REQUIREMENTS.md`](../HIPAA_BAA_REQUIREMENTS.md) | What a Business Associate Agreement with the vendor must cover |
| [`../compliance/policies/BAA_TEMPLATE.md`](../compliance/policies/BAA_TEMPLATE.md) | BAA template |
| [`../LICENSING.md`](../LICENSING.md) | Licence activation and enforcement behaviour in the product |

## Commercial material is maintained outside this repository

Commercial planning material — market positioning, acquirer and partner briefs,
indicative pricing, vendor shortlists, sales outreach templates, fundraising
and corporate-formation checklists — is **not** tracked here and should not be
added.

Two documents of that kind were removed on 2026-08-02 under validation finding
L-12:

| Removed | What it was |
|---|---|
| `docs/STRATEGIC_FIT.md` | Acquisition and partnership positioning brief naming a prospective acquirer |
| `docs/legal/COMMERCIALIZATION_CHECKLIST.md` | Commercialization plan with indicative pricing, named vendor shortlists and outreach email templates |

The reason is not that the material was wrong or secret. It is that a regulated
product repository is a controlled-document set: everything in it is
potentially in scope for a validation review, an audit or a discovery request,
and every file in it carries an implicit claim to be current and controlled.
Commercial planning documents change on a sales cadence rather than a release
cadence, are owned by people outside engineering, and are governed by no
change-control procedure in
[`../compliance/policies/CHANGE_MANAGEMENT_SOP.md`](../compliance/policies/CHANGE_MANAGEMENT_SOP.md).
Keeping them here mixes two document sets with different owners, different
review cycles and different audiences, and it invites an auditor to read a
pricing sheet as though it were a controlled specification.

Both documents remain available to the people who need them, in the business
records maintained outside this repository. Their removal here is a
records-management decision, not a deletion of the underlying work.

Anything genuinely product-relevant that was recorded only in those files —
for example the fact that code-signing credentials are not yet procured, or
that no third-party penetration test has been performed — is retained as a
formal residual-risk entry in
[`../compliance/RESIDUAL_RISK.md`](../compliance/RESIDUAL_RISK.md) (RR-09,
RR-10, RR-15), where it is subject to change control and has a named owner and
closure criteria.

## What belongs here in future

Add a document to `docs/legal/` only if a deploying organization, an auditor or
a regulator would need it to install, operate, validate or lawfully use the
software. If the reader you have in mind is a prospective investor, acquirer or
customer's procurement team, it belongs in the business records instead.

## Change history

| Version | Date | Change | Author role |
|---|---|---|---|
| 1.0 | 2026-08-02 | Initial issue. Records the removal of commercial material from the regulated product repository under validation finding L-12 and states the rule for future additions. | Quality Assurance Officer |
