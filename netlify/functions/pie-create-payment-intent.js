// pie-create-payment-intent.js
// Creates a Stripe PaymentIntent for PIE sponsorship checkout.
//
// Isolation note: PIE shares a Stripe account with G2.0/THA. Every PaymentIntent
// created here is tagged `initiative: "pie"` so reporting, reconciliation, and any
// future webhook handlers can filter cleanly.
//
// Pricing is computed server-side from `tier`. Custom amounts are clamped to
// $250 — $100,000. Never trust an amount sent from the client.

const stripe = require('stripe')(process.env.PIE_STRIPE_SECRET_KEY);

const ALLOWED_ORIGIN = 'https://pie.manumental.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const TIER_AMOUNTS = {
  supporter: 50000, // $500.00 — Pilot Supporter
  founding:  250000, // $2,500.00 — Founding Coalition Member
};

const TIER_LABELS = {
  supporter: 'PIE Pilot Supporter',
  founding:  'PIE Founding Coalition Member',
  custom:    'PIE Custom Sponsorship',
};

const CUSTOM_MIN_CENTS = 25000;     // $250.00
const CUSTOM_MAX_CENTS = 10000000;  // $100,000.00

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message, statusCode = 400) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify({ error: message }) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST')    return bad('Method Not Allowed', 405);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return bad('Invalid JSON.');
  }

  const { tier, customAmount, name, email, organization, role, message } = body;

  // Required fields
  if (!name || typeof name !== 'string' || name.length > 100) return bad('Invalid name.');
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 200) return bad('Invalid email address.');
  if (!organization || typeof organization !== 'string' || organization.length > 200) return bad('Invalid organization.');

  // Optional fields
  if (role && (typeof role !== 'string' || role.length > 200)) return bad('Invalid role.');
  if (message && (typeof message !== 'string' || message.length > 500)) return bad('Message too long.');

  // Amount resolution
  let amount;
  if (tier === 'supporter' || tier === 'founding') {
    amount = TIER_AMOUNTS[tier];
  } else if (tier === 'custom') {
    const dollars = Number(customAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) return bad('Invalid custom amount.');
    const cents = Math.round(dollars * 100);
    if (cents < CUSTOM_MIN_CENTS) return bad(`Custom sponsorship minimum is $${CUSTOM_MIN_CENTS / 100}.`);
    if (cents > CUSTOM_MAX_CENTS) return bad(`Custom sponsorship maximum is $${CUSTOM_MAX_CENTS / 100}. Contact us for larger gifts.`);
    amount = cents;
  } else {
    return bad('Invalid tier.');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      receipt_email: email,
      statement_descriptor_suffix: 'PIE SPONSOR',
      description: TIER_LABELS[tier],
      metadata: {
        initiative:      'pie',
        product:         TIER_LABELS[tier],
        tier,
        customer_name:   name.trim(),
        customer_email:  email.toLowerCase().trim(),
        organization:    organization.trim(),
        role:            (role || '').trim(),
        message:         (message || '').trim(),
      },
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret }),
    };
  } catch (err) {
    console.error('PIE payment intent error:', err.message);
    return bad('An internal error occurred. Please try again.', 500);
  }
};
