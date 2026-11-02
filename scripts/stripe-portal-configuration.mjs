#!/usr/bin/env node
// Creates the Abluo Customer Portal configuration (ADR-041 D12) and prints its id.
//
//   STRIPE_API_KEY=rk_test_… node scripts/stripe-portal-configuration.mjs
//   STRIPE_API_KEY=rk_live_… node scripts/stripe-portal-configuration.mjs --live
//
// Payment method + invoice history only: no self-service cancellation, plan
// change or customer-detail editing (Abluo is the source of truth).
// Put the printed `bpc_…` into STRIPE_PORTAL_CONFIGURATION_ID for that environment.
// Needs the key permission "Customer portal: Write". Reads the key from the
// environment only; a live key is refused unless --live is passed.
import Stripe from 'stripe'

const key = process.env.STRIPE_API_KEY
const live = process.argv.includes('--live')
if (!key) {
  console.error('STRIPE_API_KEY is not set (use a restricted key: rk_test_… or rk_live_…).')
  process.exit(1)
}
if (/^sk_/.test(key)) {
  console.error('Refusing a full secret key (sk_…). Use a restricted key (rk_…).')
  process.exit(1)
}
if (key.startsWith('rk_live_') && !live) {
  console.error('This is a LIVE key. Pass --live to create the configuration in live mode.')
  process.exit(1)
}
if (!/^rk_(test|live)_/.test(key)) {
  console.error('Unrecognised key format (expected rk_test_… or rk_live_…).')
  process.exit(1)
}
if (live && !key.startsWith('rk_live_')) {
  console.error('--live was passed but the key is not a live key.')
  process.exit(1)
}

const stripe = new Stripe(key, { apiVersion: '2026-10-28.endive', appInfo: { name: 'Abluo' } })

const configuration = await stripe.billingPortal.configurations.create({
  name: 'Abluo — payment methods and invoices',
  business_profile: { headline: 'Abluo — manage your payment method and invoices' },
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    subscription_cancel: { enabled: false },
    subscription_update: { enabled: false },
    customer_update: { enabled: false },
  },
  metadata: { abluo: 'portal-v1' },
})
console.log(`Created portal configuration (${key.startsWith('rk_live_') ? 'LIVE' : 'test'}): ${configuration.id}`)
console.log(`STRIPE_PORTAL_CONFIGURATION_ID=${configuration.id}`)
