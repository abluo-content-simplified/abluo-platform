# Courses + timetable — build spec (step 2+3 of the Phase 0 plan, simplified)

**Status:** approved by Tom 2026-11-04 ("go"). Authority: ADR-045, ADR-038 Amendment A, brief v1.2, this file wins on details.
**Goal:** courses with weekly classes generate a calendar; CYCE drops their Excel. Pilot data: CYCE December 2026 PDF (`~/Abluo/clients/cyce/…`, summary below).

## 0. Scope

IN:
- `course` content type
- weekly classes (series) with teacher, place, languages, in person / online / hybrid
- date exceptions: cancel, substitute, time change, note
- terms (start/end)
- closures (holidays)
- private online meeting details (Zoom)
- dashboard: Courses list + course editor + Timetable page
- website: timetable section (week / month, setting) with a print-ready month grid; meeting details only on Access-protected pages

OUT:
- course pages / routes
- bookings, teacher logins, teacher pay
- reminders
- monthly / other recurrence presets (weekly only)
- "this and following" split (v1 = edit all future, or one date)

### CYCE reality (from their sheet)
- Locations (rows): BREY, L51, BERL, MERO, CDMA, Online (each with address + room text; they exist as `siteConfig.locations`).
- Weekday columns Mon–Fri (+Sat online).
- Each class: time range, teacher (People; asterisk = volunteer — later), language (FR/EN/both), course/style ("Iyengar Yoga", "Méditation", "Club de lecture…"), hybrid flag.
- Date exceptions: "7/12 sub Sabrina", "18/12 no class", "No class 17/12", "No hybrid 8/3".
- Term: "last class 17/12, first class 7/1/2027" = a closure 18/12–6/1.
- Online classes share Zoom rooms (two rooms: ID + password each).

## 1. Database — migration `064_course_schedules.sql` (additive, rehearsed on Abluo Sandbox, NOT applied to production without Tom)

Pattern = migration 043: tables server-only (RLS on, no policies, revoke from anon/authenticated, grant to service_role), functions plpgsql `set search_path = public, pg_temp`, revoked from public/anon/authenticated, granted to service_role, conflicts raise `AB409`. Self-check block at the end. Rollback file `supabase/verify/rollback-064.sql`; rehearsal `supabase/verify/rehearse-064.mjs` (copy of rehearse-043 pattern, always ROLLBACK).

### 1a. Owners on series/occurrences (ADR-038 A1)
- `event_series`, `event_occurrences`: add `owner_type text not null default 'event' check (owner_type in ('event','course'))`, `owner_public_id uuid`.
- Backfill `owner_public_id = event_public_id`; then set it `not null`.
- `event_public_id` becomes nullable. Add check `(owner_type <> 'event' or event_public_id = owner_public_id)` and `(owner_type <> 'course' or event_public_id is null)`.
- Unique `(id, project_id, owner_type, owner_public_id)` on series; composite FK from occurrences `(series_id, project_id, owner_type, owner_public_id)`. Keep the old FK (a NULL column skips it for course rows).
- Index `(project_id, owner_type, owner_public_id) where removed_at is null` on series.
- `removed_reason` check: add `'closure'`, `'series_ended'`.
- Existing RPCs `event_schedule_save_one_off` etc. must keep working unchanged for events (they insert event_public_id; set owner columns too → recreate them with owner columns filled, same signature).

### 1b. New columns on `event_series`
- `edition_id uuid null` (FK to `schedule_editions`, same project — composite FK `(edition_id, project_id)`).
- `languages text[] not null default '{}'` (each `^[a-z]{2}$`, ≤ 6).
- `meeting_room_id uuid null` (composite FK to `schedule_meeting_rooms (id, project_id)`).
- `rule_weekday smallint null` (1=Mon…7=Sun) — the weekly preset, alongside `rule` text `FREQ=WEEKLY;INTERVAL=n;BYDAY=XX`.
- `starts_on date null`, `ends_on date null` — first / last possible date of a repeating series (bounded also by the edition).

### 1c. New tables
- `schedule_editions`: id, project_id, owner_type null / owner_public_id null (null = whole site timetable), `label jsonb` (localized, `{en,fr,…}`), `starts_on date not null`, `ends_on date not null` (ends_on ≥ starts_on), `time_zone text not null`, version, timestamps, `removed_at`. Unique `(id, project_id)`.
- `schedule_closures`: id, project_id, edition_id null (null = every series of the project), `starts_on`, `ends_on`, `label jsonb`, timestamps, `removed_at`. Unique `(id, project_id)`.
- `schedule_meeting_rooms`: id, project_id, `label text` (≤ 80), `join_url text null` (https only), `meeting_id text null` (≤ 40), `passcode text null` (≤ 40), `note jsonb null`, version, timestamps, `removed_at`. Unique `(id, project_id)`. **Private:** only read by server code for authenticated dashboard users or Access-protected pages.

### 1d. Functions
- `schedule_series_save(p_project_id, p_series_id uuid null, p_owner_type, p_owner_public_id, p_edition_id, p_time_zone, p_start_local timestamp, p_end_local timestamp, p_rule text, p_rule_weekday, p_starts_on, p_ends_on, p_place jsonb, p_attendance_mode, p_instructors uuid[], p_languages text[], p_meeting_room_id, p_expected_version, p_actor)` → `(series_id, version)`. Create when `p_series_id` null; else version-checked update. Validates edition / meeting room belong to the project.
- `schedule_occurrences_sync(p_project_id, p_series_id, p_from timestamptz, p_rows jsonb)` → `(inserted int, updated int, removed int)`. `p_rows` = `[{original_start_local, start_local, end_local, starts_at, ends_at}]` = the full generated set for sessions starting at/after `p_from`. In one transaction with the series row `FOR UPDATE`:
  - insert rows whose `original_start_local` is missing (owner and time zone from the series);
  - update times of existing **non-modified** rows that changed;
  - tombstone (`removed_reason='closure'` when flagged in the row set's `p_closed` list, else `'rule_changed'`) existing **non-modified** rows at/after `p_from` not in the set;
  - never touch rows before `p_from`, never touch `is_modified` rows (they are reported by the TS layer).
  - A second jsonb param `p_closed` (array of original_start_local) marks rows removed because of a closure.
- `schedule_occurrence_update(p_project_id, p_occurrence_id, p_expected_version, p_status text null, p_instructor_override uuid[] null, p_clear_instructor boolean, p_start_local, p_end_local, p_starts_at, p_ends_at, p_note jsonb null, p_clear_note boolean)` → new version. Sets `is_modified = true` when times or instructors change.
- `schedule_series_end(p_project_id, p_series_id, p_expected_version)` → tombstones the series and its future sessions (`series_ended`), keeps past ones.
- Editions / closures / meeting rooms: plain service-role table writes from the store are fine (single-row, version check in the WHERE clause); no RPC needed.

## 2. TypeScript scheduling layer (`src/lib/scheduling/`)

Keep every existing export working (events). New files:
- `recurrence.ts` (pure, client-safe): `parseWeeklyRule`, `formatWeeklyRule({weekday, interval})`, `expandWeekly({ weekday, interval, startTime:'HH:mm', endTime:'HH:mm'|null, timeZone, from:'YYYY-MM-DD', until:'YYYY-MM-DD', anchor:'YYYY-MM-DD', closures:[{startsOn, endsOn}] }) → { sessions:[{originalStartLocal, startLocal, endLocal, startsAt, endsAt}], closed:[originalStartLocal] }`. Uses `resolveSessionTimes` for UTC. Hard cap 400 sessions.
- `course-store.ts` (server): `createCourseScheduleStore()` with: `listSeries(projectId, {ownerPublicIds?, editionId?})`, `saveSeries(input)`, `endSeries`, `syncSeries(projectId, seriesId)` (reads series + edition + closures, expands from today − 0 days until min(series.ends_on, edition.ends_on), calls `schedule_occurrences_sync`), `updateOccurrence(input)`, `occurrencesInWindow(projectId, {from, to, ownerType?, ownerPublicIds?})` returning occurrences enriched with series fields (ownerPublicId, languages, meetingRoomId, attendanceMode, place, instructors), editions CRUD, closures CRUD (saving/removing a closure re-syncs affected series), meeting rooms CRUD + `meetingRoomsById(projectId, ids)` (server-only, never sent to a public page unless protected).
- `course-guarded.server.ts`: the only write entry for dashboard actions: re-checks instructors via `guardInstructors`, place location key exists in siteConfig.locations or venue belongs to project, owner course belongs to project (Sanity read by projectSlug + publicId).
- Tests for all pure logic (DST weeks Europe/Brussels March/October, closures, interval 2, caps, until before from) and store input validation with a fake db.

## 3. Courses module (Sanity + module registry)

- `src/lib/modules/courses/`: `schema.ts` (document `course`: `publicId` (shared `publicIdField`), `projectSlug`, `title` localizedString required, `shortDescription` localizedText, `defaultTeachers` NOT stored (teachers live on series), `color` optional enum of design-system-safe keys (`none|accent|muted`), `archived` per ADR-032 lifecycle fields if the People module pattern has them), `queries.ts`, `model.ts`.
- Registry entry `courses` (after `people`), category `content`, `dataStore.primary: 'hybrid'`, `dependencies.integratesWith: ['people','events']`, sectionTypes `['timetableSection']`, permissions:
  - `courses.course.read` (owner, editor), `courses.course.write` (owner, editor), `courses.course.delete` (owner),
  - `courses.schedule.write` (owner, editor) — classes, exceptions, terms, closures,
  - `courses.meeting.manage` (owner) — meeting room details. Support mode never writes it (`SUPPORT_NEVER_WRITES`).
- Non-routable for now (no slug): add to the non-routable list in docs if one exists.

## 4. Dashboard

Rules: Component Lab only (read `src/lab/registry.ts` first), list-screen kinds, Title Case nav, 24-hour times in the site time zone (`editingZone`), all strings in `messages/{en,it,de}.json` (English source; it/de may be machine-filled later by `scripts/i18n-translate.mjs`, so add English and best-effort it/de).

- Nav: **Courses** (content group, segment `courses`, permission `courses.course.read`). Add segment to `CLIENT_PROJECT_SEGMENTS`.
- `/{project}/courses` — `CoursesBrowser.tsx` (KIND `content`): list ⇄ cards; columns: title, number of weekly classes, teachers, next class. "New course" (title in default language).
- `/{project}/courses/{publicId}` — course editor: Words (title, short description per language, Translate where the platform offers it), **Classes** panel (this course's series: weekday, time, place, teacher(s), languages, mode, meeting room; add / edit in a sheet; end class), Archive/Delete per ADR-032 (delete only when no sessions exist).
- `/{project}/courses/timetable` — **Timetable**: term selector (create/edit term: label, start, end), grid locations × weekdays on desktop (rows = place, columns = weekday, cells = classes with time, course, teacher, language, mode badge), per-day list on phone. Click a class → sheet with its upcoming dates (8 weeks, "more"), each date: Cancel / Restore, Substitute (PersonPicker), Change time, Note (localized short text). Panels: **Holidays** (closures list + add), **Online rooms** (meeting rooms; needs `courses.meeting.manage`).
- Server actions in `src/app/[locale]/(client)/[tenant]/courses/actions.ts` → `src/lib/api/course-*.ts` (assertModuleAction first, identity from the grant, opaque error codes), same style as `src/lib/api/persons-*.ts` / `event-drafts.ts`.

## 5. Website — `timetableSection` (module-gated by `courses`)

Fields:
- `title`, `intro` (localized)
- `defaultView`: `week` | `month`
- `allowViewSwitch` (boolean, default true)
- `courses`: all, or selected course refs
- `showOnlineDetails` (boolean, default false; effective ONLY when the page is protected by Access — verified server-side, never trust the flag alone)
- `showPrintButton` (default true)

Render:
- **Week view:** Mon–Sun columns, today's week, prev/next.
- **Month view:** calendar grid.
- **Print:** a print-only layout of the selected month in the CYCE style — rows = places (with address/room from siteConfig.locations), columns = weekdays that have classes; each cell lists the weekly classes (time, teacher linked to People profile when it has a page, language, course, hybrid badge) and that month's exceptions ("7/12 sub Sabrina", "18/12 no class"); a header line with closures ("last class 17/12, first class 7/1/2027"); online rooms block (only if online details allowed). Use `window.print()` + `@media print` CSS; no PDF library.
- Times in the site time zone, 24-hour, labels from the website dictionaries for the page locale (content locale, e.g. fr).
- Data via one server reader `timetableForSection(projectSlug, window, opts)` that returns plain JSON (no meeting details unless allowed).
- Follow the New Section Checklist in CLAUDE.md (schema arrays for `page` + legacy `homePage`, export, types, queries in all three page queries, both `[tenant]/page.tsx` and `[tenant]/[slug]/page.tsx` SectionRenderer cases, hydration in both routes, Studio preview).

## 6. Not negotiable
- Never write to production Supabase; live tests and rehearsals use `.env.sandbox.local` with `assertSandboxSupabase`.
- No meeting details in any public query, sitemap, partner API, JSON-LD or cache that isn't per-request and protected.
- No hard-coded tenant names, locales or English UI strings in components.
- `npx tsc --noEmit` and `npx vitest run` green.
