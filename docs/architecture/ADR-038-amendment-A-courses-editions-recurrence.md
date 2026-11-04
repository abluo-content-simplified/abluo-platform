# ADR-038 Amendment A — Owners, editions, recurrence and the printable timetable

**Status:** Proposed (Phase 0, 2026-11-03) — awaiting Tom's approval
**Amends:** ADR-038 (Events 2.0 scheduling). Needed by ADR-045 (Courses) and ADR-044 (Reservations).

## Verified starting point (code audit 2026-11-03, dev @ 5482eef)
- Migration 043 applied to production; **044 not applied** (conflict code `AB409`; until applied, conflicts raise 40001 and hang the Data API).
- Website **reads** schedules with fallback to Sanity dates (v1.0.59, C3).
- **Writes are not cut over.** `EventEditor.tsx` and `agenda/actions.ts` still write Sanity `startDate`/`endDate`. `saveOneOffGuarded` has no callers. There's no shadow write, no migration script (C5), no removal tombstoning, and no nightly reconcile.
- Not schedule-aware: sitemap, dashboard event list. The partner API cursor still follows Sanity.
- Venue ids are not ownership-checked in scheduling (UUID format only).
- Scheduling is keyed by `event_public_id` everywhere; `schedulesForEvents` assumes one series per event.

## A0 — Finish Phase 1 first (prerequisite, existing plan)
C5 migration script → C6 write cutover with shadow writes → apply 044 → removals webhook tombstones → nightly reconcile (report-only). Venues ownership check moves into the scheduling guard. Each production step keeps its own approval (CP1/CP4).

## A1 — Owners: a series belongs to an event or a course
Additive, in one migration rehearsed on Abluo Sandbox:
- Add `owner_type text not null default 'event' check (owner_type in ('event','course'))` and `owner_public_id uuid` to `event_series` and `event_occurrences`.
- Backfill `owner_public_id = event_public_id`; then `owner_public_id not null`.
- Make `event_public_id` nullable, kept as a mirror for `owner_type='event'` until readers move (removal is a later release).
- New unique key `(id, project_id, owner_type, owner_public_id)` and composite FK from occurrences on it. The old FK stays until the mirror is dropped.
- Indexes: replace `event_series_one_off` and `event_series_event` with owner-based equivalents.
- Store and types: `ownerType` + `ownerPublicId`. `schedulesForEvents` becomes `schedulesForOwners`. Event readers pass `ownerType: 'event'`; behaviour unchanged.
- **Rollback:** columns are additive; old code ignores them.

## A2 — Editions
New table `schedule_editions`: `id`, `project_id`, `owner_type`, `owner_public_id`, `label` (localized jsonb), `starts_on`, `ends_on`, `time_zone`, `publication_status` (ADR-032 vocabulary: draft / scheduled / published / unpublished / archived), `operational_status` (`active` / `cancelled`), `copied_from_edition_id`, `version`, timestamps, tombstone.
- `event_series.edition_id` (nullable; events don't use it).
- Edition publication follows ADR-032 vocabulary at display level; the edition row stores only what scheduling needs.

## A3 — Recurrence (Phase 2 of ADR-038, now scheduled)
- **Presets only:** weekly on chosen days, every N weeks, weekdays, monthly on the Nth weekday, monthly on a date. Bounded by `rule_until`, `rule_count` or the edition end. No free RRULE editor.
- **Expander:** pure function `expand(rule, start_local, time_zone, window)` → local start times; DST-safe (local time + IANA zone is the truth; skipped local times move forward, repeated local times take the first instant; both covered by tests).
- **Generation:** on save, within a horizon (the edition end, or 12 months for open rules); a daily cron extends open horizons. Idempotent on `(series_id, original_start_local)` (existing unique index).
- **Edit operations:**
  - *This session* sets `is_modified` and the override.
  - *All* regenerates and matches on `original_start_local`; modified sessions are kept and reported.
  - *This and following* splits with `split_from_series_id`; future sessions keep their ids.
- Removing a session that has allocations requires the Reservations impact review (ADR-044) before commit.
- Shadow writes to Sanity stop for repeating series. Rollback past this point is a planned release (reverse-sync covers one-offs only).

## A4 — Places per session
Not in scheduling (ADR-038 D9 stands): places live in Reservations `session_capacity`. Scheduling exposes session ids and times only.

## A5 — Calendar and printable timetable
- **Calendar section** (platform-wide for Events + Courses): month / week / list views from `occurrencesInWindow`, filters by venue, teacher and category, `.ics` per session and per calendar.
- **Printable timetable PDF:** generated server-side on request from the same data (month, language, optional filters), cached per `(project, month, locale, filters, max(updated_at))`. Members-only when served from an Access-protected page (ADR-040 streaming rules). Library choice in Phase 1 (server-side HTML → PDF vs a PDF renderer), checked against Vercel function limits.
- **Private calendars** (ADR-038 D8) unchanged.

## A6 — Readers
Sitemap, dashboard lists, JSON-LD and the partner API cursor become schedule-aware in the same phase as A1 (the gaps listed above).
