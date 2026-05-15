'use strict';

/**
 * TransTrack — Stripe billing & license-provisioning routes.
 *
 * Two endpoints:
 *
 *   POST /v1/billing/checkout-session    (public)
 *     Body: { tier, customerEmail, customerName, orgId, machineIds? }
 *     Creates a Stripe Checkout Session and returns its URL. The price ID is
 *     looked up from STRIPE_PRICE_ID_<TIER> env vars (e.g. STRIPE_PRICE_ID_PROFESSIONAL).
 *
 *   POST /v1/billing/webhook             (public, signature-verified)
 *     Receives Stripe webhook events. On `checkout.session.completed` we:
 *       1. Verify the Stripe signature using STRIPE_WEBHOOK_SECRET
 *       2. Pull the tier + customer metadata from the session
 *       3. Sign a TransTrack license file by shelling out to the same
 *          issuance helper used by `scripts/issue-license.mjs`
 *       4. Email the license file to the customer (best-effort; logged
 *          if SMTP isn't configured)
 *       5. Record the issued license in the `issued_licenses` table for
 *          audit + renewal tracking.
 *
 * The Stripe SDK is loaded lazily so the server still boots in
 * environments where STRIPE_SECRET_KEY is not configured (in which case
 * these endpoints simply return 503).
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Lazy-loaded Stripe SDK.
let _stripe = null;
function getStripe(config) {
  if (_stripe) return _stripe;
  if (!config.STRIPE_SECRET_KEY) return null;
  try {
    const Stripe = require('stripe');
    _stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });
    return _stripe;
  } catch {
    return null;
  }
}

/**
 * Sign a license payload using the issuance module bundled with the
 * desktop client codebase. The server runs alongside the desktop repo,
 * so we resolve the module by relative path; in a separate-repo
 * deployment this would be replaced with a vendored copy.
 */
function signLicense(payload, privateKeyPem) {
  const issuance = require(path.resolve(__dirname, '..', '..', '..', 'electron', 'license', 'issuance.cjs'));
  return issuance.signLicense(payload, privateKeyPem);
}

function hashForBinding(machineId) {
  return crypto.createHmac('sha256', 'transtrack-license-binding-v1')
    .update(machineId).digest('hex');
}

function _tierConfig(tier) {
  // Default tier limits used when Stripe metadata doesn't override.
  const defaults = {
    starter:      { maxPatients: 250,  maxUsers: 10,  maxInstallations: 2 },
    professional: { maxPatients: 1500, maxUsers: 50,  maxInstallations: 5 },
    enterprise:   { maxPatients: -1,   maxUsers: -1,  maxInstallations: -1 },
  };
  return defaults[tier];
}

async function billingRoutes(app, opts) {
  const { config } = opts;

  // ---------------------------------------------------------------------------
  // POST /v1/billing/checkout-session
  // ---------------------------------------------------------------------------
  app.post('/v1/billing/checkout-session', {
    config: { public: true },
  }, async (req, reply) => {
    const stripe = getStripe(config);
    if (!stripe) {
      return reply.code(503).send({
        error: { code: 'billing_not_configured', message: 'STRIPE_SECRET_KEY not configured on this server.' },
      });
    }

    const { tier, customerEmail, customerName, orgId, machineIds, successUrl, cancelUrl } = req.body || {};
    if (!tier || !customerEmail || !customerName || !orgId) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'tier, customerEmail, customerName, orgId required' } });
    }
    if (!['starter', 'professional', 'enterprise'].includes(tier)) {
      return reply.code(400).send({ error: { code: 'bad_tier', message: 'tier must be starter, professional, or enterprise' } });
    }

    const priceId = config[`STRIPE_PRICE_ID_${tier.toUpperCase()}`];
    if (!priceId) {
      return reply.code(503).send({ error: { code: 'price_not_configured', message: `STRIPE_PRICE_ID_${tier.toUpperCase()} not set` } });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: customerEmail,
      success_url: successUrl || `${config.STRIPE_BILLING_RETURN_URL || 'https://transtrack.health'}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${config.STRIPE_BILLING_RETURN_URL || 'https://transtrack.health'}/billing/cancel`,
      metadata: {
        transtrack_tier: tier,
        transtrack_org_id: orgId,
        transtrack_customer_name: customerName,
        transtrack_machine_ids: Array.isArray(machineIds) ? machineIds.join(',') : '',
      },
      // 14-day free trial maps to our standalone 30-day trial; we still
      // bill on day 14 so customers commit before going to renewals.
      subscription_data: {
        trial_period_days: 14,
        metadata: { transtrack_tier: tier, transtrack_org_id: orgId },
      },
    });

    return { url: session.url, sessionId: session.id };
  });

  // ---------------------------------------------------------------------------
  // POST /v1/billing/webhook
  // ---------------------------------------------------------------------------
  app.post('/v1/billing/webhook', {
    config: { public: true, rawBody: true },
  }, async (req, reply) => {
    const stripe = getStripe(config);
    if (!stripe) return reply.code(503).send({ error: 'billing not configured' });
    if (!config.STRIPE_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: 'STRIPE_WEBHOOK_SECRET not set' });
    }

    const sig = req.headers['stripe-signature'];
    let event;
    try {
      // Fastify's raw body (registered via the `rawBody` plugin or manual
      // parser) is exposed at req.rawBody. If it isn't configured, Stripe
      // signature verification cannot work — fail loudly.
      const raw = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      event = stripe.webhooks.constructEvent(raw, sig, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      app.log.warn({ err: err.message }, 'stripe webhook signature verification failed');
      return reply.code(400).send({ error: 'invalid signature' });
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(app, config, event.data.object);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(app, config, event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(app, config, event.data.object);
        break;
      default:
        app.log.debug({ type: event.type }, 'stripe event ignored');
    }

    return { received: true };
  });
}

// -----------------------------------------------------------------------------
// Event handlers
// -----------------------------------------------------------------------------

async function handleCheckoutCompleted(app, config, session) {
  app.log.info({ sessionId: session.id, customer: session.customer }, 'checkout.session.completed');

  const tier = session.metadata?.transtrack_tier;
  const orgId = session.metadata?.transtrack_org_id;
  const customerName = session.metadata?.transtrack_customer_name;
  const customerEmail = session.customer_details?.email || session.customer_email;
  const machineIds = (session.metadata?.transtrack_machine_ids || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  if (!tier || !orgId || !customerName || !customerEmail) {
    app.log.error({ sessionId: session.id }, 'checkout.session.completed missing required metadata');
    return;
  }

  // Build a one-year license. Subscriptions auto-renew the license on
  // every `invoice.paid` event after that.
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 365 * 86400e3).toISOString();
  const tierDefaults = _tierConfig(tier);
  if (!tierDefaults) {
    app.log.error({ tier }, 'unknown tier in checkout.session.completed');
    return;
  }

  const payload = {
    licenseId: 'lic_' + crypto.randomBytes(8).toString('hex'),
    protocolVersion: 1,
    customer: { name: customerName, email: customerEmail, orgId },
    tier,
    issuedAt,
    expiresAt,
    maintenanceExpiresAt: expiresAt,
    limits: tierDefaults,
    features: [], // empty array means "all features for this tier"
    machineBindings: machineIds.map((m) => hashForBinding(m)),
    metadata: {
      stripeSessionId: session.id,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
    },
  };

  const privateKeyPath = config.LICENSE_PRIVATE_KEY_PATH;
  if (!privateKeyPath || !fs.existsSync(privateKeyPath)) {
    app.log.error({ privateKeyPath }, 'LICENSE_PRIVATE_KEY_PATH missing — cannot sign license. Manual issuance required.');
    return;
  }
  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const wire = signLicense(payload, privateKeyPem);

  // Persist to issued_licenses table for audit / renewal.
  try {
    const pool = require('../db/pool');
    await pool.query(
      `INSERT INTO issued_licenses
         (license_id, org_id, customer_name, customer_email, tier,
          issued_at, expires_at, stripe_session_id, stripe_customer_id,
          stripe_subscription_id, wire_format, machine_bindings_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (license_id) DO UPDATE SET wire_format = EXCLUDED.wire_format`,
      [
        payload.licenseId, orgId, customerName, customerEmail, tier,
        issuedAt, expiresAt, session.id, session.customer,
        session.subscription, wire, machineIds.length,
      ],
    );
  } catch (err) {
    app.log.error({ err: err.message }, 'failed to persist issued license — license still emailed');
  }

  // Email the license file to the customer.
  await emailLicenseFile(app, config, { customerEmail, customerName, tier, wire, payload });

  app.log.info({ licenseId: payload.licenseId, customerEmail, tier }, 'license issued via Stripe checkout');
}

async function handleInvoicePaid(app, config, invoice) {
  // Renewal: extend an existing license's expiry by another billing
  // period. Look up by subscription_id and re-issue.
  app.log.info({ subscription: invoice.subscription }, 'invoice.paid (renewal) — re-issue path TODO');
  // TODO: lookup by subscription_id, re-issue with new expiresAt, email.
}

async function handleSubscriptionCanceled(app, config, subscription) {
  // Customer canceled — mark the license as non-renewing. The current
  // license file is still valid until its expiresAt; we just stop
  // auto-renewing on the next billing cycle.
  app.log.info({ subscription: subscription.id }, 'customer.subscription.deleted');
  try {
    const pool = require('../db/pool');
    await pool.query(
      'UPDATE issued_licenses SET canceled_at = NOW() WHERE stripe_subscription_id = $1',
      [subscription.id],
    );
  } catch (err) {
    app.log.error({ err: err.message }, 'failed to mark license canceled');
  }
}

/**
 * Best-effort email of the license file as an attachment. Uses nodemailer
 * if SMTP is configured; otherwise logs the wire string so an operator
 * can manually retrieve it from the application log.
 */
async function emailLicenseFile(app, config, { customerEmail, customerName, tier, wire, payload }) {
  if (!config.SMTP_HOST || !config.SMTP_FROM) {
    app.log.warn(
      { customerEmail, licenseId: payload.licenseId },
      'SMTP not configured; license must be sent manually. License string follows in DEBUG log.',
    );
    app.log.debug({ wire }, 'license wire string');
    return;
  }
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST, port: config.SMTP_PORT || 587,
      secure: !!config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: customerEmail,
      subject: `Your TransTrack license — ${tier}`,
      text: [
        `Hi ${customerName},`,
        '',
        `Thank you for your TransTrack subscription. Your license file is attached.`,
        '',
        `To activate:`,
        `  1. Open TransTrack on each licensed workstation.`,
        `  2. Sign in as an administrator.`,
        `  3. Go to Settings → License.`,
        `  4. Paste the contents of the attached file and click "Activate license".`,
        '',
        `Need help? Reply to this email or contact support@transtrack.health.`,
        '',
        `— TransTrack`,
      ].join('\n'),
      attachments: [{
        filename: `${payload.licenseId}.lic`,
        content: wire,
        contentType: 'text/plain',
      }],
    });
  } catch (err) {
    app.log.error({ err: err.message, customerEmail }, 'failed to email license — fall back to manual delivery');
  }
}

module.exports = billingRoutes;
