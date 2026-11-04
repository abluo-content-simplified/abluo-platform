# Courses + Reservations — Phase 0 assessment

**Date:** 2026-11-03 · **Author:** Claude ("Claudio") · **Status:** for Tom's review
**Inputs:** brief v1.2 (`courses-module-brief-v1.2.md`), code audit of `dev` @ `5482eef` (v1.0.91), project docs (Events 2.0 plans, People status, billing ADR-041).
**Outputs:** ADR-044 Reservations, ADR-045 Courses, ADR-038 Amendment A (all Proposed, in `docs/architecture/`).
**Checklist:** no product code, schema, production config or deployment was changed. Everything here is documents.

---

## 1. Executive recommendation

The confirmed scope is feasible on the current platform without redesign. Scheduling (ADR-038), People, Forms snapshots, secure tokens, outbox notifications, the Stripe webhook ledger and the permission system give us most foundations.

Three constraints shape the order:
1. **Events 2.0 Phase 1 is not finished.** Reads are live; writes still go to Sanity; migration 044 isn't applied. Recurring classes need the write cutover, so this becomes **step one**.
2. **Vercel Hobby plan:** crons run once a day, and the plan is non-commercial. Reminders and last-minute alerts need Pro. Everything else works on Hobby.
3. **Stripe Connect and participant fiscal documents** are a new platform integration plus an accountant question. The CYCE pilot doesn't need them (bank transfer).

**Recommendation:** approve the three ADRs, then build in this order:
1. Finish Events Phase 1.
2. Owners + editions + recurrence + calendar/PDF.
3. Courses content (in parallel with step 2).
4. Reservations core.
5. Change emails and reminders.
6. CYCE pilot.

Stripe Connect and Memberships follow as their own tracks.

## 2. Current-state inventory (verified)

| Area | State | Source |
|---|---|---|
| Scheduling tables | `event_series` / `event_occurrences`: permanent ids, local time + IANA zone, rule columns present (unused), overrides, tombstones, version checks, `FOR UPDATE` on one-off save. 043 applied, 044 not | migrations 043/044, `supabase/APPLIED.md` |
| Scheduling code | `src/lib/scheduling` store / guards / overlay / time. Keyed by `event_public_id`; one series per event assumed | `store.ts`, `read.server.ts` |
| Readers | Website, event pages, home, blog related events and partner API read schedules with Sanity fallback. Sitemap and dashboard list don't | `overlay.ts` callers |
| Writes | Dashboard still writes Sanity dates. `saveOneOffGuarded` unused. No C5 script, no C6 cutover, no tombstoning on removal | `EventEditor.tsx`, `agenda/actions.ts` |
| Venues | Ownership checked only in the Sanity-side editor (`venue:<_id>` tokens). Scheduling checks format only | `event-drafts.ts`, `store.ts` |
| Teachers | People module live; instructor guards ready; occurrence override write not built | `guarded.server.ts`, `persons-guard.ts` |
| Event capabilities | registration `off` / `externalLink`; `priceOptions[]` (label, amount, currency, note); recurrence fixed off; no capacity | `events/capabilities.ts`, `events/schema.ts` |
| Bookings | Nothing exists | grep |
| Forms | Definition snapshot + version per submission; **one person per submission**; English-only notification template; no automatic retention | migration 016, `notifications/templates.ts` |
| Email | Resend via `sendEmail`; production-only gate on outbox rows; no bounce webhook; Resend id not stored; outbox claim has no timestamp (stranded `delivering` rows) | `notifications/*` |
| Jobs | 8 daily crons, `CRON_SECRET`; outbox + DB webhook; no queue | `vercel.json` |
| Stripe | Billing only (no Connect); signature route, restricted keys, `stripe_webhook_events` claim/finish ledger, nightly reconcile, alerts | `billing/stripe/*`, 057–059 |
| Tokens / rate limits | 32-byte tokens, sha256 storage, `hashIp`, atomic attempt functions, revocation | `access/*`, migration 050 |
| Audit | `content_audit_log`, `catalogue_audit_log` (append-only, idempotent), `access_audit_log` | 041, 061, 049 |
| Permissions | `{module}.{noun}.{verb}` with fixed verbs; extras via `GRANTABLE_MODULE_PERMISSIONS`; support-mode filters; `assertModuleAction` | `authz/*`, `module-action-guard.ts` |
| Module install | `moduleInstallations` on the Sanity `project` doc; config in Studio, or `configSurface:'dashboard'` | `modules/types.ts` |
| Dashboard UI | Lab has ListToolbar, DataTable, ContentCard, ListRow, sheets, DateTimePicker, WeeklyScheduleEditor, PersonPicker, Pill, StatTile, AttentionList… **No Stepper/Wizard, no time-only picker** | `src/lab/registry.ts` |
| Tenant settings | Single `/settings` page (form notifications only); Catalogue has its own Setup page | `settings/page.tsx` |

## 3. Gap analysis (brief v1.2 → status)

Legend: **R** reuse · **E** extend · **N** new · **B** blocked by a prerequisite · **D** deferred

| Requirement | Status | Where |
|---|---|---|
| One-off / fixed / recurring sessions | E + **B** (Phase 1 cutover, then recurrence) | ADR-038 A0, A3 |
| Editions | N | A2 |
| Series owned by course | E | A1 |
| Teachers + per-session override | R (override write E) | ADR-045 D7 |
| Venues per session | R (ownership guard E) | A0 |
| Course content, page, SEO | N | ADR-045 D2, D5 |
| Booking options (package, sessions, drop-in, pass) | N | ADR-044 D2, D9 |
| Dated pricing (joining mid-term) | N | ADR-044 D2 |
| Price categories + *Requires membership* | N | ADR-044 D8 |
| Multi-session, multi-attendee, all-or-nothing | N | ADR-044 D3 |
| Guest booking + secure link | N (pattern R) | ADR-044 D11 |
| Capacity per session, minimum participants | N | ADR-044 D2, D7 |
| Holds, transfer expiry rule, extend / release | N | ADR-044 D5 |
| Offline payments, Payment review | N | ADR-044 D6 |
| Booking rules + generated terms | N | ADR-044 D7 |
| Refund / return / credit approval | N | ADR-044 D4, D7 |
| Bookings for events (workshops) | N | ADR-044 D1 |
| Booking form questions per attendee | E (Forms is one-person) | §5 R6 |
| Emails: confirmation, change, cancellation, refund | E (outbox pattern R, localized templates N) | ADR-044 D10 |
| Reminders, last-minute alerts | **B** (Vercel Pro) | ADR-044 D10 |
| Ad-hoc message to participants | N | ADR-044 D10 |
| Calendar section, .ics, calendar feed | N | A5, ADR-044 D11 |
| Printable timetable PDF | N | A5 |
| Permissions, support-mode rules | E | ADR-044 D12, ADR-045 D9 |
| Tenant Booking rules page | N (`configSurface:'dashboard'`) | ADR-044 D13 |
| Create flow wizard | N (shared Stepper first, rule of two) | ADR-045 D6 |
| Stripe Connect, participant receipts | D (own ADR + accountant) | — |
| Memberships | D (own brief) | brief §4c |
| Waitlist, gifts, WhatsApp/SMS, spot reservation for pass holders | D (hooks in place) | ADR-044 D2, D10 |

## 4. Architecture summary
See the three ADRs. In one paragraph: course text in Sanity; editions, series and sessions in scheduling (Supabase); booking options, prices, bookings, attendees, allocations, passes, payments, refunds, activity and outbox in Reservations (Supabase). Everything is joined by `publicId` + `project_id`, written only through guarded server actions and service-role functions, and booked atomically by one Postgres function that locks session capacity rows in id order.

## 5. Risk register

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Write cutover (C6) breaks live event dates | M / H | Existing plan: shadow writes, reverse-sync, CP4 approval, re-run C5 before promotion |
| R2 | Owner change (A1) breaks event readers | L / H | Additive columns, mirror kept, readers default `ownerType:'event'`, snapshot tests of every event page |
| R3 | Overselling under concurrent bookings | M / H | Single function, `FOR UPDATE` in id order, live concurrency test on Sandbox (parallel final-place race) |
| R4 | Recurrence edits orphan booked sessions | M / H | Ids never change; removal of booked sessions requires impact review; tombstones, never deletes |
| R5 | DST / time-zone errors | M / M | Local time + zone as truth; expander property tests across DST weeks (Europe/Brussels, Europe/Rome) |
| R6 | Forms is one-person-per-submission | H / M | v1 attendee fields are native Reservations fields; optional extra questions attach one Forms submission per attendee (`booking_attendee_id` link). No change to Forms tables |
| R7 | Cross-project leakage (bookings are personal data) | L / H | `project_id` + composite FKs everywhere, service role only, negative test matrix, support-mode hiding |
| R8 | Management-link token leaks via logs / analytics | M / M | Hash-only storage, no tracking scripts on the page, `no-store`, rotation and revocation |
| R9 | Emails silently fail (no bounce webhook, stranded rows) | M / M | `claimed_at` for retries, store Resend id, later Resend webhook; tenant sees failed urgent emails |
| R10 | Reminders impossible on Hobby | H / M | Reminders capability locked off until Vercel Pro; everything else unaffected |
| R11 | Shared dev/preview/prod Supabase | H / H | Rehearse every migration on Abluo Sandbox; `assertSandboxSupabase` in live tests; production only with approval |
| R12 | Scope creep | M / M | Phase gates; pilot limited to transfer + free bookings |
| R13 | Bank details / IBAN published | L / M | Shown only in the booking flow and confirmation email, from Booking rules; never in page source for crawlers |
| R14 | Retention / legal (accounting periods, children) | M / M | Defaults proposed in ADR-044 D14, confirm with accountant / privacy review before pilot |

## 6. Delivery plan

Estimates are in **build sessions** (one focused working day with Claude). Confidence: audit facts high; implementation medium (±30 %). Every production migration and every promotion has its own STOP and approval.

| Step | Scope | Depends | Estimate | Gate |
|---|---|---|---|---|
| **1. Finish Events Phase 1** | C5 migration script (dry run → Tom), C6 write cutover with shadow writes, apply 044, removal tombstoning, venue ownership guard, schedule-aware sitemap + dashboard list | — | 2–3 | CP4 cutover approval; Tom checks the events end to end |
| **2. Owners, editions, recurrence** | A1 owners, A2 editions, A3 expander + edit operations, scheduling editor for repeats, calendar section, .ics, printable PDF | 1 | 5–7 | Sandbox rehearsal + approval; DST tests |
| **3. Courses content** (parallel with 2) | `course` schema + route + sitemap + JSON-LD, module manifest, capabilities, dashboard list + editor, shared **Stepper** component (+ move the 2 existing wizards later), listing section | — | 3–4 | /verify (light/dark × phone/desktop) |
| **4. Reservations core** | ADR-044 tables + `reservations_book`, booking options incl. pass + dated prices, price categories, Booking rules page, holds, offline payments, Payment / Eligibility review, bookings + participants lists, rosters, secure management page, confirmation / expiry / cancellation emails, bookings on **events** and **courses** | 2 (sessions), 3 | 7–9 | Concurrency + isolation tests; Tom tests a workshop and a pass end to end on dev |
| **5. Changes and messages** | Affected-booking review on edits, change / cancel emails, ad-hoc messages, last-minute marking, minimum-participant flow; reminders when Pro exists | 4 | 3–4 | Idempotency tests |
| **6. CYCE pilot** | CYCE settings, 2026/2027 edition, workshops, privacy policy update, DPA, runbook | 4–5 | 1–2 + CYCE time | Pilot sign-off |
| Later: Memberships | Own brief / ADR (plans, terms with dated rules, member list, checks, Access groups) | 4 | 3–5 | — |
| Later: Stripe Connect | Own ADR, accountant decisions | 4 | 4–6 | Financial sign-off |

Critical path: 1 → 2 → 4 → 6, about 16–21 sessions. Step 3 in parallel.

**Differences from the brief's §16 phases (this plan supersedes them):**
- Finishing Events Phase 1 is added as step 1.
- The pilot needs steps 4 and 5: change and cancellation emails are essential for real participants. Workshop-only testing can start after step 4.
- Stripe Connect is not on the pilot path, as the brief already says.
- "Places per session" moves from scheduling to Reservations (A4).
- The edition table is named `schedule_editions` (brief: `schedule_runs`).
- Permission ids follow the ADR-028 vocabulary (P0-5).
- Memberships: the brief recommends building it right after the pilot's first release; your D13 decision is still open.

**Phase 0 cross-check (independent review) — resolved in the ADRs:** capacity lock rows, session price overrides, online meeting links, test-recipient path, sessions added after sale, age limits, rosters, registration modes and Events `priceOptions`, per-attendee form answers, organiser-cancellation refund review, edition ownership FK, locale handling, configuration surfaces, Bookings navigation, edition publication vocabulary, calendar section gating, routable checklist (ADR-044 D16, ADR-045 D10). **Flagged for you:** support mode hides bookings until revealed (brief said read by default), and the reminders fallback if you stay on Hobby.

## 7. Decision register

| # | Decision | Recommendation |
|---|---|---|
| P0-1 | Approve ADR-044, ADR-045, ADR-038 Amendment A | Approve |
| P0-2 | Finish Events Phase 1 (cutover + 044) as step 1 | Yes — nothing else can be built safely before it |
| P0-3 | Vercel Pro timing | Before reminders (step 5) and before any commercial go-live (already open in ADR-041) |
| P0-4 | New shared **Stepper / Wizard** component (rule of two) | Yes; existing wizards migrate later |
| P0-5 | Permission names (ADR-044 D12, ADR-045 D9) | Approve as listed (`payment.update` instead of "confirm") |
| P0-6 | Retention defaults (ADR-044 D14) | Accept provisionally; confirm with accountant |
| P0-7 | Booking questions beyond name / contact: one Forms submission per attendee | Yes, optional per booking option |
| P0-8 | Printable PDF engine | Decide in step 2 after a Vercel limits check |
| D3 | Late payment → Payment review | Recommended (brief v1.2) |
| D6b | Single-session absence notice in v1 | Yes, tenant on/off |
| D7 | Sessions added after package sale | Not included by default |
| D9 | Editions in Supabase | Yes (A2) |
| D10 | Stripe Connect details | Later ADR + accountant |
| D13 | CYCE membership in the pilot | Your call (open) |

## 8. Test and acceptance mapping

| Brief acceptance area | Evidence |
|---|---|
| Course and editions | Unit tests for edition copy; snapshot of earlier edition unchanged |
| Schedules | Expander property tests (DST), edit-operation tests, live Sandbox test for id stability |
| Teachers | Guard tests (cross-project id rejected), override tests |
| Publishing | ADR-032 lifecycle tests; unpublished never renders; visibility helper on sitemap / feeds |
| Published changes | Impact-review unit tests; activity rows; no email on pure editorial change |
| Booking choices, atomic capacity | Live concurrency test (N parallel requests for the last place → exactly one wins), multi-attendee × multi-session rollback test |
| Holds | Expiry-rule unit tests (earliest of three), extend / release audit |
| Pricing | Dated-price resolution tests, category tests, snapshot immutability, adjustment lines |
| Free / manual / offline | End-to-end on dev (Tom), permission tests |
| Cancellations / refunds | Booking-rules matrix tests, generated terms per locale, refund approval permission |
| Notifications | Outbox dedupe tests, `claimed_at` retry, locale selection, production-only gate |
| Secure management | Token tests (wrong token, other booking, revoked), rate limit test |
| Tenancy | Negative matrix for every route / function / sweep / link |
| Privacy | Anonymise keeps amounts; no booking data in website queries (projection test, like `translationStatus`) |
| Dashboard | /verify light / dark × phone / desktop; list-screen KIND tests; handmade test |

---

**Next step after approval:** step 1 (finish Events Phase 1), starting with the C5 dry-run report for your review.
