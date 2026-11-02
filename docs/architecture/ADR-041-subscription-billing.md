# ADR-041 — Subscription billing (Stripe Billing, per project)

**Status:** Accepted (Tom, 2026-10-30); **architecture settled 2026-11-02**, so no further scope. Migration 057: final safety review done, rehearsed on the Abluo Sandbox, **approved in principle — not applied to the Abluo project until Tom authorises it explicitly**. Pure core (`src/lib/billing/lifecycle.ts`, `locks.ts`) built and tested, **not wired** into the application.
**Date:** 2026-10-30
**Owner:** Tom
**Relates:** ADR-017/028 (`TenantAuthorizationContext`, permissions, support mode), ADR-029 (tenant surfaces and the configuration boundary), ADR-018 (forms), ADR-038 D8 (shared environments and the Abluo Sandbox), ADR-034 (apex → www)
**Out of scope:** Italian e-invoicing (separate integration), Stripe Connect (tenants getting paid), automatic website suspension.

---

## Context

Abluo starts charging clients. Prices are negotiated per website and set by a Super Admin. Stripe collects the money and handles renewals. A client (tenant) can own several websites (projects), launched months apart. Each website has its own price and its own renewal date. A failed payment must never take a website offline, and one website's problem must never restrict another.

## 1. Verified facts this ADR builds on (2026-10-30)

| Fact | Evidence |
|---|---|
| Permissions are resolved per request into one `ProjectGrant` per project plus one `TenantGrant` per client. `can()` looks up only the grant of the scope it is asked about. | `src/lib/api/tenant-context.ts`, `src/lib/authz/check.ts` |
| Every dashboard page and server action resolves through that context (`getTenantAuthorizationContext`, `resolveProjectAction`). The only `'use server'` files outside it are harmless: What's New dismissal, invite accept, presence. | source scan |
| Support mode already strips write permissions per context. `isWritePermission()` = "not `*.read`". | `src/lib/support/state.ts` |
| `billing.invoice.read` (tenant, Owner, grantable) and `billing.manage` (tenant, Owner) already exist. | `src/lib/authz/permissions.ts`, migration 029 |
| `projects.status` decides whether a website is served. | `servesOnHostKind()` in `src/lib/tenancy/host-scope.ts` |
| Form definitions are **tenant-owned** (shared by a client's websites) and editable only by Abluo admins: `forms.definition.manage` has no default roles, and definitions live in Studio. Notification recipients use `site.details.write`. | `src/lib/modules/registry.ts`, `src/lib/notifications/form-recipients-service.ts` |
| The only table writes a signed-in client can make directly through the Data API are `form_submissions.status` (needs `forms.submission.update`) and their own `profiles.full_name`. | migrations 028, 030 |
| dev, preview and production share one Supabase project. **Abluo Sandbox** is for tests and rehearsals. Runtime environment detection exists (`resolveAccessEnvironment()`). Vercel crons run on production only. | `docs/engineering/shared-environments.md`, `src/lib/access/environment.ts` |
| `src/proxy.ts` never sees `/api/*`. The apex domain 308s to `www`. | proxy matcher; ADR-034 |
| Vercel is on the Hobby plan, which is non-commercial. | infrastructure handover 2026-10-26 |
| **Stripe:** paying the most recent non-voided invoice moves `past_due` **and `unpaid`** subscriptions back to `active`. While `unpaid`, Stripe attempts no payment and new invoices stay `draft`. After the final retry a subscription can be canceled, marked `unpaid`, or left `past_due`. Checkout Sessions expire after 30 min to 24 h (default 24 h) and fire `checkout.session.expired`. A first payment that fails or needs action leaves the subscription `incomplete` for 23 h, then `incomplete_expired`. **Delayed methods (e.g. SEPA) can make a subscription `active` before the money arrives**; if that payment later fails, the invoice is voided and the subscription stays `active`. | docs.stripe.com: billing/subscriptions/overview, payments/checkout/how-checkout-works, checkout/fulfillment, api/checkout/sessions/create |

## 2. Decisions

**D1 — Billing grain.**
- One Stripe **customer** per client (tenant): shared payment method, billing email and, later, tax identity.
- One **subscription per project**, each with its own price, start date and renewal.
- Bundles later: several projects may point at the same subscription. No schema change is needed.

**D2 — Lifecycle per project.** The clock starts at one of three points:
- the **first confirmed failed payment** (`invoice.payment_failed`, not the renewal date);
- the end of the paid period after a cancellation (D3);
- the payment due date of a project never paid (D7).

| Day | State | Effect |
|---|---|---|
| before the clock | `ok` | normal |
| 1–14 | `reminder` | full access; prominent reminder with countdown and a payment action, at login and on every page of that project |
| 15–28 | `locked` | that project is read-only (D8); sign-in, billing, support and contact-request handling keep working; website online |
| ≥ 29 | `review` | as `locked` for the client; listed in the Super Admin "Needs review" queue. **Website suspension is manual only.** |

- A confirmed payment (`invoice.paid`) restores `ok` on the next request. There is no manual step.
- The state is **computed per request from timestamps**, so it never depends on a cron having run.
- Thresholds are platform constants in one file.
- Repeated failures (Smart Retries) never extend the grace: the earliest failure of the open invoice counts.

**D3 — Cancellation.** The paid period runs normally. The D2 lifecycle starts at the end of the period (`ended_at`, else `current_period_end`).

**D4 — Existing projects** stay without billing records until each is migrated explicitly. No record means `ok`. Nothing changes for any client when billing ships.

**D5 — Emails.**
- Stripe handles payment retries and the payment-failure emails.
- Abluo sends **no** billing emails in v1. It shows the reminders and countdown in the dashboard only, so there are no duplicate notifications.
- Stripe dashboard settings (Tom): failed-payment emails on; after the final retry → **mark the subscription unpaid** (never cancel), so paying the open invoice restores it without a new checkout.

**D6 — Test vs live.**
- Every billing row carries `livemode`. Every link between billing rows is a composite foreign key including it, so a test object can never attach to a live one.
- The same project can hold a test record and a live record side by side.
- **Restricted API keys only** (amended 2026-11-02, Tom): `assertStripeMode()` requires `rk_live_` in production and `rk_test_` everywhere else. On a mismatch, or on an `sk_` secret key, billing is disabled and logged, never guessed.
  - One key per environment, stored as a Vercel **Sensitive** variable, never in code.
  - Each key has the minimum permissions. The draft matrix is below; it is **finalised from the actual SDK calls and the sandbox key's request logs** (Stripe's documented method) before go-live:
    - Customers: Write (incl. tax IDs);
    - Products: Write; Prices: Write;
    - Checkout Sessions: Write;
    - Subscriptions: Write (admin cancel-at-period-end);
    - Invoices: Read;
    - Customer portal: Write (sessions, configuration);
    - Events: Read;
    - Disputes / Charges & Refunds / Radar early fraud warnings: Read;
    - Tax settings and registrations: Read.
    - Everything else: None.
- The local development and test environment is a **Stripe sandbox** (not the shared test mode), per Stripe's current guidance; it uses `rk_test_` keys.
- Production reads only `livemode = true`; other environments only `false`.
- Initial integration testing runs **locally against the Abluo Sandbox** with the Stripe CLI and test clocks.

**D7 — Activation of a new paying project** (no indefinite free access).
- **Before payment.** A Super Admin may provision a project before payment. A `stripe` agreement **must** have `activation_due_at` (enforced by the database). Before that moment the project is `ok` (trial or early setup).
- **30-day maximum (Tom, 2026-10-30).** The due date may be at most **30 days** ahead of the moment it is set or moved. Anything later needs a Super Admin override with a **mandatory recorded reason** (`activation_extension_reason`), audited. This is enforced by the database trigger `project_billing_activation_window()`, with `ACTIVATION_MAX_DAYS` in `lifecycle.ts`; a test keeps the two equal.
- **Lifecycle.** From `activation_due_at`, until activation, the D2 lifecycle runs. Day 1–14 shows "complete your first payment" with the pay button; then it locks; then it goes to review.
- **Activation** = the first **confirmed** payment: `invoice.paid` on the linked subscription, which sets `first_paid_at`. It is **never** the subscription's status, because delayed methods can be `active` before money arrives.
- **Checkout.** The pay link is an Abluo URL (Owner signed in, `billing.manage`), never a raw Stripe URL.
  - Each click reuses the project's open session if it has at least 1 h left. Otherwise it expires that session and creates a new one.
  - Sessions are created with `expires_at` = 24 h (the Stripe maximum) and an `integration_identifier`. `metadata.project_id` / `subscription_data.metadata.project_id` are set server-side **as a cross-check only** (D11).
  - `payment_method_types` is never passed (Stripe guidance). Card-only v1 is set in the Dashboard with a dedicated payment method configuration.
  - Checkout is only offered once the client's billing profile is complete (D14).
  - Idempotency key: `checkout:{projectId}:{mode}:{termsVersion}:{attempt}`.
  - The database allows one open session per project and mode. `checkout.session.expired` marks a session expired and changes nothing else.
- **No second subscription.**
  - A new checkout is refused while the project is linked to a subscription that is not terminal (`incomplete_expired`, or `canceled` after its period).
  - A terminal subscription is unlinked before a new one is linked. The database refuses re-linking a linked project.
- **Failed first payment.** An `incomplete` first payment that is never completed becomes `incomplete_expired` after 23 h. The project stays unactivated and its D7 clock keeps running.
- **Payment methods.** **Card only in v1.** SEPA can be added later; D7 already handles "active before paid".

**D8 — The lock** (`applyBillingLocks`, the last step of context assembly).
- For a project in `locked`/`review`, every write permission is removed except `BILLING_LOCK_ALLOWED`:
  - `support.tickets.write`;
  - `forms.submission.update`;
  - `forms.submission.delete` (handling received inquiries, Tom D1).
- Read permissions stay.
- Website form configuration stays locked: definitions are Abluo-admin only, and notification recipients need `site.details.write`, which is stripped.
- **Tenant grants are never touched.** It applies to page renders and mutations alike.
- Abluo admins in support mode are not billing-locked; the banner shows.
- **Fails open:** if billing state cannot be read, the project is `ok` and an error is logged. Billing is not a security boundary.
- The project stays visible in `/sites` and the switcher, with a badge, and opens read-only.
- Guard tests:
  - the generated list of every platform and module write permission must be stripped except the allowlist;
  - a property test shows that locking any subset of projects leaves every other grant identical.

**D9 — Super Admin.** *(Amended 2026-11-02, Tom)*
- **Billing administration is its own platform permission, `billing.admin`.** Only accounts holding it may change billing terms, overrides, cancellations or payment arrangements; at first only Tom's account holds it. Other Abluo admins may **view** billing information.
- It is enforced in every billing server action (`requireBillingAdmin()` = `requireAbluoAdmin()` + the permission), never only by hiding controls. It is carried like `platform_role`, in the user's `app_metadata` (`platform_permissions`), so no new table is needed and clients cannot set it.
- **Billing contact:** shown on each project's Billing card, but stored once per client (`billing_profiles.billing_email`) and shared by all of that client's projects. There is no Clients screen for now.
- **Currency: EUR only in v1.** The database keeps `currency` per agreement for later.

- Per project: arrangement (`stripe`, `manual` bank transfer, `complimentary`), terms, payment due date, and an override: `allow` (until a date) or `restrict`, with a required reason.
- A "Needs review" queue for day ≥ 29, with an acknowledgement and note.
- Every change goes to `admin_audit_log` (`billing.terms.set`, `billing.override.set`, `billing.review.ack`, `billing.checkout.create`).

**D10 — Shared, tenant-level functions are never restricted by a project lock.** Rule for the future: **any tenant-wide feature uses tenant-scope permissions**, so it is outside project locks by construction.

Shared today:
- billing and the Stripe customer;
- client-level people, invitations and ownership transfer;
- own account;
- the sites overview and switcher;
- support tickets;
- What's New and notices;
- tenant-owned form definitions (admin-only).

Per project, and therefore locked with their project:
- media and taxonomy;
- Connections management (data keeps flowing);
- Site Access groups;
- Settings and website details, including form notification recipients;
- project-level invitations by a Project Admin.

**D11 — Webhooks.**
- Endpoint `POST /api/webhooks/stripe`. The live endpoint is registered as **`https://www.abluo.app/...`** because the apex redirects and Stripe does not follow redirects.
- Steps:
  1. verify the signature on the raw body;
  2. `stripe_event_claim` (a duplicate returns 200);
  3. **re-fetch** the object from Stripe;
  4. `billing_sync_subscription` / `billing_record_invoice`;
  5. `stripe_event_finish`.
- **Ownership mapping through our own records** (amended 2026-11-02, Tom). A Checkout Session maps to a project through **our `billing_checkout_sessions` row** (we stored its id when we created it). Everything after that maps through **subscription id → `billing_subscriptions` → `project_billing`**. An invoice reaches its subscription through `invoice.parent.subscription_details.subscription` (current API). Stripe metadata is compared as a cross-check only: a mismatch is logged and the event is not applied.
- In the current API, period dates are read from the subscription **item** (`items.data[].current_period_*`) and stored in our snapshot columns.
- A transient error returns 500 and Stripe retries. Unknown objects are recorded as `ignored` with a 200.
- A nightly production cron re-syncs every subscription and retries failed events.
- Invoice recording is order-independent in SQL. A late "failed" for a paid invoice is ignored, and the earliest failure wins.

**D12 — Stripe objects.**
- **One Product per Abluo project** (amended 2026-11-02, Tom). It carries a descriptive invoice name, e.g. "Abluo — Website livener.net", and `metadata.abluo_project_id` (the stable `projects.id`, for support and reconciliation; never used for ownership). It is created on the project's first checkout; renaming the site renames the Product.
- One Price per project agreement (EUR, `tax_behavior: exclusive`: agreed prices are **net**, D14).
- One Customer per client **per issuer** (per mode, D13).
- One Subscription per project.
- Customer Portal: payment method and outstanding invoices only.
  - **Self-service cancellation is disabled in v1** (Tom, 2026-10-30: `features.subscription_cancel.enabled = false`, no plan switching). Cancellation requests are handled administratively: a billing admin sets cancel-at-period-end from the admin panel, and the action is audited.
  - **Customer details cannot be edited in the Portal** (amended 2026-11-02, Tom): `features.customer_update.enabled = false` (verified in the configuration API). Abluo is the source of truth for the billing email and the legal/tax details (D14) and pushes them to Stripe.
- Recovery action: the failed invoice's `hosted_invoice_url`.

**D13 — Issuer (the invoicing legal entity) is configuration, not code** (Tom, 2026-11-02).
- Today the issuer is **TMZ, established in Germany, with a German USt-IdNr.** It may later become an Italian entity with an Italian VAT number.
- Stored in `billing_issuers`: legal name, country, VAT id, live Stripe account, per-language invoice texts (e.g. the reverse-charge wording) and status `draft` / `active` / `retired`. Exactly one is `active`, i.e. used for new subscriptions.
- A Stripe account belongs to one legal entity and country. A new issuer therefore means **a new Stripe account**: Stripe Tax registrations, products, customers and subscriptions are created there. Confirm with Stripe support when it happens.
- `billing_customers` is keyed per (client, **issuer**, mode). Every subscription records its issuer permanently.
- Historical invoices keep their original issuer and tax treatment: they live, already finalised, in the issuer's Stripe account, and nothing in Abluo rewrites them.
- Switching issuer = add the new issuer, set it active and retire the old one. Existing subscriptions run on under the old issuer until they are deliberately moved; that move is a planned operation.
- **Settled 2026-11-02 (Tom):**
  - The initial issuer is **TMZ Germany**, with German VAT and invoicing kept as simple as possible. The accountant confirms before live payments (§7).
  - A later Italian entity gets its **own Stripe account**. Paid periods and historical invoices stay with the issuer they were made under.
  - Stripe can migrate customers and payment methods between accounts, but subscriptions need a planned transition. That is investigated when the time comes. **No migration functionality is built now.**
  - Italian FatturaPA/SdI is deferred.

**D14 — Tax** (Tom, 2026-11-02). *Not legal or tax advice: the accountant confirms (see §7). No live tax collection or live payments until then.*
- **Agreed prices are net** (excluding VAT), where this matches the client's agreement. Invoices show net, VAT or the reverse-charge note, and total.
- **Tax is calculated by Stripe Tax** (`automatic_tax`) from the issuer's registrations, the product tax code and the customer's location and VAT number. There are no hard-coded German or Italian rates or rules in Abluo.
- **The tax calculation is separate from the subscription and access lifecycle.** D2–D8 never read tax data; tax never changes access.
- **B2B:**
  - Same country as the issuer → domestic VAT (e.g. DE→DE 19 %, IT→IT 22 %).
  - Another EU country with a valid VAT number → **reverse charge**, no VAT on the invoice.
  - Stripe Tax applies reverse charge automatically when the customer has a tax ID, **based on the number's format, regardless of the VIES result**. So Abluo gates it: a business client's VAT number must be **`verified` (VIES, via Stripe's automatic validation) before its first checkout**, and an `unverified`/`unavailable` result is shown to the billing admin for a decision.
  - The reverse-charge wording comes from the issuer's `invoice_texts` and is set on the customer's invoice footer. What Stripe prints by itself is verified in the sandbox.
- **B2C:**
  - VAT generally follows the customer's country for cross-border electronically supplied services, subject to the EU €10,000 threshold and any election.
  - In Stripe Tax this is expressed purely through **registrations**: the issuer's domestic registration (with or without the "small seller" option) and, if applicable, a **Union OSS** registration. Stripe then charges the right country's rate.
  - Which registrations apply is the accountant's call; Stripe's threshold monitoring is information only.
- **Client billing data (Abluo is the source of truth, `billing_profiles`):**
  - billing email;
  - business or individual;
  - legal name;
  - address and country;
  - VAT number and its VIES verification status, time and registered name.
  - Abluo pushes it to the Stripe customer. Checkout is only offered when the profile is complete.
- Electronic invoicing (Italian SDI/FatturaPA) stays a separate integration. European Commission-specific treatment is out of scope.

**D15 — Risk events** (Tom, 2026-11-02).
- `charge.dispute.created`, `charge.refunded` and `radar.early_fraud_warning.created` are recorded and shown to billing admins as **actionable alerts**, on Admin Home and on the project Billing card.
- **They never change project access automatically.**
- An alert stays open until a billing admin **acknowledges** it, then **resolves** it with a note. It does not disappear because the webhook was processed. Storage is a small `billing_alerts` table in migration **059**, delivered with Phase 3; it is not part of 057 or 058.

## 3. Data model — migrations 057 + 058

All seven tables are server-only:
- RLS on, no policies;
- nothing granted to `anon` or `authenticated`;
- functions executable by `service_role` only;
- `ON DELETE RESTRICT` towards `tenants` and `projects`.

| Table | Key | Purpose |
|---|---|---|
| `billing_issuers` | id; unique `key`; one `active` | invoicing legal entity: name, country, VAT id, Stripe account, invoice texts (D13) |
| `billing_profiles` | (tenant_id, livemode) | client billing email, business/individual, legal name, address, VAT id + VIES status (D9, D14) |
| `billing_customers` | (tenant_id, issuer_id, livemode) | Stripe customer per client, issuer and mode |
| `billing_subscriptions` | id; unique (id, livemode) | Stripe snapshot under one issuer (never changes) + `first_paid_at`, `payment_failed_at`/`failed_invoice_id`, `last_settled_invoice_id` |
| `project_billing` | (project_id, livemode) | arrangement, terms, `activation_due_at`, `manual_paid_through`, link to subscription (composite FK with mode), override, review |
| `billing_checkout_sessions` | stripe_session_id | one open session per (project, mode); `cs_live_`/`cs_test_` must match `livemode` |
| `stripe_webhook_events` | event_id | idempotency ledger |

Functions:
- `stripe_event_claim`, `stripe_event_finish`;
- `billing_sync_subscription(jsonb)`: upsert plus optional project link; concurrent calls serialise on the row lock;
- `billing_record_invoice(…, outcome ∈ paid | voided | failed, …)`. `voided` covers an invoice voided or marked uncollectible in Stripe (e.g. forgiven by a Super Admin): it settles that invoice's failure and never counts as a first payment.

Triggers:
- `project_billing_check_tenant`: a project only links to its own tenant's subscription;
- `billing_subscriptions_immutable`: tenant, issuer, mode and Stripe id never change.
- `project_billing_activation_window`: the 30-day rule of D7.

Functions are created with plain `create function` (not `or replace`), so 057 fails loudly instead of silently replacing an existing function of the same name.

**Proof:**
- `supabase/verify/hardening-057.verify.mjs`: 42 tests (applies 057 → 058; rollback 058 → 057 → none and re-apply) on real Postgres with the production-faithful chain. Mutation-checked: removing the mode from the FK, the tenant check, the immutability guard (incl. issuer), the one-active-issuer index, the activation window or the late-failure guard each turns a test red.
- `supabase/verify/rehearse-057.mjs`: 23 checks on the Abluo Sandbox, including anon REST refusal and unpaid→paid recovery.
- **Rollback:** `supabase/verify/rollback-057.sql`. It refuses while any live-mode row exists. The round trip was proven on the Sandbox.

## 4. Implementation order

1. 057 approved by Tom, then applied to the Abluo project (additive; nothing reads it yet).
2. Pure core: `resolveProjectBilling`, `applyBillingLocks`, plus the guard and property tests.
3. Admin billing: client card, project card, override, review queue, audit.
4. Stripe test mode, local + Sandbox: customer, price, checkout, webhook, reconcile, test clocks.
   - Scenarios: activation, never paid, renewal failure, day 15/29, unpaid → pay, cancel → period end.
   - Also an `unpaid` subscription spanning a renewal (draft invoice) — to confirm which invoice must be paid.
5. Wire into the context behind `BILLING_ENFORCEMENT=off|observe|on`.
6. Client billing page `/{project}/billing` and the Portal. Needs Tom to allowlist `billing.manage` as a deliberate feature control.
7. Go-live:
   - Vercel Pro;
   - live webhook on `www`;
   - live keys in Production only;
   - Stripe failed-payment settings (D5);
   - first real project.

## 5. Open

- SEPA (after v1).
- Accountant confirmations before live payments (§7).
- SDI/FatturaPA e-invoicing (separate integration).
- Vercel Pro timing.

Decided 2026-10-30: the 30-day window (D7) and no self-service cancellation (D12).

## 6. Final safety review of 057 (2026-10-30)

**Destructive operations: none.** No `drop`, `truncate`, `delete`, column change or data update touches any existing object. Every statement creates something new or grants/revokes on the new objects.

**Effects on existing structures — only through new foreign keys pointing INTO them:**
- `billing_customers → tenants` and `project_billing → projects`: `ON DELETE RESTRICT`. A client or project **with billing rows** can no longer be deleted (including the tenants → projects cascade). There are no billing rows at apply time, so nothing changes until billing data exists. This is intended.
- `project_billing.override_by / created_by` and `billing_checkout_sessions.created_by → auth.users`: `ON DELETE SET NULL`. Deleting a user only clears those references.
- Adding these FKs briefly takes a `SHARE ROW EXCLUSIVE` lock on `tenants`, `projects` and `auth.users` during the transaction (milliseconds, small tables): writes to them wait, reads do not.
- No trigger, policy, grant or column is added to, or changed on, any existing table.

**Permissions** (checked on the Sandbox, which has the real Supabase default privileges):
- No table grant to `anon`/`authenticated`.
- No `EXECUTE` for them on any of the 7 functions.
- No policies.
- REST: anon gets 401 on the table and the RPC.
- The single `SECURITY DEFINER` function (`project_billing_check_tenant`) is owned by `postgres`, has `search_path=''`, can only run as a trigger, and only compares two tenant ids.

**Changes made during the review:**
1. `create or replace function` → `create function`.
2. The 30-day activation trigger plus `activation_extension_reason`.
3. A `voided` invoice outcome, so an invoice forgiven in Stripe no longer leaves a project on the clock.
4. `last_paid_invoice_id` renamed to `last_settled_invoice_id`.
5. The redundant advisory lock removed. Mutation testing showed the row lock already serialises concurrent syncs.
6. **Applied state (verified 2026-11-02):** production holds 057 in its 2026-11-02 revision (nullable `stripe_customer_id`, sha256 `ed9fabc79a98…`; 5 tables, empty). The issuer and billing-profile changes for D13/D14 therefore ship as **migration 058** (`billing_issuers`, `billing_profiles`, `billing_customers` keyed per issuer, `issuer_id` on subscriptions). It only reshapes the still-empty billing tables, refuses otherwise, and has its own rollback. Together 057 + 058 give the seven tables described in §3.

**Accepted behaviour:** two simultaneous deliveries of the same Stripe event can both be processed. This is harmless, because processing re-fetches from Stripe and upserts idempotently.

**Rollback:** drops only the 057 objects. It refuses while any live-mode row exists and tolerates the pre-review draft (`drop function if exists` for the window trigger).

**Apply procedure (when authorised):**
1. Confirm production is at 056 (APPLIED.md).
2. Paste the file once in the SQL editor. Expect `NOTICE: 057 self-check passed`.
3. Run the read-only checks at the end of the file: 7 tables, 0 `project_billing` rows.
4. Record the result in APPLIED.md.

The migration is additive and unread, so it can go before or after any code release.

## 7. Before live payments — information needed from the accountant

**Live tax collection and live payments stay off until all of these are answered and recorded here.**

1. **Issuer.** Confirm that TMZ (Germany, USt-IdNr.) is the invoicing entity for Abluo now. Give the exact legal name, address and VAT number to print. Confirm whether it falls under the German small-business rule (*Kleinunternehmer*, §19 UStG) or charges VAT normally.
2. **Registrations to record in Stripe Tax:**
   - the German domestic registration;
   - whether to use the **EU €10,000 small-seller threshold** or to have opted for destination-country VAT;
   - whether **Union OSS** registration exists or is needed (registered via the German BZSt), and from when.
3. **Product tax code.** Which Stripe tax code fits Abluo (website software and hosting as a service, for business use and for individuals). We will show the candidates from Stripe's list; the accountant confirms.
4. **Reverse charge:**
   - the exact invoice wording per issuer and language (DE: e.g. "Steuerschuldnerschaft des Leistungsempfängers"; IT/EN equivalents);
   - confirmation that VIES-verified VAT numbers are sufficient evidence;
   - what to do when VIES is unavailable or a number is invalid.
5. **B2C evidence.** Which location evidence suffices for private clients (billing address country; a second piece of evidence if required).
6. **Prices.** Confirm that agreed prices are net, and how the agreement wording should state it for business and private clients.
7. **Invoices.**
   - Whether Stripe's invoice PDF (number series, issuer details, VAT breakdown, reverse-charge note) satisfies German invoicing requirements (§14 UStG), or whether invoices must come from your accounting software.
   - How Stripe invoices relate to your bookkeeping (export, DATEV).
8. **Future Italian entity.** What changes on the switch: Italian VAT registration, SDI/FatturaPA obligation (separate integration), handling of existing subscriptions, and the cut-over date.
9. **Refunds and credit notes.** The required form for corrections (Stripe credit notes vs. the accounting system).

## 8. Phase 3–5 implementation notes (2026-11-02)

Decisions made while building, within the settled architecture:

- **Migration 059** = `billing_alerts` (D15) **plus** one change to `billing_sync_subscription`: a project whose linked subscription has ended (`canceled` / `incomplete_expired`) may take a new, non-ended one. Without it a client who re-subscribes after a cancellation would pay without the project being linked. An ended snapshot never takes over a link. Rollback restores 058's function exactly.
- **Unlinkable live subscription = failure, not "ignored".** If a paid Checkout's subscription cannot be linked, the webhook event is marked `failed` and retried (Stripe + nightly), so it is visible in the logs instead of silently dropped.
- **VAT check before first checkout (D14) unchanged — order fixed.** VIES runs in Stripe on the customer's tax id, so on a business checkout with an unverified VAT number Abluo first pushes the customer + tax id, copies Stripe's current result to the profile, then decides. While Stripe reports `pending` the client sees "being checked, try again in a few minutes"; the `customer.tax_id.updated` webhook keeps the result current.
- **Zero-amount paid invoices** are recorded as settled but never count as the first payment (never activate).
- **Enforcement flag** `BILLING_ENFORCEMENT` = `off` (default, no reads) | `observe` (banners only) | `on` (locks). Fails open.
- **Return URLs** for Checkout / Portal are only Abluo hosts (`abluo.app`, `*.abluo.app`, this Vercel deployment, `localhost` in dev).
- **Admin cancel-at-period-end** is audited also when it fails after Stripe may already have changed.
- **Nightly reconcile** retries stuck events first, then sweeps subscriptions within a 240 s budget (oldest first, so the next run continues).
- **Client Billing page** `/<project>/billing` stays reachable during a lock (tenant-scoped permissions, never stripped). Visible to `billing.manage` (pay) and `billing.invoice.read` (view).

Known limits (accepted for v1, healed by the next event or the nightly reconcile): two events for one subscription processed at the same moment can store the older snapshot; a webhook delivered twice at the same moment can run twice (handlers are idempotent); if storing a new Checkout session fails after Stripe created it, retries fail until that session expires (≤ 24 h). An old VAT id is not removed from the Stripe customer when the number changes.
