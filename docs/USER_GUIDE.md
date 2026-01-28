# TransTrack User Guide

## Getting Started

### Installation

1. Download the appropriate installer for your operating system:
   - **Windows**: TransTrack-1.0.0-x64.exe
   - **macOS**: TransTrack-1.0.0.dmg
   - **Linux**: TransTrack-1.0.0.AppImage

2. Run the installer and follow the on-screen instructions.

3. Launch TransTrack from your applications menu or desktop shortcut.

### First-Time Setup

When you first launch TransTrack, you'll be prompted to log in:

- **Default Administrator Account**:
  - Email: `admin@transtrack.local`
  - Password: `admin123`

> **Important**: Change the default password immediately after first login!

---

## Dashboard

The dashboard provides an at-a-glance view of your transplant waitlist:

### Statistics Cards

- **Total Patients**: All patients in the system
- **Active on List**: Patients currently waiting for transplant
- **Critical Priority**: Patients with priority score ≥ 80
- **Transplanted**: Successfully transplanted patients

### Filtering

Use the filter bar to narrow down the patient list:
- Search by name or patient ID
- Filter by organ type
- Filter by blood type
- Filter by waitlist status
- Filter by priority level

### Recalculate Priorities

Click "Recalculate Priorities" to update all patient priority scores based on current data.

---

## Patient Management

### Adding a New Patient

1. Navigate to **Patients** from the navbar
2. Click **Add Patient**
3. Fill in required information:
   - Patient ID
   - Name
   - Date of Birth
   - Blood Type
   - Organ Needed
   - Medical Urgency

4. Add optional clinical data:
   - HLA Typing
   - MELD/LAS scores
   - PRA percentage
   - Functional status

5. Click **Save**

### Editing a Patient

1. Find the patient in the list
2. Click **Edit**
3. Modify information as needed
4. Click **Save**

### Priority Score

Each patient is assigned a priority score (0-100) based on:
- Medical urgency (30%)
- Time on waitlist (25%)
- Organ-specific scores (25%)
- Evaluation recency (10%)
- Blood type rarity (10%)

---

## Donor Matching

### Registering a Donor Organ

1. Navigate to **Donor Matching**
2. Click **Add Donor Organ**
3. Enter donor information:
   - Donor ID
   - Organ Type
   - Blood Type
   - HLA Typing
   - Donor age and size
   - Organ quality

4. Click **Save**

### Finding Matches

1. Click **Find Matches** on a donor organ
2. The system will calculate compatibility with all active patients
3. Results show:
   - Compatibility score
   - HLA match details
   - Size compatibility
   - Virtual crossmatch result
   - Predicted graft survival

### Match Simulator

Use the Match Simulator to test hypothetical scenarios without creating actual donor records.

---

## Reports

### Generating Reports

1. Navigate to **Reports**
2. Select report type:
   - Waitlist Report
   - Priority Distribution
   - Organ Type Analysis

3. Apply filters as needed
4. Click **Export** to download

### Export Formats

- CSV (compatible with Excel)
- PDF (for printing)

---

## EHR Integration

### Importing FHIR Data

1. Navigate to **EHR Integration**
2. Click **Import FHIR Data**
3. Paste or upload FHIR R4 Bundle
4. Click **Validate** to check data
5. Click **Import** to add patients

### Supported FHIR Resources

- Patient
- Condition
- Observation

---

## Readiness Barriers (Non-Clinical)

### Overview

The Readiness Barriers feature helps track **operational workflow items** that may affect a patient's readiness for transplant coordination. This feature is:

- **Non-Clinical**: Does not contain medical diagnoses or clinical assessments
- **Non-Allocative**: Does not affect organ allocation decisions
- **Operational Only**: Supports care team coordination

> **Important**: This feature does NOT replace UNOS/OPTN systems or perform any allocation decisions.

### Accessing Readiness Barriers

1. Navigate to a **Patient Details** page
2. Scroll to the **Readiness Barriers** section
3. View current barriers and their status

### Adding a Barrier

1. Click **Add Barrier** on the patient's detail page
2. Select the barrier type:
   - Pending testing
   - Insurance clearance
   - Transportation plan
   - Caregiver support
   - Housing/distance
   - Psychosocial follow-up
   - Financial clearance
   - Other non-clinical

3. Set the status (Open, In Progress, or Resolved)
4. Select the operational risk level (Low, Moderate, High)
5. Assign the responsible team (Social Work, Financial, Coordinator, Other)
6. Optionally set a target resolution date
7. Add brief notes (max 255 characters, non-clinical only)
8. Click **Add Barrier**

### Managing Barriers

**Update Status**:
- Click the edit icon to modify barrier details
- Change status as work progresses

**Mark Resolved**:
- Click the checkmark icon to resolve a barrier
- Resolved barriers are archived but remain in audit history

**View Resolved**:
- Click "Show Resolved" to view historical barriers

### Risk Dashboard Integration

The **Risk Dashboard** includes a Readiness Barriers tile showing:
- Number of patients with open barriers
- Percentage of active waitlist affected
- Breakdown by barrier type and risk level

Access the full barrier analysis in the **Readiness Barriers** tab.

### Compliance Center

Barrier audit trails are available in the **Compliance Center**:
1. Navigate to Compliance Center
2. Select the **Barrier Audit** tab
3. Filter by date range
4. View all barrier changes with user attribution

### Best Practices

1. **Keep notes brief and factual**: Avoid clinical language
2. **Update status promptly**: Helps team coordination
3. **Set realistic target dates**: Supports workflow planning
4. **Resolve barriers when complete**: Keeps dashboard accurate
5. **Use appropriate risk levels**: Helps prioritize workflow

### Example Language

| Do Use | Don't Use |
|--------|-----------|
| "Insurance pre-auth pending" | "Patient has anxiety about coverage" |
| "Transportation arranged" | "Patient cannot drive due to condition" |
| "Follow-up scheduled" | "Patient needs psychiatric evaluation" |
| "Caregiver confirmed" | "Patient's family is unreliable" |

---

## Settings

### User Management (Admin Only)

1. Navigate to **Settings**
2. Manage users:
   - Create new users
   - Assign roles (admin, user, viewer)
   - Deactivate accounts

### Priority Weights (Admin Only)

1. Navigate to **Priority Config**
2. Adjust weighting factors
3. Save changes
4. Recalculate patient priorities

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+E | Export data |
| Ctrl+I | Import data |
| Ctrl+R | Refresh current view |
| Ctrl+N | Add new record |

---

## Troubleshooting

### Login Issues

- Ensure you're using the correct email and password
- If locked out, contact your administrator
- For first-time setup, use default credentials

### Performance Issues

- Close unnecessary applications
- Ensure adequate disk space
- Check system requirements

### Data Backup

- Use **File → Backup Database** regularly
- Store backups in a secure location
- Test restore procedures periodically

---

## Support

For technical support or feature requests:
- Email: Trans_Track@outlook.com
- Documentation: https://github.com/NeuroKoder3/TransTrackMedical-TransTrack

---

*TransTrack v1.0.0 - Compliant Transplant Waitlist Management*
