# Billing — Stripe setup (ADR-041, Phase 3a)

What Tom sets up in Stripe and in the environment for the outbound side:
customers, products/prices, Checkout, Customer Portal, admin cancel. Webhook
setup for fulfilment is Phase 3b (it adds `STRIPE_WEBHOOK_SECRET` use and the
Events permissions below).

Tax stays OFF (`BILLING_AUTOMATIC_TAX = false` in `src/lib/billing/stripe/service.ts`)
until the accountant answers ADR-041 §7. Do not take live payments before that.

## 1. Environment variables

| Variable | Value | Where |
|---|---|---|
| `STRIPE_API_KEY` | restricted key: `rk_test_…` (local, dev, preview) / `rk_live_…` (Production only) | Vercel **Sensitive** variable, per environment; `.env.local` for local |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` of the endpoint for that environment (used by Phase 3b) | same |
| `STRIPE_PORTAL_CONFIGURATION_ID` | `bpc_…` from `scripts/stripe-portal-configuration.mjs` | same, per mode (the test and live ids differ) |

A full secret key (`sk_…`) or a key of the wrong mode disables billing
(`getStripe()` returns null; checkout shows "unavailable"). No portal
configuration id means the Portal is "unavailable" — the default Dashboard
portal (which would allow cancellation) is never used.

## 2. Restricted key permissions (finalise from request logs)

Derived from the exact SDK calls in `src/lib/billing/stripe/service.ts` and
`scripts/stripe-portal-configuration.mjs`. Everything not listed: **None**.
Stripe's documented method: run the sandbox flow below with this key, then check
the key's request log for 403s or unused permissions and adjust.

| Dashboard resource | Level | Calls that need it |
|---|---|---|
| Customers | Write | `customers.create`, `customers.update`, `customers.listTaxIds`, `customers.createTaxId` (tax IDs fall under Customers) |
| Products | Write | `products.search` (read), `products.create`, `products.update` |
| Prices | Write | `prices.retrieve`, `prices.create` |
| Checkout Sessions | Write | `checkout.sessions.create`, `.expire`, `.retrieve` |
| Subscriptions | Write | `subscriptions.update` (cancel at period end), `subscriptions.retrieve` |
| Customer portal | Write | `billingPortal.sessions.create`; `billingPortal.configurations.create` (only for the one-off script — use a separate, temporary key if you prefer) |
| Invoices | Read | `invoices.list` (the client Billing page's invoice list, `listInvoices`); Phase 3b re-fetch on `invoice.*` events |
| Events | Read | Phase 3b |
| Disputes, Charges and Refunds, Radar early fraud warnings | Read | Phase 3b alerts |
| Tax settings, Tax registrations | Read | later (Stripe Tax) |

## 3. Customer Portal configuration (once per mode)

```
STRIPE_API_KEY=rk_test_… node scripts/stripe-portal-configuration.mjs
# live: STRIPE_API_KEY=rk_live_… node scripts/stripe-portal-configuration.mjs --live
```

Creates a configuration with payment-method update and invoice history on, and
cancellation, plan changes and customer-detail editing off (ADR-041 D12). Put the
printed `bpc_…` into `STRIPE_PORTAL_CONFIGURATION_ID`. The script refuses `sk_`
keys and refuses live keys unless `--live` is given. Alternatively create the
same configuration in the Dashboard (Settings → Billing → Customer portal) and
copy its id.

## 4. Dashboard settings (Tom, per mode)

1. **Payment methods — card only.** Settings → Payment methods: create a
   dedicated payment method configuration with only Cards enabled (the code never
   passes `payment_method_types`; Checkout follows the Dashboard configuration).
   Make it the default for the account or the one Checkout uses.
2. **Smart Retries and failed payments** (ADR-041 D5). Settings → Billing →
   Subscriptions and emails: Smart Retries on; after the final retry **mark the
   subscription as unpaid** (never cancel); failed-payment emails on.
3. **Customer emails.** Invoice and receipt emails on (Abluo sends no billing
   emails in v1).
4. **Customer portal** as in section 3; business details/links optional.
5. **Tax:** leave Stripe Tax off; `automatic_tax` is disabled in Checkout. Prices
   are created with `tax_behavior: exclusive`. No tax code is set on Products; the
   Dashboard default product tax code applies until the accountant picks one.
6. **Branding:** invoice footer / reverse-charge wording comes later (issuer
   `invoice_texts`, ADR-041 D13).

## 5. Sandbox test steps (Abluo Sandbox + Stripe sandbox)

Prerequisites: migrations 057 and 058 applied on the Abluo Sandbox database; a
Stripe **sandbox** with the `rk_test_` key above; one row in `billing_issuers`
with status `active` (e.g. key `tmz-de`, country `DE`, `active_from` set).

1. Admin: give a test project a **Stripe** agreement (amount, interval, payment
   due date) and the client a complete billing profile (email, country; for a
   business: legal name + VAT). A business VAT must be `verified` — until Phase 3b
   sets it from Stripe, record it as verified manually in the sandbox database
   (`billing_profiles.vat_verification = 'verified'` with `vat_verified_at`), or
   test an individual first.
2. Create the portal configuration (section 3) and set the three env vars.
3. As the client Owner, open `/{locale}/{project}/billing` and press the pay
   button. Expect a Stripe-hosted Checkout page for "Abluo — {site}". Pay with
   `4242 4242 4242 4242`. Failure cases: `4000 0000 0000 0341` (attached, then
   declines), `4000 0000 0000 9995` (insufficient funds).
4. Press the pay button twice: the second click returns the same session URL
   (≥ 1 h left). After editing the terms in admin (terms version +1) a new click
   expires the old session and opens a new one.
5. Check in Stripe: one Customer per client (with the address and, for business,
   an `eu_vat` tax ID), one Product per project with `metadata.abluo_project_id`,
   a Price (`tax_behavior: exclusive`), the session carries an
   `integration_identifier` `abluo-checkout-xxxxxxxx` and no payment method types.
6. After payment the subscription appears in Stripe; linking it to the project is
   Phase 3b (webhook). Until then you can link by calling
   `billing_sync_subscription` by hand for testing.
7. Portal button: opens the portal with only payment methods and invoices.
8. Admin (billing.admin holder): "cancel at period end" on a linked subscription;
   verify `cancel_at_period_end` in Stripe and in `billing_subscriptions`, plus an
   `admin_audit_log` row `billing.subscription.cancel_at_period_end`.
9. Review the key's request log in the Dashboard (Developers → API keys → the key
   → Logs) for permission errors; trim unused permissions.

## 6. Known limits (v1)

- `billing_issuers.stripe_account_id` is stored but not used to route calls: one
  key = one Stripe account (a second issuer needs its own key/deployment config —
  ADR-041 D13, not built).
- A changed VAT number adds a new tax ID to the customer; old ones are not deleted.
- Session creation uses an idempotency key per attempt. If Stripe created a session but storing the row failed, a retry reuses the same key with a different `expires_at` and Stripe rejects it (the client sees "failed"; the stray session expires by itself after 24 h, and the attempt number advances only once a row exists).
