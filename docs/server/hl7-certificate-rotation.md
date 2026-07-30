# HL7 MLLP TLS Certificate Rotation

## Overview

The TransTrack HL7 MLLP listener uses mutual TLS (mTLS) in production.
Both the server certificate (presented to connecting interface engines) and
the CA bundle (used to verify client certificates) must be rotated before
expiry.

## Prerequisites

- Access to the certificate authority (internal CA or public CA)
- `HL7_MLLP_TLS_CERT_FILE`, `HL7_MLLP_TLS_KEY_FILE`, `HL7_MLLP_TLS_CA_FILE`
  environment variables pointing to the mounted secret paths

## Rotation Procedure

### 1. Generate new certificates (30+ days before expiry)

```bash
# Generate new server key and CSR
openssl req -new -newkey rsa:4096 -nodes \
  -keyout mllp-server-new.key \
  -out mllp-server-new.csr \
  -subj "/CN=mllp.transtrack.example.com/O=TransTrack"

# Sign with your CA
openssl x509 -req -in mllp-server-new.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out mllp-server-new.crt -days 365 -sha256
```

### 2. Update CA bundle (if CA changed)

If the CA certificate is being rotated, update the CA bundle to include
**both** the old and new CA certificates during the transition window.
This allows existing client certificates signed by the old CA to continue
authenticating.

```bash
cat ca-old.crt ca-new.crt > ca-bundle.crt
```

### 3. Deploy new certificates

Mount the new certificate and key at the paths configured in the
environment. For Docker/Kubernetes:

```yaml
# docker-compose.yml
secrets:
  mllp_cert:
    file: ./secrets/mllp-server-new.crt
  mllp_key:
    file: ./secrets/mllp-server-new.key
  mllp_ca:
    file: ./secrets/ca-bundle.crt
```

### 4. Restart the MLLP listener

The MLLP listener reads certificates at startup. Restart the server
process to pick up the new certificates:

```bash
# Graceful restart (SIGTERM triggers graceful shutdown)
kill -TERM $(pgrep -f "node src/index.js")
```

### 5. Verify

```bash
# Test TLS handshake
openssl s_client -connect mllp.transtrack.example.com:2575 \
  -cert client.crt -key client.key -CAfile ca-bundle.crt
```

Confirm the new certificate serial number and expiry in the output.

### 6. Remove old CA (after all clients have rotated)

Once all connecting interface engines have rotated to certificates
signed by the new CA, remove the old CA from the bundle:

```bash
cp ca-new.crt ca-bundle.crt
# Restart again
```

## Monitoring

- Set up certificate expiry alerting (e.g., Prometheus `x509_cert_expiry`)
- Alert at 30 days and 7 days before expiry
- The `HL7_RAW_RETENTION_DAYS` config controls raw message retention;
  run the purge function periodically (see below)

## Raw Message Purge

Configure `HL7_RAW_RETENTION_DAYS` (default: 90). To purge old raw messages:

```sql
DELETE FROM hl7_messages
WHERE received_at < now() - ($1 || ' days')::interval
  AND processed_status IN ('accepted', 'duplicate');
```

Run this as a scheduled job (cron/pg_cron) in production.

## Rollback

If the new certificate causes connection failures:

1. Restore the old certificate and key files
2. Restart the MLLP listener
3. Investigate client-side certificate chain issues
