# TransTrack Stripe Billing — Operator's Guide

This document explains how to wire Stripe Checkout + webhooks to
automatic TransTrack license issuance. **You can ship the product
without this** — manual `npm run license:issue` works fine for the
first dozen customers. Build this once you have ≥20 customers or want
self-serve sign-up.

## Architecture

```
                         ┌────────────────────────┐
                         │  Customer browser      │
                         └────────────┬───────────┘
                                      │ 1. POST /v1/billing/checkout-session
                                      ▼
                       ┌──────────────────────────────┐
                       │  TransTrack server (Fastify) │
                       └────────────┬─────────────────┘
                                    │ 2. stripe.checkout.sessions.create()
                                    ▼
                          ┌────────────────────┐
                          │       Stripe        │
                          └─────────┬──────────┘
                                    │ 3. customer pays
                                    │ 4. POST /v1/billing/webhook
                                    ▼
                       ┌──────────────────────────────┐
                       │  TransTrack server           │
                       │   - verify signature         │
                       │   - sign LIC1.* license      │
                       │   - INSERT issued_licenses   │
                       │   - email license to customer│
                       └──────────────────────────────┘
```

## One-time setup

### 1. Create a Stripe account

Sign up at https://dashboard.stripe.com. Create products + recurring prices
for each tier and copy the price IDs (`price_xxxxx`):

| Tier         | Default limits                                | Env var to set                  |
| ------------ | --------------------------------------------- | ------------------------------- |
| starter      | 250 patients, 10 users, 2 installs            | `STRIPE_PRICE_ID_STARTER`       |
| professional | 1500 patients, 50 users, 5 installs           | `STRIPE_PRICE_ID_PROFESSIONAL`  |
| enterprise   | unlimited                                     | `STRIPE_PRICE_ID_ENTERPRISE`    |

### 2. Configure the webhook

In the Stripe dashboard:
- **Endpoint URL:** `https://api.transtrack.health/v1/billing/webhook`
- **Events to send:**
  - `checkout.session.completed`
  - `invoice.paid`
  - `customer.subscription.deleted`

Stripe shows a signing secret (`whsec_xxxxx`) — copy it.

### 3. Place the publisher private key on the server

The webhook signs licenses with the same Ed25519 private key used by
`npm run license:issue`. Mount it on the server as a read-only secret
(Docker secret, Kubernetes secret, or AWS Parameter Store) and set:

```
LICENSE_PRIVATE_KEY_PATH=/run/secrets/license-private.pem
```

The file MUST have mode `0o400` (read-only to the owning UID) and the
server process must run as that UID.

### 4. Set environment variables

```bash
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_BILLING_RETURN_URL=https://app.transtrack.health
STRIPE_PRICE_ID_STARTER=price_xxxxx
STRIPE_PRICE_ID_PROFESSIONAL=price_xxxxx
STRIPE_PRICE_ID_ENTERPRISE=price_xxxxx

LICENSE_PRIVATE_KEY_PATH=/run/secrets/license-private.pem

# Email delivery
SMTP_HOST=smtp.postmarkapp.com    # or sendgrid, mailgun, etc.
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<api-key>
SMTP_FROM='TransTrack <sales@transtrack.health>'
```

### 5. Install optional dependencies

```bash
cd server
npm install stripe nodemailer
```

(These are in `optionalDependencies` so the server still boots without
them; the billing routes return `503` until both are installed AND
configured.)

### 6. Run the new migration

```bash
cd server
npm run migrate
```

This creates the `issued_licenses` table.

## How customers buy

### Self-serve flow (typical)

1. Customer visits your pricing page (e.g.
   `https://transtrack.health/pricing`).
2. JS on that page calls:

   ```js
   const res = await fetch('https://api.transtrack.health/v1/billing/checkout-session', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       tier: 'professional',
       customerName: form.orgName.value,
       customerEmail: form.email.value,
       orgId: slugify(form.orgName.value),
       machineIds: [], // optional — fill in if you collect this up front
     }),
   });
   const { url } = await res.json();
   window.location = url;       // redirects to Stripe Checkout
   ```

3. Customer enters payment details on Stripe's hosted page.

4. Stripe POSTs to `/v1/billing/webhook`. The server:
   - verifies the Stripe signature (refuses if invalid)
   - signs an Ed25519 license file
   - persists to `issued_licenses`
   - emails the `.lic` file to `customerEmail`

5. Customer opens the email, downloads the attachment, opens TransTrack,
   pastes into **Settings → License**, clicks Activate.

### Enterprise / contract sales (manual)

Skip the Checkout step entirely. Use `npm run license:issue` directly
and email the file yourself. The webhook path is purely an automation
convenience; it never replaces the contractual sales motion for large
deals.

## Testing the webhook locally

```bash
# In one terminal:
stripe listen --forward-to localhost:8080/v1/billing/webhook
# Stripe prints a webhook secret (whsec_xxx) — set it in your env.

# In another terminal:
stripe trigger checkout.session.completed
```

Check the server log; you should see a line like
`license issued via Stripe checkout`.

## What this does NOT do

- It does NOT replace your EULA, MSA, or BAA. Stripe handles money; the
  contractual documents still have to be sent and signed separately.
- It does NOT auto-renew licenses yet — the `invoice.paid` handler is a
  stub. You can either renew manually each cycle or wire up that handler
  to re-issue + re-email on every successful invoice.
- It does NOT issue machine-bound licenses by default in the self-serve
  flow because you don't know the customer's machine IDs at checkout
  time. The license is issued unbound; the customer can request a
  machine-bound replacement after install via a support ticket.
