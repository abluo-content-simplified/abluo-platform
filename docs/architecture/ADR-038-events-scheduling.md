# ADR-038 — Events 2.0: content in Sanity, scheduling in Supabase

**Status:** Proposed. The architecture was approved by Tom on 2026-10-20; the Phase 1 sequence is still awaiting approval.
**Date:** 2026-10-20
**Owner:** Tom
**Relates:** ADR-031 (Connections — see Amendment C, which this ADR triggers), ADR-032 (content lifecycle, DST rules), ADR-021 (consent), ADR-022 (Gallery), ADR-025/029 (tenant editor and dashboard), ADR-028 (roles), ADR-033 Amendment I (capabilities pattern)
**Working papers:** project docs `events-2.0-phase1-proposal-2026-10-19`, `events-2.0-architecture-v2-2026-10-20`, `events-2.0-phase1-final-plan-2026-10-20`

---

## Context

Events must grow from one-off announcements into a scheduling module that covers recurring classes, courses, multi-session days and calendars, and later enrolment, attendance and payments, while staying simple for tenants. Today an event's dates, place and status live on the Sanity `event` document. That cannot carry hundreds of sessions, permanent per-session ids or transactional bookings.

## Decisions

### D1 — Who owns what
| Sanity (editorial, presentation) | Supabase (scheduling, operations) |
|---|---|
| `event`: title, descriptions, images, categories, SEO, translations, registration configuration, visibility, event-level announcement status | `event_series`: time zone, first start/end (local), rule (RRULE subset), until/count, default place, attendance mode, instructors |
| `eventVenue`: name, address, **pin**, access note, photo, contact, time zone | `event_occurrences`: permanent id, local and UTC start/end, status, per-session overrides, tombstones |
| `eventInstructor` (new): public profile | later (Reservations, ADR-TBD): enrolments, reservations, attendance, payments |

One value has one writer. Sanity keeps no schedule after the migration: the legacy `startDate`/`endDate` stay stored (read-only, hidden) for rollback only.

### D2 — Identity across systems
- The key is **`(project_id, event_public_id)`**. `project_id` is `public.projects.id`, resolved from the Sanity `projectSlug`. `event_public_id` is the Sanity event's existing `publicId` (an immutable UUID, present and unique on all events as of 2026-10-20). The Sanity `_id` is never used.
- Venues and instructors are referenced from schedules by their `publicId`. Editing a venue therefore updates every event that uses it, and a session that overrides the place to another venue is unaffected.
- `publicId` must be unique: Studio "Duplicate" regenerates it, Sanity validation rejects duplicates, and the scheduling layer refuses to write when one `publicId` maps to more than one document.

### D3 — Event → Series → Occurrence
- Every event has **at least one series internally**. A one-off event is a series with no rule and one occurrence. Tenants only meet the word "series" once a repeating schedule exists.
- **Occurrence ids are permanent and opaque.** Moving a session changes its times, never its id. Regenerating from a rule matches existing sessions on `original_start_local` (iCal RECURRENCE-ID) and keeps their ids. Sessions that disappear get a tombstone (`removed_at`) and are never deleted. A session edited individually is marked `is_modified` and is not overwritten by regeneration.
- **Time:** local date-time plus IANA zone is the stored truth. UTC columns are derived on write for range queries. DST follows ADR-032: a non-existent local time moves to the next valid minute, and an ambiguous one takes the first occurrence.
- **Edit operations (Phase 2):** *this session* edits the occurrence; *all sessions* edits the series and regenerates; *this and following* ends the series and creates a new one (`split_from_series_id`), moving future occurrences with their ids.
- Multi-day events are one session spanning days, or one session per day. There is no separate opening-hours model.
- Series carry the default place, attendance mode and **multiple instructors**. Occurrences may override each, plus a cancellation and a short localized note.

### D4 — Publishing and changes
- The schedule is shown only while the Sanity event is published. Unpublished events stay unpublished.
- On a published event, schedule changes take effect **immediately**. Disruptive changes require confirmation: cancelling a session, moving a future session, changing the place of upcoming sessions, and (Phase 2) a rule change that removes sessions.
- One scheduling API and one editor (the tenant dashboard) serve tenants and super admins. Super admins reach it through View as client / support mode. Studio shows a read-only summary with a link.

### D5 — Partial failures between the systems
- Order: Sanity first, then Supabase. A schedule without a published Sanity event is never rendered.
- Every schedule write is **one Postgres transaction** (a `security definer` function called with the service role), with optimistic concurrency (`version`).
- If the Supabase step fails, the editor keeps the Sanity change, shows that the dates were not saved and offers a retry. Publish is refused while an event has no schedule.
- Deletion and archiving use the existing `sanity-removals` webhook to tombstone schedules. A nightly reconciliation job reports orphans in both directions and never deletes.
- Every schedule change writes `content_audit_log` (`schedule_changed` already exists).

### D6 — Configuration ≠ permissions ≠ presentation
- **Capabilities** (Studio → Modules → Events), typed in `src/lib/modules/events/capabilities.ts`: attendance modes, venues (off / Abluo-managed / tenant-managed), hosts, full description, programme, gallery (Gallery module), pricing, registration (off / external link), recurrence (locked off until Phase 2). The defaults reproduce today's behaviour. Disabling hides the feature and makes the server reject writes to it. Stored content keeps rendering and is never deleted or changed.
- **Permissions** (ADR-028): new `events.venue.write`/`delete` and `events.instructor.write`/`delete` (write: owner and editor; delete: owner), enforced server-side together with capability checks.
- **Presentation:** map display (address / directions / map) is a project-level website setting.

### D7 — Places
- A place is one of the site's locations or a venue. ADR-031 Amendment A's one-off "custom" place becomes an **unlisted venue** (`listed: false`). "Save this venue for next time" lists it. Place content therefore always lives in Sanity, and schedules only reference it.
- The free-text **City** (Amendment A §1) stays editorial on the Sanity event.
- The venue pin is set only by a person (drag/click). An address change never moves it, and the editor offers "Move pin".

### D7b — Hidden (one-off) venues
- A one-off place is an `eventVenue` with `listed: false` and `ownerEventPublicId` set. It never appears in the venue list or any picker except its own event, and it can only be edited from that event, so it cannot be shared by accident.
- **Promote:** "Save this venue for reuse" sets `listed: true` and clears the owner. From then on it behaves like any venue, and the editor says that changes apply to every event using it.
- Duplicating an event that uses a hidden venue clones the venue (a new `publicId`), so the copy never edits the original's place.

### D8 — Isolation and access
- Scheduling tables follow the server-only pattern: RLS on, no grants to `anon`/`authenticated`, service role only, with every call authorised by `assertModuleAction` and scoped by `project_id`.
- **Environments (Phase 1, decided by Tom 2026-10-20):** the existing Abluo Supabase project and all environment connections stay as they are (dev, preview, production and local share it and the Sanity `production` dataset). One extra Supabase project, **Abluo Sandbox**, is used to test migrations, scheduling logic and anything destructive. Only verified, approved, additive changes are then applied to the existing project. No new Sanity datasets and no environment rewiring in Phase 1. Automated tests and seed scripts cannot target production (`assertSandboxSupabase()`). See `docs/engineering/shared-environments.md`.
- Private calendars (Phase 2): secret link plus optional password, both stored as hashes, server-validated, revocable and changeable. They are independent of participant accounts. One visibility helper gates every reader: page, listing, sitemap, partner API and feeds.

### D9 — Reservations stays independent
Reservations (future) target `{type: occurrence | series | package | appointment, id}`. Enrolment, per-session reservation, attendance confirmation, actual attendance and payment are separate records. Scheduling holds **no** capacity, booking or payment data. `src/lib/scheduling` is independent of Events so that appointments can reuse its time handling without becoming public events.

### D10 — Guarantees and rollback (Tom's safeguards, 2026-10-20)
1. **Unpublished stays unpublished.** Every public reader (pages, listings, sitemap, JSON-LD, partner API, feeds) starts from *published* Sanity content and joins schedules to it. A schedule row on its own never renders. A test asserts that "schedule saved, event unpublished" appears nowhere.
2. **Super-admin access** goes through the same scheduling API and editor (View as client / support mode). There is no second editor and no Studio write path.
3. **Rollback after Supabase-only writes begin.** For single events (the only kind in Phase 1), the scheduling API also writes the occurrence's start and end into the legacy, hidden Sanity `startDate`/`endDate` (a *shadow write*, same request, never read by new code). Redeploying the pre-cutover version therefore shows correct dates. If the shadow write ever fails, a reverse-sync script (Supabase → Sanity legacy fields, dry run first) restores them before any rollback. Shadow writes stop only when recurrence ships (Phase 2), at which point rollback past Phase 2 is planned separately.
4. **No editor against an unverified API.** The new event editor (Phase 1 Stage E) starts only after the scheduling API has passed its tests, including the DST matrix, isolation, permissions and partial-failure cases, and has been rehearsed on the sandbox.
5. **Checkpoints.** The production database migration and the scheduling cutover each need Tom's separate, explicit approval.

## Consequences
- GROQ can no longer filter or sort events by date. Every date reader goes through `src/lib/scheduling` and then fetches content by `publicId`.
- Website event pages now also depend on Supabase. They degrade to "dates to be announced" and never error.
- The partner API Event v1 keeps its shape but sources dates from scheduling (ADR-031 Amendment C).
- Studio can no longer edit dates.

## Out of scope for Phase 1
Recurrence UI and expander, calendar views, private calendars, add-to-calendar and feeds, and anything in Reservations. The columns that Phase 2 needs exist from the first migration but stay unused.
