const Stripe = require('stripe');
const env = require('../config/env');

let stripeClient = null;

/**
 * Lazily instantiated so the app can boot (and every other module keeps
 * working) even before real Stripe keys are configured in .env — the error
 * only surfaces when a Stripe route is actually hit.
 */
function getStripeClient() {
  if (!env.integrations.stripe.secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Add your Stripe test-mode secret key to .env — see .env.example.'
    );
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.integrations.stripe.secretKey, { apiVersion: '2024-04-10', timeout: 15000, maxNetworkRetries: 2 });
  }
  return stripeClient;
}

/**
 * Step 1 of onboarding: creates a Stripe Express connected account for a
 * hostel that doesn't have one yet. Express keeps most compliance/UI on
 * Stripe's side, which is the right choice here since HostelHive's Admin
 * is onboarding on behalf of a real-world owner, not building their own
 * full custom payments UI.
 */
async function createConnectedAccount({ email, hostelName }) {
  const stripe = getStripeClient();
  return stripe.accounts.create({
    type: 'express',
    email,
    business_type: 'individual',
    business_profile: { name: hostelName },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
}

/**
 * Step 2 of onboarding: a one-time-use hosted link where the Admin enters
 * the hostel owner's bank/business details. Must be re-generated (it
 * expires quickly) — see hostelController.getStripeOnboardingLink.
 */
async function createOnboardingLink(stripeAccountId) {
  const stripe = getStripeClient();
  return stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: env.integrations.stripe.connectRefreshUrl,
    return_url: env.integrations.stripe.connectReturnUrl,
    type: 'account_onboarding',
  });
}

async function retrieveAccount(stripeAccountId) {
  const stripe = getStripeClient();
  return stripe.accounts.retrieve(stripeAccountId);
}

async function retrieveCheckoutSession(sessionId) {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.retrieve(sessionId);
}

/**
 * Creates a Checkout Session as a "destination charge": the resident pays
 * on Stripe's hosted page, and funds are transferred directly to the
 * hostel's connected account (transfer_data.destination). HostelHive's own
 * Stripe balance is never credited. application_fee_amount is left unset
 * (0) — per project decision, HostelHive takes no platform fee and is
 * purely a record-keeper.
 */
async function createCheckoutSession({
  paymentId,
  invoiceId,
  bookingId,
  unitAmountCents,
  amount,
  originalAmountPKR,
  exchangeRatePKRPerUSD,
  currency = 'usd',
  customerEmail,
  description,
  stripeAccountId,
  expiresAt,
}) {
  const stripe = getStripeClient();
  const finalCents =
    unitAmountCents !== undefined
      ? Math.round(unitAmountCents)
      : Math.round(Number(amount) * 100);

  const productData = {
    name: description || 'HostelHive Rent Payment',
  };
  if (originalAmountPKR) {
    productData.description = `Original invoice amount: PKR ${Number(originalAmountPKR).toLocaleString()}`;
  }

  const metadata = {
    ...(paymentId ? { paymentId: String(paymentId) } : {}),
    invoiceId: invoiceId ? invoiceId.toString() : '',
    stripeAccountId: stripeAccountId || '',
  };
  if (originalAmountPKR !== undefined) {
    metadata.originalAmountPKR = originalAmountPKR.toString();
  }
  if (exchangeRatePKRPerUSD !== undefined) {
    metadata.exchangeRatePKRPerUSD = exchangeRatePKRPerUSD.toString();
  }

  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency,
          unit_amount: finalCents,
          product_data: productData,
        },
        quantity: 1,
      },
    ],
    metadata,
    ...(stripeAccountId ? { payment_intent_data: { metadata, transfer_data: { destination: stripeAccountId } } } : {}),
    ...(expiresAt ? { expires_at: Math.floor(new Date(expiresAt).getTime() / 1000) } : {}),
    success_url: checkoutReturnUrl(env.integrations.stripe.successUrl, { invoiceId, bookingId, session_id: '{CHECKOUT_SESSION_ID}' }),
    cancel_url: checkoutReturnUrl(env.integrations.stripe.cancelUrl, { invoiceId, bookingId }),
  }, paymentId ? { idempotencyKey: `hostelhive-checkout-${paymentId}` } : undefined);
}

function checkoutReturnUrl(base, values) {
  const url = new URL(base);
  Object.entries(values).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, String(value));
  });
  return url.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
}

/**
 * Verifies and parses a raw webhook payload using the signing secret.
 * Must be called with the RAW (unparsed) request body — see app.js.
 */
function constructWebhookEvent(rawBody, signatureHeader) {
  const stripe = getStripeClient();
  if (!env.integrations.stripe.webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set. Add it to .env — see .env.example.');
  }
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, env.integrations.stripe.webhookSecret);
}

module.exports = {
  getStripeClient,
  createConnectedAccount,
  createOnboardingLink,
  retrieveAccount,
  retrieveCheckoutSession,
  createCheckoutSession,
  constructWebhookEvent,
};
