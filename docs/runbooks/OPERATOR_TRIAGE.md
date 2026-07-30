# Operator Triage Runbook

Quick-reference procedures for common operational incidents.

---

## 1. Failed FHIR Subscription Delivery

**Symptoms**: `fhir_subscription_deliveries` rows stuck in `pending` status;
subscriber endpoint not receiving notifications.

**Steps**:

1. Check the `fhir_subscription_deliveries` table for error details:
   ```sql
   SELECT id, subscription_id, status, error, created_at
   FROM fhir_subscription_deliveries
   WHERE status != 'completed'
   ORDER BY created_at DESC LIMIT 20;
   ```
2. Verify the subscriber endpoint is reachable from the server:
   ```bash
   curl -v <endpoint_url>
   ```
3. Check server logs for delivery errors:
   ```bash
   grep -i "fhir.*delivery\|subscription" /var/log/transtrack/server.log | tail -50
   ```
4. If the endpoint is temporarily down, deliveries will retry automatically
   (exponential backoff). If the endpoint URL changed, update the
   Subscription resource and manually retry:
   ```sql
   UPDATE fhir_subscription_deliveries SET status = 'pending', error = NULL
   WHERE subscription_id = '<id>' AND status = 'failed';
   ```
5. If deliveries are permanently failing, disable the subscription via the
   FHIR API (`DELETE /fhir/Subscription/<id>`) and notify the subscriber.

---

## 2. Stuck Bulk Export

**Symptoms**: `GET /fhir/$export-status/<jobId>` returns `202 Accepted`
indefinitely; no NDJSON files generated.

**Steps**:

1. Check the export job status in the database:
   ```sql
   SELECT * FROM bulk_export_jobs WHERE id = '<jobId>';
   ```
2. Look for worker process errors in server logs.
3. If the worker died mid-export, restart the server process. The job will
   resume or can be canceled:
   ```bash
   curl -XDELETE -H "Authorization: Bearer $TOKEN" \
     http://localhost:8080/fhir/\$export-status/<jobId>
   ```
4. Re-initiate the export:
   ```bash
   curl -XPOST -H "Authorization: Bearer $TOKEN" \
     -H "Prefer: respond-async" \
     http://localhost:8080/fhir/Patient/\$export
   ```

---

## 3. EHR Downtime (HL7 / FHIR Source Unavailable)

**Symptoms**: No new HL7 messages arriving; MLLP connection errors in logs.

**Steps**:

1. TransTrack's MLLP listener is passive — it does not poll the EHR. If
   the EHR stops sending, no action is needed on the TransTrack side.
2. Verify the listener is still running:
   ```bash
   netstat -tlnp | grep 2575
   ```
3. When the EHR recovers, it will resend queued messages. Verify receipt:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8080/hl7/messages?limit=10
   ```
4. If messages were lost during the outage, coordinate with the EHR team
   to replay from the interface engine (Mirth/Rhapsody) queue.
5. For Epic on FHIR imports, the server-side pull (`/integrations/epic/import`)
   can be re-triggered manually once the Epic FHIR endpoint is back.

---

## 4. Desktop Backup Restore Failure

**Symptoms**: Restore from backup fails with integrity check or decryption error.

**Steps**:

1. Verify the backup file is not corrupted:
   - Navigate to **Recovery → Verify Backup** in the desktop app.
   - Check `checksumVerified` and `integrityCheckPassed`.
2. If checksum fails, the backup file was modified or truncated during
   transfer. Use a different backup copy.
3. If decryption fails, the encryption key does not match the backup.
   - Locate the correct key file (`.transtrack-key`) from the time the
     backup was created.
   - If the key was rotated between backup and restore, use the pre-rotation
     key.
4. If the database was corrupted, try restoring from an older backup.
5. As a last resort, use the disaster recovery export (`Recovery → Export
   All Data`) to extract data in JSON format from whichever database
   instance is still readable.
6. Document the incident per HIPAA breach notification requirements if
   data loss occurred.

---

## 5. Server Database Migration Failure

**Symptoms**: `node src/db/migrate.js up` fails with SQL error.

**Steps**:

1. Check which migration failed:
   ```bash
   node src/db/migrate.js status
   ```
2. Read the failing SQL file in `server/src/db/migrations/`.
3. Common causes:
   - Table already exists (rerun after partial apply): drop the partially
     created objects manually, then rerun.
   - Missing prerequisite migration: ensure migrations run in order.
4. Migrations are forward-only. Do not manually edit applied migration
   files — write a new migration to fix the issue.
5. After fixing, rerun: `node src/db/migrate.js up`.
