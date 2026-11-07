# ADR-044 — Reservations: one booking engine for courses, events and later appointments

**Status:** Proposed (Phase 0, 2026-11-03) — awaiting Tom's approval
**Authority:** Courses brief v1.2 (`docs/engineering/courses-module/courses-module-brief-v1.2.md`), Tom's decisions 2026-10-19 (Reservations independent of Events) and 2026-11-03 (Booking rules, transfer holds, price categories, pilot CYCE)
**Relates to:** ADR-038 (scheduling) + Amendment A, ADR-045 (Courses), ADR-028 (permissions), ADR-032 (lifecycle), ADR-040 (secure tokens, rate limits), ADR-041 (Stripe patterns), ADR-018/019 (Forms, outbox)

## Context

Abluo needs bookings for the CYCE pilot: workshops (one-off **events**, member / non-member price, bank transfer) and the yearly class **pass** (a **course** edition priced by joining date). Later: Stripe, waitlists, gifts, appointments (Studio Martegani, Claudia Hoffmann). ADR-038 D9 already fixed that scheduling holds no capacity, booking or payment data, and that reservations target sessions by id. Nothing booking-related exists in the code today (audit 2026-11-03).

## Decisions

### D1 — Scope and independence
- Reservations is its own module (`reservations`), `dataStore.primary = 'operational'` (Supabase only, no Sanity documents).
- It books **targets**: a session (`event_occurrences.id`), an **edition** (ADR-038 A2) or, for one-off events, the event's single series. Consumers: Courses and Events from v1; appointments later.
- It never reads editorial content to decide anything. Titles and texts shown in emails and on the management page are **snapshotted** at booking time.

### D2 — Data model (Supabase, server-only, RLS on, service role only)
Every table carries `project_id`; child tables use composite keys `(id, project_id)` and composite FKs, as in migrations 043 and 050. Money is integer cents + `currency` (EUR only in v1, column kept).

| Table | Holds |
|---|---|
| `reservation_settings` | One row per project: **Booking rules** (self-cancel on/off + deadline + outcome; absence notice on/off + release place + outcome; organiser-cancelled session outcome; accept bank transfer; hold days; cutoff before first session; bank details + payment instructions (localized jsonb); last-minute window; reminder offset) |
| `reservable_targets` | Per bookable thing (`owner_type` event/course, `owner_public_id`, optional `edition_id`): registration status (closed/open), opens_at, closes_at, minimum participants + decision date, overrides of Booking rules, default places per session |
| `session_capacity` | Places per session (`occurrence_id`), overriding the target default. Missing row = unlimited |
| `price_categories` | Project vocabulary: stable key, localized label, `requires_membership`, sort |
| `booking_options` | Per target: kind `full_edition` \| `sessions` \| `drop_in` \| `pass`, localized label, which sessions it covers, status |
| `booking_option_prices` | Per option × price category: amount, `valid_from` (dated rules: price by booking date, for joining mid-term) |
| `bookings` | Reference (human-readable), status, flags (`payment_review`, `eligibility_review`), locale, source (`website` / `dashboard`), purchaser contact (name, email, optional phone, channel consent with wording version + timestamp), totals, **snapshot** jsonb (option, prices, terms text, rules, titles, sessions), hold_expires_at, management token hash, idempotency key |
| `booking_attendees` | Name, optional email, guardian (for children), price category, declared eligibility, verification result + rule applied |
| `booking_allocations` | One per attendee × session: kind `hold` / `confirmed` (later `invitation_hold`, `gift_pending`), expires_at, released_at + reason |
| `booking_passes` | Pass entitlement per attendee (valid_from / valid_to, scope, own management token hash). Gives the right to attend; places are taken only by pass attendances (D9) |
| `booking_lines` | Finalized price lines; **adjustments** (e.g. price difference after eligibility check) are new lines, never edits |
| `booking_payments` | Method `free` / `bank_transfer` / `cash` / `other` / `stripe` (later), amount, status, paid_on, reference, recorded_by, provider ids |
| `booking_refunds` | Kind `refund` / `manual_return` / `credit`, amount, reason, status, approved_by, provider ids |
| `booking_activity` | Append-only history (actor kind/id, action, detail ≤ 8 KB), modelled on `catalogue_audit_log` |
| `reservation_outbox` | Notification intents (see D10), modelled on `support_ticket_outbox` |
| `booking_link_attempts` | Rate limiting for management links (pattern of `site_access_attempts`) |

### D3 — All-or-nothing allocation
- One plpgsql function `reservations_book(...)` (service role only, like the 043 RPCs): validates target open, option eligible, sessions scheduled; locks the `session_capacity` rows **in id order** with `FOR UPDATE` (no deadlocks); counts confirmed allocations + holds with `expires_at > now()`; inserts the booking, attendees, lines and **every** allocation, or raises `AB409` with the full sessions; one transaction.
- Unique `(project_id, idempotency_key)` makes retries return the same booking.
- Sessions without a capacity row are not locked (unlimited).
- Manual over-capacity needs `reservations.capacity.manage`, an explicit flag and an activity row.
- Capacity can't be reduced below active allocations (function check).

### D4 — States (three separate machines)
- **Booking:** `pending → held → awaiting_payment → confirmed`; terminal `cancelled`, `expired`. Flags `payment_review`, `eligibility_review` never block confirmation by themselves.
- **Payment:** `unpaid → partially_paid → paid → refunded / partially_refunded`.
- **Refund:** `requested → approved → done / rejected / failed`.
- Every transition is a function or guarded server action that writes `booking_activity` and, where relevant, an outbox intent. Allowed transitions are listed in code and tested.

### D5 — Holds
- Free → confirmed immediately.
- Stripe (later) → hold ≥ Checkout lifetime.
- **Bank transfer** (only if the project accepts it) → `awaiting_payment`; `hold_expires_at` = earliest of (booking + hold days, registration close, first session − cutoff). Tenant can extend or release (audited).
- Expiry is **logical**: availability ignores expired holds. A daily sweep marks them `expired` and queues the email. No minute-level job is needed for correctness.
- Late offline payment after expiry → `payment_review`; tenant confirms if places are free, otherwise records a manual return or credit.

### D6 — Payments
- v1: free, bank transfer, cash, other — recorded and confirmed by a user with `reservations.payment.update`. Who checks transfers is the tenant's business.
- Stripe Connect is a separate ADR. It reuses the ADR-041 pieces: signature route skeleton, `livemode` check, restricted keys, claim/finish ledger (needs an `account` column for Connect events), re-fetch-then-sync, nightly reconcile, alerts table.

### D7 — Booking rules, cancellations, refunds
- Three cases, each a tenant setting (project default → target override): participant cancels whole booking; participant skips one session (absence notice, optionally frees the place); organiser cancels a session (credit / proportional refund / none).
- The participant-facing **terms are generated from the settings** in every site language and snapshotted on the booking. An optional extra note is allowed.
- Refunds always need approval (`reservations.refund.manage`). Automatic provider refunds only when Stripe exists.
- Below the minimum participants at the decision date: the dashboard prompts the tenant; cancelling runs the normal cancellation flow.

### D8 — Price categories and membership
- Tenant-defined categories per project. *Requires membership* → self-declared, `eligibility_review` flag, tenant marks verified or adds an adjustment line.
- The rule applied and its result are stored on the attendee (brief D12). The Memberships module later replaces self-declaration without changing these tables.

### D9 — Pass and pass attendance (revised 2026-11-07, Tom)
Generic, not CYCE-specific: the same model serves a yoga club with no limits, a gym, a golf club and a rowing club with 10 boats.
- **The pass is the right to attend, never a place.** A `pass` option creates a `booking_passes` row. The number of passes sold is independent of class sizes (200 passes across 10 weekly classes is normal). `max_passes` stays as an optional sales cap only.
- **Scope:** a pass covers chosen courses or all courses of the project.
- **Validity:** fixed end date (e.g. 31 Dec, price by joining date via `booking_option_prices.valid_from`) or a duration from the start date (1 / 6 / 12 months …).
- **Entries:** optional number of entries (10-class card), in v1. An entry is used by "I'm coming" and given back when the answer is withdrawn before the change deadline. Once attendance tracking exists (D9a), the entry is used by the check-in instead.
- **Requires membership:** an option can require membership; self-declared + `eligibility_review` until the Memberships module replaces it (same as D8). Membership + pass are separate purchases.
- **Each class decides how pass holders attend** — project default in Booking rules → override per target → per session:
  1. **Places:** unlimited (`session_capacity.places` null) or a number.
  2. **Pass sign-up:** `off` (just come; not allowed with limited places) · `opt_in` ("I'm coming tonight").
  Plus: sign-up opens N days before, answers can change until M hours before.
- **Standing sign-up (later):** the holder chooses the classes they come to regularly ("Monday 18:30") and is counted for those until they say "I'm not coming". The holder chooses — never all holders on all classes.
- **One mechanism.** "I'm coming" creates a `booking_allocations` row of kind `pass_attendance` referencing the pass, through `reservations_book` (same lock and capacity count as any booking). Unlimited places = a headcount; limited places = the next one sees "Full". "I'm not coming" releases it.
- **How holders sign up:** v1 a secure **My pass** link (D11 pattern), emailed to the attendee (or the purchaser): upcoming sessions with Coming / Not coming. Later, a project setting chooses link or participant accounts; with accounts the same page sits behind a login.
- **Organiser cancels a session:** outcome for pass holders is a tenant setting (default: notify only, no refund; entries given back).
- **Configuration split (ADR-014):** Abluo admin switches on which pass capabilities a project has (entries, fixed-end vs duration, sign-up modes, membership requirement, accounts later). The tenant fills the values (which courses, dates, prices, places, sign-up per class).

### D9a — Attendance tracking (later)
Teacher marks present / absent on the roster, or the participant checks in (e.g. QR code at the venue). Feeds no-show tracking and entry use. Out of scope for v1; `booking_allocations` gets `attended_at` / `no_show` columns when it lands.

### D10 — Notifications
- `reservation_outbox`: intent type, booking id, recipients snapshot, locale, `dedupe_key` (unique, e.g. `reminder:<allocation>:<starts_at>`), status `pending / delivering / delivered / failed / dead / skipped`, attempts, `last_error`, `environment` (production-only gate on the row, as `form_events`), `provider_message_id` (Resend id is stored, unlike today).
- Delivery: Supabase Database Webhook for near-instant sends + cron sweep, same claim pattern as `deliverEvent()`. Fix the known gap: add `claimed_at` so a crashed `delivering` row is retried.
- Templates follow the support-ticket pattern (`BY_LOCALE`, `chooseEmailLocale`), never the English-only Forms template.
- Reminders and last-minute alerts need a sweep at least **hourly**: a Supabase `pg_cron` job calls the sweep route (decided, Tom 2026-11-07; no Vercel Pro needed).
- **Sender (v1):** `From: <Site name> <no-reply@mail.abluo.app>` with `Reply-To` = the tenant's contact address (exists today in `src/lib/notifications/resend.ts`). Later: optional own sending domain per project (tenant adds DNS records, Resend domain verified).
- **Change emails:** never automatic. After a change the dashboard asks "Notify the N booked people?", shows an editable, prefilled message with a preview, and sends one email per person with their first name ("Hi Anna"). Same flow for every change type.
- Channel fields (phone, consent) are stored now; WhatsApp Business / SMS adapters come later.

### D11 — Secure management link
- 32-byte random token, base64url, only the sha256 stored (`src/lib/access/session-token.ts` pattern). Revocable and rotatable from the dashboard.
- Rate limit with `hashIp` + an attempts function modelled on `site_access_reserve_attempt`.
- Page is `noindex`, `Cache-Control: private, no-store`. The token never appears in analytics or logs.
- A separate calendar-feed token per booking, revocable.

### D12 — Permissions (ADR-028 vocabulary `{module}.{noun}.{verb}`)

| Permission | Default roles | Notes |
|---|---|---|
| `reservations.booking.read` | owner, editor | Grantable extra |
| `reservations.booking.write` | owner, editor | Manual bookings, cancel, absence, extend/release hold |
| `reservations.booking.delete` | owner | Anonymise/delete per retention |
| `reservations.payment.update` | owner | Confirm offline payments. Grantable extra (e.g. a treasurer) |
| `reservations.refund.manage` | owner | Support never |
| `reservations.capacity.manage` | owner | Over-capacity override |
| `reservations.export.use` | owner | Support never |
| `reservations.settings.manage` | owner | Booking rules page. Support never |

Payment, refund, export and settings go into `SUPPORT_NEVER_WRITES`. Bookings hold personal data, so like `forms.submission.*` they are hidden in support mode until the tenant grants access (D16.16).

### D13 — Configuration surfaces (ADR-014: one surface each)
- **Super admin (Studio → Modules → Reservations):** capabilities — offline payments, price categories, passes, absence notice, minimum participants, reminders (locked off until Pro), Stripe (locked off).
- **Tenant (dashboard → Bookings → Booking rules):** everything in `reservation_settings` (`configSurface: 'dashboard'`, as Catalogue Setup).
- **Per target:** in the course edition or event editor.

### D14 — Privacy and retention
- Purchaser ≠ attendee. Guardian fields for children. No special-category questions by default.
- Retention (decided, Tom 2026-11-07): bookings, attendees and passes anonymised 24 months after the last session, payments and refunds kept per accounting law (10 years in Italy, configurable per issuer country), outbox 12 months.
- Erasure = anonymise attendee/purchaser fields, keep amounts and references.
- `contact_id` column (nullable) reserved for the Contacts module.

### D15 — Isolation tests
Negative tests for every route, function, sweep and link: wrong project id, substituted session/option/booking ids, token of another booking, cross-project person/venue ids.

### D16 — Clarifications from the Phase 0 cross-check
1. **Capacity lock always has a row.** Opening a target creates a `session_capacity` row for every one of its sessions (`places` null = unlimited); sessions generated later get one too. `reservations_book` always locks rows, in id order.
2. **Session prices.** `booking_option_session_prices` (option × session × category → amount) overrides the option's default per-session price. Resolution order: session override → option default → none (option not sellable).
3. **Sessions added after sale.** `reservable_targets.include_new_sessions` (default false): whether existing package / full-edition bookings get allocations for sessions added later.
4. **Online access.** `session_online_access` (occurrence → meeting URL, optional passcode). Shown only on the management page and in emails to confirmed attendees. Never in website queries, partner API, calendar feeds or the PDF. A projection test enforces this.
5. **Test sends.** Outside production, the consumer sends only to `RESERVATIONS_TEST_RECIPIENT` (env var), else `skipped`, so flows can be verified on dev without real participants.
6. **Age limits and guardians.** `booking_options.min_age` / `max_age`; guardian details required when the attendee is under 18 (date of birth not stored, only "under 18 — guardian").
7. **Rosters.** Per session or edition: print view and CSV export (`reservations.export.use`, project-scoped, audit-logged, CSV-injection-safe, sensitive fields off by default), plus "email roster to teacher" (to the person's email from People private contacts, if present).
8. **Registration modes** (events and courses): `off` / `externalLink` (existing) / `reservations`. In `reservations` mode, prices come only from `booking_option_prices`. The event's Sanity `priceOptions[]` stays for display in `externalLink` mode, and the editor offers a one-click conversion.
9. **Booking questions.** `booking_attendees.form_submission_id` (and `bookings.form_submission_id` for purchaser-level questions) link to the Forms submission. One submission per attendee; Forms tables unchanged.
10. **Organiser cancellation** of a session or edition puts every paid allocation into refund review with the outcome from the Booking rules. A per-booking override of that outcome needs `reservations.refund.manage` and is audited with a reason.
11. **Ownership.** `reservable_targets.edition_id` must belong to the same `(owner_type, owner_public_id, project_id)`: composite FK to `schedule_editions`.
12. **Keys.** Supabase rows use `project_id`, resolved from `projectSlug` with `projectIdForSlug` (`src/lib/scheduling/read.server.ts`); Sanity owners are joined by `publicId`, never `_id`.
13. **Languages.** Generated terms and email texts are platform dictionaries covering every **content** locale in `routing.ts` (not the en/it/de interface bundles), with fallback to the site's default locale, then English. Tenant-written extras (payment instructions, extra note, price category labels) are localized per `siteConfig.supportedLocales`.
14. **One surface per concept.** Availability = super-admin capabilities (Studio). Values = the tenant's **Booking rules** page, which also manages **price categories**. A target shows "Use site defaults / Custom" for the few overridable rules — the same concept edited in one component, no second form. The ADR-014 structure test gets a case for it.
15. **Navigation.** One **Bookings** area (all bookings, filters by course / edition / event / status; Booking rules as a tab). The edition dashboard opens the same list pre-filtered — one screen, not two.
16. **Support mode (decided, Tom 2026-11-07).** Bookings are hidden from Abluo support until the **tenant** grants access with a button in the dashboard (not "support reveals"). Access is logged and revocable.
17. **Reminders (decided, Tom 2026-11-07):** Supabase `pg_cron` calling the hourly sweep route.
18. **Payments per booking and reference (Tom 2026-11-07).** Every booking has a short reference shown in the payment instructions. A booking can have several payments with different methods (part card, part transfer); the club's admin records each one with method, date and the bank's own reference, and finds the booking by searching its reference. Automatic statement matching later.

## Consequences
- One engine for every bookable thing. Courses and Events stay thin.
- New Supabase tables (one migration series, rehearsed on Abluo Sandbox, applied only with Tom's approval).
- Reminders run on Supabase pg_cron.

## Out of scope (v1)
Stripe, waitlists, gifts, standing sign-up, attendance tracking / check-in / no-shows (D9a), participant accounts, receipts, own sending domain, discounts, instalments, participant transfers/rescheduling, SMS/WhatsApp sending.
