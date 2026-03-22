# Operations Manual

## Daily Operations

### Application Startup
1. Launch TransTrack from the desktop shortcut or Start menu
2. Log in with your credentials
3. If prompted to change password (first login), set a new password meeting the requirements

### Patient Management
- **Add Patient**: Navigate to Patients → Add Patient
- **Update Patient**: Click on a patient in the waitlist → Edit
- **Priority Recalculation**: Happens automatically on patient updates
- **Manual Recalculation**: Available from patient details

### Donor Matching
- **Run Matching**: Navigate to Donor Matching → select an available donor organ
- **Review Results**: Matches are sorted by compatibility score (highest first)
- **Match Components**: Priority score (40%), HLA match (25%), blood type (15%), size (10%), waitlist time (10%)

### Notifications
- In-app notifications appear for high-priority events
- Configure notification rules in Settings → Notification Rules
- Email notifications require EHR integration configuration

## Administrative Tasks

### User Management
- **Create User**: Settings → Users → Add User
- **Roles**: Admin (full access), Coordinator (patient/donor management), Viewer (read-only)
- **Deactivate User**: Settings → Users → select user → Deactivate

### Backup Procedures
1. **Manual Backup**: File → Backup Database
2. **Select Location**: Choose a secure location on a separate drive
3. **Verification**: The backup is automatically verified after creation
4. **Frequency**: Back up at least once per shift (recommended)

### Audit Log Review
1. Help → View Audit Logs
2. Filter by date range, user, or action type
3. Generate compliance reports: Settings → Compliance → Generate Report

### License Management
- View license status: Settings → License
- Activate license: Enter the license key provided by TransTrack
- License expiration warnings appear 14 days before expiry

## Troubleshooting

### Application Won't Start
1. Check that no other instance is running
2. Verify the encryption key file exists in the userData directory
3. Check the application logs in `<userData>/logs/`

### Database Errors
1. The application automatically verifies database integrity on startup
2. If corruption is detected, restore from the most recent verified backup
3. Contact TransTrack support if issues persist

### Login Issues
1. After 5 failed attempts, the account is locked for 15 minutes
2. An admin can unlock accounts from Settings → Users
3. Forgotten passwords must be reset by an admin

### Performance Issues
1. The database uses WAL mode for concurrent read performance
2. Large patient lists (1000+) may take longer to load
3. Priority recalculations are batched for efficiency

## Data Export

### CSV Export
- Available from the Waitlist page → Export → CSV
- Includes all visible patient data
- Audit logged

### PDF Report
- Available from the Waitlist page → Export → PDF
- Formatted report with priority color coding
- Suitable for printing and distribution within the facility

### FHIR Export
- Available from Patient Details → Sync to EHR
- Requires EHR integration configuration
- Exports FHIR R4 Bundle resources

## Emergency Procedures

### System Failure During Active Matching
1. Document the current state of matching manually
2. Restart the application
3. Re-run matching from the donor organ
4. Compare results with manual documentation
5. File an incident report

### Suspected Data Breach
1. **Stop**: Do not continue using the system
2. **Notify**: Contact IT administrator and Compliance Officer immediately
3. **Document**: Record the time, what was observed, and actions taken
4. **Preserve**: Do not delete or modify any data or logs
5. **Follow**: HIPAA breach notification procedures

---

*Last updated: 2026-03-21*
