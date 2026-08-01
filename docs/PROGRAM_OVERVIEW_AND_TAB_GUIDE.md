# TransTrack Program Overview and Tab Guide

## What TransTrack Is

TransTrack is a desktop application for transplant-program waitlist management and operational coordination. It brings patient records, donor matching, organ-offer tracking, post-transplant follow-up, living-donor workflows, risk monitoring, reporting, interoperability, compliance evidence, and administrative controls into one system.

The program is designed to help transplant teams:

- Maintain a centralized, organization-scoped patient waitlist.
- Prioritize and filter patients using configurable scoring information.
- Evaluate potential donor-to-recipient compatibility.
- Track organ offers and their complete status history.
- Coordinate operational tasks and readiness interventions.
- Monitor post-transplant and living-donor follow-up activity.
- Import information from FHIR R4 and HL7 v2 sources.
- Produce operational, compliance, CMS, and SRTR-oriented reports.
- Protect access through authentication, role-based permissions, MFA, encrypted local storage, audit logging, and session controls.
- Back up and restore the local database.

TransTrack is a clinical and operational decision-support system. It does not replace OPTN/UNOS systems, determine organ allocation, or substitute for professional clinical judgment. Its compliance features support an organization’s controls and evidence collection; they do not by themselves certify the organization as compliant.

## Navigation and Access

The left sidebar groups tabs into Overview, Clinical, Operations, Administration, and Account. The tabs shown to a user depend on the user’s assigned role.

- All authenticated users can see Dashboard, Patients, Donor Matching, Reports, and Account Security.
- Administrators, coordinators, and physicians can see Organ Offers, Post-Transplant, Living Donors, Tasks, Prevention Queue, Risk Intel, and Predictive.
- Outcomes is available to administrators.
- HL7 Inbox is available to administrators and coordinators.
- IOTA Notices is available to administrators, coordinators, physicians, and regulators. Changing its configuration is administrator-only.
- CMS / SRTR, EHR Integration, Priority Config, Recovery, System Health, License, and Settings are administrator-only.
- Compliance is available to administrators and regulators.
- The notification bell and Log Out control appear in the top bar.

## Overview

### Dashboard

The Dashboard is the main landing page and provides an at-a-glance view of the transplant waitlist.

Primary functions:

- Displays counts for total patients, active waitlist patients, critical-priority patients, and transplanted patients.
- Shows patient cards with current waitlist and priority information.
- Filters patients by search term, organ, blood type, waitlist status, and priority level.
- Opens individual patient records for more detail.
- Recalculates priority scores using the currently configured scoring weights.

## Clinical

### Patients

The Patients tab is the central patient-record management area.

Primary functions:

- Lists patients with identifying information, blood type, needed organ, waitlist status, and priority score.
- Creates new patient records.
- Edits existing patient records.
- Imports multiple patients from a CSV file and reports rows that could not be imported.
- Stores demographic, contact, transplant, waitlist, clinical, and scoring information.

#### Patient Details

Patient Details is opened from a patient record rather than directly from the sidebar.

Primary functions:

- Displays the patient’s contact, emergency-contact, waitlist, and clinical information.
- Shows priority and status information.
- Provides access to the patient activity history.
- Supports patient-specific operational records such as readiness barriers, questionnaire-status tracking, and laboratory currency where configured.

### Donor Matching

The Donor Matching tab supports donor-organ registration and compatibility review.

Primary functions:

- Adds donor organs and records organ type, blood type, quality, procurement information, HLA information, and donor characteristics.
- Shows available, allocated, and total donor-organ counts.
- Finds potentially compatible recipients for a selected donor organ.
- Displays match results and allows authorized staff to update match status.
- Refreshes matches when donor or patient information changes.
- Provides a Match Simulator for hypothetical compatibility scenarios without creating a donor record.

Matching results are decision support only and do not constitute an allocation decision.

### Organ Offers

The Organ Offers tab records and tracks offers received for potential recipients.

Primary functions:

- Creates an offer and associates it with the applicable patient, organ, and external offer identifier.
- Filters offers by All, Pending, Provisional Acceptance, Final Acceptance, Declined, and Expired.
- Moves offers through controlled status transitions.
- Records decline reasons and other transition details.
- Displays the full event history for each offer.
- Refreshes the offer list and processes offers that have passed their expiration time.

### Post-Transplant

The Post-Transplant tab maintains follow-up information after transplantation.

After selecting a recipient, users can work with these sub-tabs:

- **Transplant Events:** Record transplant date, organ, donor details, center information, and outcome.
- **Immunosuppression:** Record medication regimens, dosage, frequency, and start or end dates.
- **Rejection:** Record rejection episodes, type, severity, treatment, and outcome.
- **Biopsies:** Record biopsy dates, results, and related notes.
- **Readmissions:** Record post-transplant admissions, discharge dates, reasons, and outcomes.

### Living Donors

The Living Donors tab manages living-donor candidates and follow-up obligations.

Primary functions:

- Creates a living-donor candidate and records intended organ, relationship, contact, and evaluation information.
- Filters donors by workflow status.
- Moves a donor through controlled evaluation and disposition states.
- Opens a donor summary for detailed management.
- Adds and reviews evaluation steps.
- Tracks OPTN Policy 14 follow-up milestones.
- Checks for overdue follow-ups and refreshes current status.

## Operations

### Reports

The Reports tab generates filtered waitlist exports.

Primary functions:

- Filters the report population by patient name or ID, organ, blood type, waitlist status, and priority.
- Shows how many patients will be included before export.
- Previews the categories of information included in the report.
- Exports a CSV spreadsheet.
- Provides a PDF export selection; PDF generation should be treated as a planned capability until production validation confirms the implementation.

Exports may contain protected health information and must be stored, transmitted, and disposed of according to facility policy.

### Tasks

The Tasks tab is the operational work queue for transplant-program staff.

Its sub-tabs are:

- **Task List:** Reviews generated and assigned tasks, filters work, and updates task status.
- **Distribution:** Summarizes tasks by type, assigned role, and source.

Primary functions:

- Generates tasks from current workflow conditions.
- Runs escalation processing for overdue or urgent work.
- Supports task acknowledgement and completion.
- Shows workload and task distribution across responsible roles.

### Prevention Queue

The Prevention Queue turns identified waitlist risks into documented interventions.

Its sub-tabs are:

- **Action Queue:** Prioritizes patients requiring intervention and allows staff to log an action.
- **Measured Outcomes:** Summarizes intervention effectiveness and observed outcomes.
- **Manager Digest:** Provides a management-level prevention summary.

Primary functions:

- Reviews prioritized patients and the conditions that placed them in the queue.
- Logs prevention actions, owners, notes, and follow-up information.
- Opens the related patient record.
- Tracks measured intervention outcomes.
- Refreshes the queue and management digest.

### Risk Intel

The Risk Intel tab consolidates operational conditions that may affect waitlist readiness.

Its sub-tabs are:

- **At-Risk Patients:** Lists patients currently requiring attention.
- **Readiness Barriers:** Reviews open operational barriers and their severity.
- **aHHQ Status:** Tracks Adult Health History Questionnaire documentation status and expiration.
- **Lab Currency:** Identifies laboratory records that are current, approaching expiration, or overdue.
- **Segment Analysis:** Groups risk information into operational segments.
- **Action Items:** Produces a prioritized list of follow-up work.

The page also provides summary counts and a refresh function. Readiness barriers and aHHQ tracking are operational tools and do not alter allocation decisions.

### Predictive

The Predictive tab provides forward-looking risk estimates for waitlist inactivation.

Its sub-tabs are:

- **High-Risk Patients:** Lists patients by predicted risk level and links to their records.
- **Factor Analysis:** Summarizes the factors contributing to predictions.

Primary functions:

- Runs or refreshes prediction calculations.
- Groups patients into critical, high, moderate, and low predicted-risk categories.
- Displays prediction age and contributing factors.
- Helps staff identify records for proactive review.

Predictions are decision support and require human review; they are not clinical determinations.

### Outcomes

The Outcomes tab is an administrator-level performance dashboard.

Its sub-tabs are:

- **Metrics Overview:** Displays risk-management and barrier-resolution measures.
- **Task Metrics:** Summarizes task automation and completion performance.
- **Snapshot History:** Preserves and reviews historical metric snapshots.

Primary functions:

- Reviews current program performance indicators.
- Saves a point-in-time metrics snapshot.
- Refreshes live metrics.
- Compares current results with prior snapshots.

### IOTA Notices

Tracks the patient notification duty created by CMS IOTA Model
§ 512.442(d): when a waitlist status change stops organ offers reaching a
patient, the hospital must notify that patient within 10 days, copy the
dialysis facility or referring provider, and file the notice in the chart.

Primary functions:

- Shows overdue notices, notices due within three days, and obligations for
  which no notice has been generated at all.
- Records delivery with its channel, distinguishing on-time from late.
- Records the copy sent to the dialysis facility or referring provider, and
  flags patients for whom no such recipient is on file.
- Displays the notice as it was issued, with a hash check that reveals any
  alteration after filing.
- Holds the centre's own notice template. Wording is authored by the
  hospital, not supplied by TransTrack, and a template missing a required
  element is rejected when it is saved. The statement that a patient cannot
  receive an organ offer while inactive is system-supplied and cannot be
  edited away.

Notices are never sent automatically. TransTrack produces and tracks them;
a person decides when one goes out and records that it did.

### HL7 Inbox

The HL7 Inbox processes HL7 v2 messages.

Primary functions:

- Accepts a raw HL7 message for parsing.
- Loads sample ADT and ORU messages for testing.
- Displays a human-readable summary and raw parsed JSON.
- Builds an HL7 acknowledgement message.
- Converts supported message content into internal TransTrack entities.
- Reports the results of ingestion.

Staff should validate source-system mappings and parsed content before relying on imported records.

## Administration

### CMS / SRTR

The CMS / SRTR tab supports program-readiness reviews and longitudinal metric tracking.

Its sub-tabs are:

- **CMS Checklist:** Reviews readiness requirements and supporting status.
- **Program Metrics:** Displays waitlist composition and operational-quality measures.
- **Metric History:** Reviews saved historical snapshots.

Primary functions:

- Shows an overall CMS survey-readiness indicator.
- Reviews checklist completion and gaps.
- Monitors program and waitlist measures.
- Saves a point-in-time snapshot.
- Refreshes current values and compares historical results.

### EHR Integration

The EHR Integration tab manages FHIR-based data exchange and imports.

Its sub-tabs are:

- **Epic on FHIR:** Connects to an authorized Epic FHIR endpoint and imports supported patient information.
- **Import Bundle:** Validates and imports a manually supplied FHIR R4 Bundle.
- **Integrations:** Creates and maintains saved EHR connection profiles and synchronization preferences.
- **Validation Rules:** Configures rules used to validate incoming data.
- **Import History:** Shows source, status, date, user, processed records, created records, updated records, and failures.

The current Epic workflow is intended for read-only import from Epic into TransTrack. Bidirectional write-back should remain disabled unless a separately validated implementation and organizational authorization are in place.

### Priority Config

The Priority Config tab controls the organization’s TransTrack priority-scoring model.

Primary functions:

- Adjusts the relative weights used in priority calculations.
- Displays the current weight distribution.
- Configures evaluation time-decay behavior.
- Activates and saves scoring configurations.
- Supports recalculation after configuration changes.

Changing scoring settings can alter displayed patient priorities and should follow the organization’s approved governance and validation process.

### Compliance

The Compliance tab provides compliance-supporting evidence and audit views.

Its sub-tabs are:

- **Validation Report:** Reviews system validation checks and their current status.
- **Audit Trail:** Searches and filters recorded system activity.
- **Barrier Audit:** Reviews changes to patient readiness barriers with user attribution.
- **Data Completeness:** Identifies missing or incomplete required information.

Primary functions:

- Displays high-level compliance and data-quality counts.
- Reviews who performed an action and when it occurred.
- Filters audit records by relevant criteria and date range.
- Supports internal review, validation, and evidence collection.

### Recovery

The Recovery tab manages local database backup and restoration.

Primary functions:

- Displays backup health, available backups, and whether a backup is overdue.
- Creates a new encrypted backup.
- Lists available backups with dates and sizes.
- Verifies backup integrity.
- Restores the application from a selected backup after confirmation.

Restoration replaces current application data with the selected backup state and should be performed only by authorized administrators under the organization’s recovery procedure.

### License

The License tab manages product activation.

Primary functions:

- Shows whether the application is in trial, active, grace-period, expired, or invalid-license mode.
- Displays organization, tier, issue and expiration dates, maintenance status, limits, and enabled features.
- Displays and copies the machine identifier used for machine-bound licensing.
- Activates a license by accepting the issued license string.
- Removes or replaces an installed license.

An expired trial or invalid license can place the application into a restricted or read-only state.

### Settings

The Settings tab provides administrator-level system visibility and user administration.

Primary functions:

- Shows total user, administrator, and recent-action counts.
- Lists users, email addresses, roles, and account creation dates.
- Provides user-management controls supported by the installed configuration.
- Displays recent system activity from the audit log.

### Account Security

The Account Security tab is available to every authenticated user.

Its sub-tabs are:

- **MFA:** Enrolls an authenticator application, confirms time-based one-time codes, and manages backup codes.
- **Password:** Changes the current account password.
- **Lockouts (Admin):** Reviews and clears account lockouts when administrator access is present.

Backup codes should be stored securely outside the application and treated like passwords.

## Notification Center and Session Controls

The notification bell in the top bar opens the user’s notification center.

Primary functions:

- Shows unread operational notifications.
- Opens related records or actions when a notification includes a destination.
- Marks notifications as read.

The top bar also provides Log Out. TransTrack includes inactivity handling, so users may be signed out automatically after the configured idle period.

## Recommended Use

- Verify imported data against the source system.
- Keep patient, offer, task, barrier, laboratory, and follow-up statuses current.
- Use role-based accounts rather than shared credentials.
- Enable MFA for privileged accounts.
- Review audit and completeness reports routinely.
- Create and verify backups according to organizational policy.
- Treat every export and backup as sensitive data.
- Validate scoring, predictive, matching, integration, and reporting behavior before production use and after material updates.

