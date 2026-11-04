# Abluo Courses — Implementation Brief v1.2

| | |
|---|---|
| Recipient | Claudio |
| Purpose | Audit and phased implementation proposal |
| Status | Planning brief. No coding authorized |
| Version | v1.2, 3 November 2026. Replaces v1.1 and v1.0 |
| v1.2 changes | Pilot = CYCE; bank-transfer holds (expiry rule + settings); late offline payments go to Payment review; tenant-defined price categories with "Requires membership"; tenant Booking rules (self-cancel, absence notice, cancelled sessions) with terms generated from settings; last-minute and ad-hoc participant messages, calendar feed, phone + channel consent for future WhatsApp/SMS; Memberships boundary (§4c); terminology and cross-reference fixes |
| Based on | v1.0 brief + ADR-038, ADR-043, ADR-018/019, ADR-028, ADR-032, ADR-040, ADR-041 + Tom's decisions to date |

> **Directive.** The first deliverable is a written audit and proposal. No application code, migrations, schema changes, provider configuration or deployments until Tom has reviewed it and explicitly authorized implementation. Tests and rehearsals run against **Abluo Sandbox**, never production. Nothing is applied to the shared Supabase project without Tom's explicit approval.

**What changed from v1.0.** v1.0 put its own scheduling and booking stack inside Courses. v1.1 keeps all of v1.0's product requirements and safeguards, but places them on what Abluo already has and has already decided to build. Section 1 sets the shape. Everything else follows from it.

---

## 1. The shape: two modules, shared engines

**Decided by Tom (2026-11-03).** Events and Courses are **two separate modules** for tenants and website visitors. They run on **two shared engines** underneath.

```
  What the tenant sees             Events module           Courses module
  (editorial, Sanity)              simple: what, when,     course, editions,
                                   where, who              booking options, teachers
                                        │                        │
  ──────────────────────────────────────┼────────────────────────┼────────────
  Shared engine 1: Scheduling           └──── series → sessions ─┘
  (Supabase, ADR-038)                  recurrence, venues, teachers, time zones
                                                                 │
  Shared engine 2: Reservations                         booking options, bookings,
  (Supabase, new, separate module)                      attendees, capacity, holds,
                                                        payments, refunds, notifications
```

Why:
- **Different products for the tenant.** An event is "something happens on this date". A course has editions, packages or single sessions, teachers per session, bookings, payments and cancellations. One editor serving both would either burden simple events or need a wall of capability switches.
- **Different on the website.** Own URLs (`/courses/…`), own listing and booking sections, schema.org `Course` + `CourseInstance` instead of `Event`.
- **One engine each, never two.** One recurrence engine, one capacity engine. A calendar section can show events and classes together because both are sessions in the same tables.
- **Reservations is not owned by Courses.** Tom decided (2026-10-19) that Reservations is an independent module, later used by Events (simple sign-ups), appointments (Studio Martegani, Claudia Hoffmann) and possibly the table-reservation system. Courses is its first consumer.

**Rule for the grey zone.** If an offering needs editions, several sessions, or booking of a package, it is a **course**. Otherwise it is an **event**, which later gets simple registration through the same Reservations engine. An event keeps its "external registration link" option, and so does a course (tenants who keep EUSurvey or similar).

---

## 2. What already exists — reuse, don't rebuild

| Need from v1.0 | Already in Abluo | Use |
|---|---|---|
| Stable sessions, schedule rules, time zones | **ADR-038 scheduling.** `event_series` (local time + IANA zone, RRULE subset, `rule_until`/`rule_count`, `split_from_series_id`, version) and `event_occurrences` (permanent id, `original_start_local` = iCal RECURRENCE-ID, `starts_at`/`ends_at` derived, `status` scheduled/cancelled, `is_modified`, place/attendance/instructor overrides, localized `note`, tombstones, never deleted). Server module `src/lib/scheduling` | Course sessions **are** occurrences; course schedule rules **are** series |
| Edit one / this and following / all | ADR-038 D3: *this* edits the occurrence; *all* edits the series and regenerates, matching on `original_start_local` so ids survive; *this and following* ends the series and starts a new one, moving future occurrences with their ids | As designed |
| Disruptive change confirmation | ADR-038 D4: published schedule changes go live immediately; cancelling, moving, changing place, rule changes that remove sessions need confirmation | Extend with the "affected bookings" review (§9) |
| Teachers, per-session overrides | **People module (ADR-043)**: `person` (public, Sanity) + `person_private` (Supabase). Series `instructor_public_ids`, occurrence `instructor_override`. Ownership guard `assertPeopleBelongToProject()`, `saveOneOffGuarded`. `PersonPicker` | Teachers come from People. Guests (e.g. CYCE's Henri-Denis) are host-only persons |
| Venues, map pins | ADR-038 D7/D7b: tenant-managed venues, hidden one-off venues, `MapPinPicker` | As is |
| Form questions frozen at booking | **Forms (ADR-018 D4)**: every submission stores `form_version` + `definition_snapshot` | Booking questions = a form; open point is per-attendee answers (§12) |
| Secure revocable links | **Site Access (ADR-040)**: hashed secrets, server-side revocable sessions, atomic DB rate limiting, no global lockout | Booking management links reuse these helpers |
| Roles and permissions | **ADR-028**: roles are permission bundles, code never checks role names, extras per membership, support mode with audit and tenant-granted edit access | New permissions only (§11) |
| Publishing vocabulary, archive vs delete | **ADR-032**: Draft / Scheduled / Published / Unpublished / Archived; archive before permanent delete; activity history; past content never auto-archived | Course and edition publication |
| Email | Resend (`src/lib/notifications/resend.ts`), branded sender `… via Abluo`, tenant logo, Reply-To. Production-only send gate | Transport for v1. The gate needs a test path (§10) |
| Background work | Vercel crons — **all daily today** (`vercel.json`) | Not enough for reminders (§10) |
| Translation | Translate module (ADR-023), interface languages en/it/de | Course texts, booking option labels, policies, emails |
| Dashboard UI | Component Lab, list kinds (CLAUDE.md), disabled actions explain why, drafts always save | Courses = *Content* list; Bookings = *Records* list |
| Stripe | **Stripe Billing only** (ADR-041): Abluo charging tenants. No Connect code | See §8 — tenant payments are new |

## 3. What Tom has already decided to build (this brief depends on)

| Item | Status | Relation to Courses |
|---|---|---|
| **Events 2.0 Phase 2 — recurrence** | Designed (ADR-038), not built: `recurrence: false`, no expander | **Prerequisite** for recurring classes and multi-session courses |
| **Reservations module** | Decided (2026-10-19), not designed. ADR-038 D9: targets `{occurrence \| series \| package \| appointment, id}`; enrolment, reservation, attendance confirmation, attendance, payment are separate records | Holds everything booking-related in this brief |
| **Contacts module** | Planned: contacts per project, origin + full history, manual add, restricted CSV export, clinical data excluded | Purchasers become contacts with origin "booking" |
| **Stripe Connect** | Decided as a later, separate integration (ADR-041 context) | Online payment for course bookings |
| **Access Management Phase 2** | Individual accounts, magic links, expiry | Later: a booking grants access (recordings, members area) |
| **Italian e-invoicing (SDI)** | Separate workstream | Participant fiscal documents for Italian tenants |
| **Memberships module** | New in v1.2, after the pilot (§4c) | Supplies membership status for member price categories |

---

## 4. Confirmed product scope (from v1.0, kept)

| Area | Requirement | v1 |
|---|---|---|
| Course types | One-off workshops, fixed multi-session courses, recurring classes | Yes |
| Editions | A reusable course has separate editions (Spring 2027, Autumn 2027) | Yes |
| Teachers | One or more from People, session-level overrides | Yes (exists) |
| Booking choices | Full edition, individual sessions, or both | Yes |
| Multiple sessions / attendees | Several sessions and several attendees in one booking; purchaser ≠ attendee | Yes |
| Guest booking | No account; secure management link | Yes |
| Capacity | Per session, shared by every booking type; all-or-nothing | Yes |
| Manual registration | Tenant adds participants, incl. offline payment records | Yes |
| Pricing | Package price, default session price, session override | Yes |
| Payments | Free, Stripe, cash, bank transfer, other offline with manual confirmation | Free/offline first, Stripe in a later phase (§13) |
| Cancellation / refunds | Tenant policy; cancellation ≠ refund; refunds manually approved and audited | Yes |
| Registration closing | Manual, plus optional automatic closing date | Yes |
| Published changes | Allowed, with safeguards for existing bookings | Yes |
| Reminders | Default 24 h before a session, configurable | Yes |
| Notifications | Email first, channel-independent design | Yes |
| Waitlist, gifts, WhatsApp, video access | Deferred, but must stay possible (§15) | No |

**Boundaries (kept).** Not an LMS. No lessons, assessments, certificates, progress, protected video delivery, memberships, instalments, subscriptions, discount codes, participant-initiated transfers or rescheduling, attendance tracking, SMS, push or automated WhatsApp in v1.

### 4b. Added in v1.1 (gaps found in v1.0 — open ones are in §18)

| Addition | Why |
|---|---|
| **Price categories**, tenant-defined (e.g. Member, Non-member, Student, Child), per booking option — **confirmed for v1** | CYCE workshops have member and non-member prices today; events already have `priceOptions[]`. Nothing hard-coded; a category may be marked *Requires membership* (§8) |
| **Bounded editions for recurring classes**, plus **drop-in** single sessions | An open-ended rule has no "full edition" to sell |
| **Joining mid-term** (price for remaining sessions) | Common for yoga studios; may be deferred |
| **Minimum participants** + "may be cancelled below N" note | Common for workshops |
| **Online / hybrid link delivery** | `attendance_mode` exists; the meeting link goes only to confirmed attendees, never on the public page |
| **Session roster** for teachers (print / export / email) | Teachers have no login |
| **Add to calendar (.ics)** in confirmations | ADR-038 Phase 2 item |
| **Age limits** per course | v1.0 covers guardians but not eligibility |
| **Participant receipts / invoices** | Legal requirement for many tenants; depends on Stripe Connect and SDI decisions |

### 4c. Memberships — a separate concern (added in v1.2)

Clubs like CYCE charge a yearly membership fee first, then course fees at the member price. A membership is neither a course nor a People profile. Responsibilities:

| Part | Owns |
|---|---|
| **Memberships** (future module) | Membership plans, validity terms, joining-rate rules, member status, member list |
| **Reservations** | The reusable purchase flow: offline payment now, Stripe later. No membership rules |
| **Contacts** | Identifies the individual member (Memberships depends on Contacts being built, or starts with a minimal member record that becomes a contact) |
| **Courses** | Uses membership status to validate price categories marked *Requires membership* |
| **Access** (later) | Members-only pages, timetable, recordings for valid members (replacing shared passwords) |

**Pilot (CYCE).** The membership fee stays **outside** Abluo (EUSurvey + bank transfer, as today). Member prices are self-declared and reviewed by the tenant (§8).

**Progression without redesign.** Pilot: self-declared → next: manual verification against the member list → later: automatic check through Memberships.

**Later Memberships design notes.** CYCE's six joining periods are **dated pricing rules for one membership term**, not six membership types. Trainee, interim and similar rates are tenant-defined eligibility categories.

**Recorded now (future decision, D12).** When must the membership be valid for a member course price? Recommendation: valid **when the booking is made**; the tenant may additionally require it to stay valid on the first session date or throughout the edition. The rule applied and the verification result are saved with the booking, so later membership changes never silently alter its price. Edge case to define: someone joining the club and booking at the same time while the membership payment is still pending (accept as "pending membership" for tenant review).

---

## 5. Logical model mapped onto Abluo

| v1.0 concept | Where it lives in v1.1 | Notes |
|---|---|---|
| **Course** | Sanity `course` document, Courses module | Editorial: title, descriptions, media (Media Library), category, prerequisites, what to bring, accessibility, FAQ sets, gallery, SEO. Routable: obeys the five-requirement checklist (`localizedSlug`, `redirectFrom`, queries, route, sitemap). `publicId` is the only key across systems |
| **Edition** | **New**: Supabase, in scheduling (proposal: `schedule_runs`) | A named, bounded run grouping one or more series, e.g. Spring 2027 = Monday series + Wednesday series. Carries localized label, dates, time zone, registration window, policy references. Copying an edition copies defaults, never sessions/bookings/history |
| **Schedule rule** | `event_series` | Needs one additive change: the owner is an event **or** a course (see below) |
| **Session** | `event_occurrences` | Unchanged |
| **Offer** | Reservations: **booking option** | Renamed: "offer" already means a priced variant in Catalogue (ADR-033). A booking option covers the full edition, chosen sessions, or a drop-in, with price categories |
| **Booking, Attendee, Allocation** | Reservations | As v1.0 §"Bookings capacity and holds" |
| **Payment, Refund** | Reservations | Separate from booking state, as v1.0 |
| **Notification** | Platform notifications (generalised from ADR-019) | Courses/Reservations emit intents; transport is pluggable |
| **Purchaser** | Reservations booking + Contacts (when built) | Contact origin "booking" |

**Generalising scheduling ownership (small, additive).** Today a series is keyed by `(project_id, event_public_id)`. Proposal: add `owner_type` (`event` \| `course`) and `owner_public_id`, keep `event_public_id` as a deprecated mirror until readers move, update the unique index and the FK triple. ADR-038 D9 already requires `src/lib/scheduling` to be independent of Events. Audit must confirm every reader and the one-off unique index.

**Where data lives.** Sanity = editorial and presentation (course text, images, teachers' public profiles, venues). Supabase = editions, series, sessions, booking options, bookings, attendees, payments, refunds, notifications, audit. Supabase tables are server-only (service role), every row carries `project_id`.

---

## 6. Three separate state axes (not one state machine)

| Axis | Values | Owner |
|---|---|---|
| **Publication** of course and edition | ADR-032: Draft / Scheduled / Published / Unpublished / Archived | Courses |
| **Registration** of an edition or booking option | Not open yet / Open / Closed (manual, automatic date, sold out) | Reservations |
| **Operation** of a series or session | Scheduled / Cancelled; edition Completed when its last session ends (display only, never auto-archived) | Scheduling |

The booking itself has its own state machine (§7), and payment and refund have theirs. v1.0's single list mixed these; keep them apart.

---

## 7. Capacity, holds and booking states (v1.0 kept, made concrete)

Kept from v1.0 unchanged: one allocation per attendee per session; full edition and session bookings consume the same session capacity; **all or nothing** for every selected place; idempotent submissions; manual override only with permission, warning and audit; capacity can't drop below active allocations without an exception flow; cancellation releases capacity per policy, refund is separate.

**Concurrency (proposal to validate).** One Postgres function per booking attempt (same pattern as the existing scheduling RPCs in migration 043): lock the affected occurrence rows with `SELECT … FOR UPDATE` **in id order** (no deadlocks), count active allocations + unexpired holds, insert all allocations or raise, all in one transaction. Idempotency key per attempt.

**Hold expiry without a job.** Availability counts holds where `expires_at > now()`. Expired holds simply stop counting; a daily sweep tidies them. No minute-level cron needed for correctness.

**Hold lengths by payment path.**

| Path | Rule |
|---|---|
| Free | Confirm immediately, no hold |
| Stripe | Hold ≥ Checkout session lifetime (minimum 30 min) |
| Bank transfer / offline, participant-initiated | **Decided: the booking holds its places** as *awaiting payment*. The hold expires at the **earliest** of: N days after booking (default 5), the registration deadline, or a cutoff before the first session. An authorized tenant user can **extend** or **release** a hold by hand (audited). CYCE pays by transfer today |
| Manual booking by tenant | Confirmed, payment status kept separately (may be unpaid) |

**Where the transfer settings live (three levels).**
1. Super admin enables the *Offline payments* capability for the project.
2. Tenant sets defaults in Reservations settings: hold length, cutoff before the first session, bank details and payment instructions shown to participants (localized).
3. An edition may override hold length and cutoff. No per-booking-option setting.

**Late payment after expiry.** A provider like Stripe and an offline transfer behave differently:
- **Offline (transfer, cash):** an automatic refund is impossible. The booking goes to **Payment review**. If capacity remains, the tenant can confirm it; otherwise the tenant records a **manual return** or a **credit**.
- **Stripe:** the booking also goes to Payment review; if no place is free, an automatic refund may be issued because the provider supports it. Alert the tenant in both cases. Never overbook silently.

**Booking states (minimum).** Pending → Held → Awaiting payment → Confirmed; terminal Cancelled, Expired; side flags **Payment review** and **Eligibility review** (§8). Flags never block confirmation by themselves. Each transition defines who may do it, idempotency key, capacity effect and notification.

---

## 8. Pricing, payments, refunds

Kept from v1.0: package ≠ sum of sessions; session override > edition default; server-side recalculation only; booked prices, terms and selected sessions **snapshotted** on the booking; later price changes never touch existing bookings; zero-value bookings go through the same flow.

Added: **price categories**, tenant-defined, per booking option (localized label, amount, optional eligibility note). No hard-coded member/non-member fields.

A category marked **Requires membership** behaves like this in the pilot:
- tells the participant that eligibility will be checked;
- allows self-declaration and never blocks checkout;
- flags the booking for **Eligibility review**;
- saves the chosen category, price, declared eligibility and the validity rule with the booking;
- lets an authorized tenant user mark it **verified**, or **request the price difference** (recorded as an explicit adjustment line on the booking — the original snapshot is never rewritten).

Later, Memberships (§4c) replaces self-declaration with an automatic check, with no change to Courses or Reservations.

**Currency.** EUR only in v1, column kept for later (same as billing).

**Stripe — new platform integration, not a reuse.** What exists is Abluo billing tenants. Course money flows to the **tenant**, so this needs **Stripe Connect**. Decisions before that phase:
1. Connect account type and onboarding inside Abluo (tenant dashboard).
2. Platform fee: none, fixed or percentage.
3. Merchant of record = the tenant. Who issues receipts / invoices to participants (Italian fiscal documents, association VAT exemptions such as CYCE asbl) — with Tom's accountant.
4. Hosted vs Embedded Checkout — same open question as billing; decide once for both. No custom card form.
5. Restricted keys, test/live separation, nothing live without Tom's authorization (billing rules apply).

Webhook rules from v1.0 kept: signature verification, dedup, out-of-order safety, tenant resolved from Abluo's own records (Stripe metadata only a cross-check), return page is never proof of payment, reconciliation job.

**Offline payments** (v1.0 kept): method, amount, date, recorder, reference, confirmation history; manual confirmation by permission.

**Cancellation and refunds** (v1.0 kept): policy shown before booking and snapshotted; cancellation releases capacity; refund separately approved, partial allowed, provider result recorded idempotently; organiser cancellation opens refund review for affected paid bookings.

**Booking rules — tenant settings (added in v1.2).** Three different cases, each set by the tenant, not by Abluo:

| Case | Tenant chooses |
|---|---|
| **Participant cancels the whole booking** (self-service via the secure link) | On / off; until when (e.g. 48 h before the first session); what they get back (full refund, partial, credit, nothing) |
| **Participant skips one session** ("I'm not coming tonight") | Absence notice on / off; whether the freed place can be booked by someone else (drop-in); anything given back (usually nothing; optionally credit or make-up class). This is a notice, not attendance tracking |
| **Club cancels a session** inside a package | Credit / proportional refund / none (see below) |

Same three levels as the transfer hold (§7): super admin enables the capability per project → tenant sets defaults on one **Booking rules** page in Reservations settings (together with the bank-transfer hold) → an edition may override. Keep it to these few choices; a volunteer must be able to set it up in minutes.

**The terms text is generated from the settings**, in every site language, shown before booking and snapshotted with the booking. The participant-facing wording therefore always matches what the system does; tenants don't write policy text that could contradict their settings (an optional extra note is allowed).

**Cancelled session inside a package:** the edition's cancellation terms set the rule — credit, proportional refund, or no refund — shown before booking and snapshotted. An authorized tenant user may override it for a single booking; the override and reason are audited. No purely case-by-case handling.

---

## 9. Published changes

v1.0 §"Safeguarded published changes" kept. On top of ADR-038 D4 confirmation, any change touching a session with active allocations shows: old vs new value, affected sessions, number of bookings and attendees, capacity and money effects, proposed messages. Tenant confirms, then reviews recipients, then sends. Pure editorial changes notify nobody. Everything is in the activity history (ADR-032).

Also defined now: a session **added** to an edition after packages were sold — included in packages or not (edition setting, default: not included).

---

## 10. Notifications

Kept from v1.0: triggers (booking confirmed, payment confirmed, session reminder 24 h default, date/time/venue/teacher change, session cancelled, edition cancelled, refund processed, optional follow-up without assuming marketing consent); versioned templates; recipients resolved at send time with an audit snapshot; idempotency; delivery status where the provider reports it; urgent failures visible to the tenant with a safe retry; obsolete reminders never sent after a time change.

Abluo specifics:
- **Transport** = Resend, branded sender as for Forms and invitations. Email in the **booking's locale** (stored on the booking), 24-hour times in the project time zone.
- **Scheduling reality.** Crons are daily. Reminders need at least an **hourly** cron (check the Vercel plan) or a queue. Proposal: an hourly sweep sends due reminders computed from `starts_at − offset`, keyed `(allocation, session, starts_at)` so a moved session never gets both reminders.
- **Production-only gate.** Today email sends only on production. Courses needs a sandbox/test recipient path so flows can be verified without real sends.
- **No duplicates with Stripe.** If Stripe sends receipts, Abluo doesn't send a second receipt (same rule as billing).
- **Last-minute changes.** A change or cancellation within a tenant-set window before a session (default 24 h) is marked **urgent**: sent immediately, highlighted on the booking management page, and its delivery status shown to the tenant (who hasn't received it, bounces). Email alone may not be read in time — this is where extra channels matter (below).
- **Message participants (ad hoc).** Besides change-triggered emails, the tenant can write a short message to everyone booked on one session or one edition ("Bring a blanket tonight", "Room 2 instead of 3"). Same recipient resolution, audit snapshot and delivery history. Transactional only, never marketing.
- **Calendar feed (cheap extra channel).** Besides the .ics file, offer a per-booking calendar subscription link: when a session moves or is cancelled, the participant's calendar updates by itself. Revocable like the management link.
- **Collect the phone number and channel consent now.** Optional phone on the booking, with a separate opt-in for "messages about my booking by WhatsApp/SMS", stored with wording version and timestamp. Then adding a channel later doesn't require asking every participant again.
- **Channels later.** Intent separated from transport so official **WhatsApp Business Platform** (tenant's own business number, approved templates, opt-in/opt-out, delivery receipts, cost per message tracked) and **SMS** can be added — first for urgent messages only, email stays the default. Never WhatsApp Web automation. Note: Abluo's existing WhatsApp module is click-to-chat with enquiry capture (ADR-020 Amendment A), not outbound messaging; the two stay separate.

---

## 11. Tenancy, security, privacy (v1.0 kept, mapped)

- **Scope key is the project** (`project_id` in Supabase, `projectSlug` in Sanity), not "tenant". Public endpoints resolve the project from a trusted course/edition `publicId`, never from a client-supplied id.
- **Permissions (ADR-028)**, server-enforced with `assertModuleAction`, attached as bundles or per-membership extras: `courses.read`, `courses.write`, `courses.publish`; `reservations.read`, `reservations.manage` (manual bookings, cancellations), `reservations.payments.confirm`, `reservations.refunds.approve`, `reservations.capacity.override`, `reservations.export`. Support mode: read by default; edits only with the tenant's grant; never refunds.
- **Secure links**: ADR-040 helpers — high-entropy token, stored as hash, revocable, rotatable, rate-limited, redacted from logs and analytics, link page `noindex` and `no-store`.
- **People stay public profiles.** Participants never become `person` records. Teachers are People, not logins.
- **Purchaser vs attendee** distinct; guardian flow for children; no health or special-category questions by default; consent recorded with wording version, timestamp and scope; marketing consent separate.
- **Retention and rights**: per data type (contact, attendee, child, form answers, payments, notification log), consistent with the Forms deletion & retention work and Contacts; anonymise attendees while keeping financial evidence.
- **Exports**: permission-controlled, project-scoped, audit-logged, CSV-injection-safe, sensitive fields off by default (Contacts rules).
- **Negative test matrix** for every route, job, webhook, export and link (v1.0 kept).

---

## 12. Forms in bookings

Booking questions are an attached Forms definition (snapshot per ADR-018). To decide in the audit: purchaser-level vs per-attendee questions (one submission per attendee, linked to the attendee), mandatory fields, and how answers are erased with the booking.

---

## 13. Tenant experience

v1.0 kept: create a simple course in minutes with progressive disclosure; four steps **Basics → Schedule → Booking → Publish**; drafts save at every step; validation names missing fields with links to them; disabled actions say why (Tom's UX rules).

Abluo specifics:
- **Courses list** = *Content* kind (list ⇄ cards, list first). **Bookings** and **Participants** = *Records* kind (table on desktop, rows on phone). All built from Component Lab components; anything missing is raised with Tom first.
- **Edition dashboard** after publishing: registration status, places per session, upcoming sessions, bookings/attendees, payment exceptions, failed urgent emails, things needing attention. Home widget for "needs attention" (ADR-029).
- **Schedule editor** is the shared Events 2.0 editor (When / Where / Who), not a copy.
- Phone works for the daily tasks: see who's coming, add a participant, confirm a transfer, cancel a session.
- **Capabilities** (configure capabilities, not fields — Tom's principle): super admin switches per project, e.g. editions, individual-session booking, price categories, online payments, offline payments, waitlist (later). Configuration ≠ permissions ≠ presentation.

## 14. Participant experience and website

v1.0 kept: course page content, mobile-first booking flow in 7 steps, no account, failure states (session became full, checkout abandoned, payment delayed/failed, registration closed, session changed), management page content, accessibility and localization rules.

Added:
- **Sections** (presentation) separate from the module (data): course listing, course detail with booking, timetable/calendar (shared with Events), teacher profile links. Module-gated like Gallery/FAQ.
- **SEO**: `Course` + `CourseInstance` JSON-LD, hreflang from `localizedSlug`, sitemap entries, branded 404 for unpublished/archived (ADR-032).
- **Cookie consent**: booking flow sets only necessary cookies; any embed goes through `ConsentEmbed`.
- **.ics** download per booking.

---

## 15. Deferred — keep the door open

v1.0's waitlist and gift-booking flows are kept as written, with one wording change: a waitlist sends a **waitlist invitation** (never "offer", which means something else in Catalogue). One invitation at a time with a capacity hold; all-or-nothing for multi-session/multi-attendee; gifts reserve places immediately, expire, release exactly once, purchaser stays the financial contact. The allocation model must support "invitation hold" and "gift pending" as hold types without a redesign.

**Video and member access.** Not in Courses. A confirmed booking may later grant an **Access group** (ADR-040, needs Phase 2 individual accounts) with an expiry — e.g. CYCE recordings. Protected video delivery stays out of scope.

Other later items (v1.0 list kept): passes / class cards (Reservations "package" target), the Memberships module (§4c), discounts, instalments, attendance and check-in, participant transfers/rescheduling, certificates, reporting, WhatsApp, SMS.

---

## 16. Phases (revised)

Each phase stops at a gate for Tom's written approval. Migrations rehearsed in Abluo Sandbox first; production only with explicit approval; data never reshaped ahead of the reading code (Abluo rule since the 2026-08-14 outage). Releases dev → preview → main with STOP gates.

| Phase | Scope | Gate |
|---|---|---|
| **0 Audit** | Verify §2–§3 against the code; answer §18; Reservations ADR; Courses ADR; scheduling-ownership amendment to ADR-038; Stripe Connect assessment (no setup) | Tom approves ADRs |
| **1 Recurrence** (Events 2.0 Phase 2) | Expander, presets, edit scopes, `owner_type`, calendar section, .ics. Benefits Events too | Scheduling tests incl. DST; rollback plan (shadow writes end here) |
| **2 Courses content** | `course` document, editions, dashboard list and editor, website pages and sections, JSON-LD, external-link registration | Five-requirement checklist; /verify |
| **3 Reservations core** | Booking options, tenant-defined price categories with *Requires membership* review, atomic allocations, holds (incl. transfer expiry rule, extend/release), free + manual + offline-confirmed bookings, Payment review and Eligibility review, secure links, confirmation email, bookings list, rosters, closing | Concurrency, tenancy and privacy tests; free and transfer booking end to end — **CYCE pilot starts here** |
| **4 Changes & notifications** | Affected-booking review, change/cancel emails, reminders (hourly), delivery history and retries | Idempotency and obsolete-reminder tests |
| **5 Stripe Connect** | Tenant onboarding, Checkout, webhooks, reconciliation, refunds, disputes as alerts | Replay / failure tests; financial and tax decisions confirmed with accountant |
| **6 Pilot & rollout** | CYCE behind a capability, runbook, monitoring, staged enablement | Pilot sign-off |
| **7 Memberships** (separate module, own brief) | Plans, terms with dated joining-rate rules, member list, manual then automatic verification of member prices, later Access groups | Own ADR and gate |

Phases 1 and 2 can run in parallel; 3 needs 1. Phase 5 is not needed for the CYCE pilot.

## 17. Testing and acceptance

v1.0's test areas and acceptance criteria are kept in full and apply phase by phase. Additions: no website query projects booking or private person data; cross-project id rejection for courses, sessions, teachers and bookings; owner-type change doesn't break existing event readers; booking emails in the booking's locale; dashboard /verify (light/dark × phone/desktop) per CLAUDE.md. Tests never write to production.

---

## 18. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Pilot tenant | **Decided: CYCE** — editions, recurring sessions, transfers, member pricing, rosters, no Stripe Connect needed |
| D2 | Bank-transfer bookings hold places | **Decided: yes.** Expiry = earliest of N days (default 5), registration deadline, cutoff before first session; manual extend/release; settings at project level with edition override (§7) |
| D3 | Late payment after hold expiry | Recommended: Payment review. Offline → tenant confirms if a place is free, otherwise manual return or credit. Automatic refund only where the provider supports it (§7) |
| D4 | Participants can cancel themselves via the link | **Decided: yes, as a tenant setting** (on/off, deadline, what they get back) on the Booking rules page; transfers/rescheduling stay with the tenant (§8) |
| D5 | Price categories in v1 | **Decided: yes**, tenant-defined, with *Requires membership* self-declaration + tenant review (§8) |
| D6 | Club cancels a session inside a package | **Decided: tenant setting** (credit / proportional refund / none), edition override, audited per-booking override (§8) |
| D6b | Single-session absence notice ("not coming tonight") in v1? | Recommended: yes, tenant on/off; frees the place, nothing given back by default |
| D7 | Sessions added after packages were sold | Not included by default (edition setting) |
| D8 | Mid-term joining, minimum participants | Minimum participants yes; mid-term pricing later |
| D9 | Edition stored in Supabase scheduling (vs Sanity) | Supabase, label localized |
| D10 | Stripe Connect: account type, platform fee, receipts/invoices, hosted vs embedded | Decide in Phase 0 assessment, with accountant |
| D11 | Vercel plan supports hourly crons? | Check; otherwise a queue |
| D12 | When must a membership be valid for a member price? (future, recorded now) | Valid at booking; tenant may also require validity on the first session or throughout the edition; rule + result saved with the booking (§4c) |
| D13 | CYCE membership fee in the pilot | **Decided: stays outside Abluo** (EUSurvey + transfer); Memberships module afterwards |

## 19. Required response from Claudio (v1.0 kept)

One editable assessment: executive recommendation; current-state inventory (verify §2); gap analysis per requirement (reuse / extend / new / blocked / deferred); architecture (state machines, transaction boundaries, sources of truth); security and privacy design; capacity and payment design; scheduling and notifications design; delivery plan; decision register; test and acceptance mapping. Then **stop**. No implementation, migrations, branches, provider configuration or deployment until Tom approves in writing.
