# ADR-045 — Courses module

**Status:** Proposed (Phase 0, 2026-11-03) — awaiting Tom's approval
**Authority:** Courses brief v1.2, Tom 2026-11-03 ("two modules, shared engines")
**Relates to:** ADR-038 + Amendment A (scheduling, editions, recurrence), ADR-044 (Reservations), ADR-043 (People), ADR-032 (lifecycle), ADR-023 (Translate), ADR-025 (content editor)

## Context
Events stay simple ("something happens on this date"). Courses have editions, weekly classes, packages, passes and teachers per session. Putting both in one editor would burden every simple event. The pilot is CYCE: weekly classes sold as a yearly pass priced by joining date, plus workshops (which remain events).

## Decisions

### D1 — Two modules, two shared engines
- `courses` is a new module. Events is unchanged as a product.
- Both use **Scheduling** (ADR-038: series → sessions, recurrence, venues, teachers) and **Reservations** (ADR-044).
- Grey-zone rule: editions, several sessions or package/pass booking → course; otherwise event.

### D2 — Course content (Sanity, editorial)
- Document `course` (routable, five-requirement checklist): `publicId`, `projectSlug`, `title`, `slug` (`localizedSlug`), `redirectFrom`, `summary`, `description` (`localizedPortableText`), cover from Media Library, categories (module vocabulary, ADR-020 B), level, prerequisites, what to bring, accessibility notes, language of instruction, `faqSets` (FAQ module), gallery (Gallery module), SEO fields, publication fields per ADR-032 in one **Publishing** tab.
- All text localized; Translate button on every localized field.
- No dates, prices or capacity in Sanity.

### D3 — Editions (scheduling, Supabase — ADR-038 A2)
- A course has many editions ("CYCE 2026", "Spring 2027"): localized label, start/end date, time zone, status. Series (weekly classes) belong to an edition.
- Copying an edition copies series patterns, booking options and settings — never sessions, bookings or history.
- The edition dashboard (D6) is where tenants spend their time after publishing.

### D4 — Three state axes
- **Publication** (course and edition): ADR-032 Draft / Scheduled / Published / Unpublished / Archived.
- **Registration**: Reservations (`reservable_targets`).
- **Operation**: session cancelled; edition "completed" shown after its last session, never auto-archived.

### D5 — Website
- Route `/{locale}/{tenant}/courses/{slug}`. Path segment configurable per site like People's `profileSegment`, validated against reserved slugs.
- Sections (module-gated): `courseListingSection` (cards / list, category filter), `courseScheduleSection` (one course's upcoming sessions + booking CTA). The shared **calendar section** and **printable timetable** come from scheduling (ADR-038 A5) and can mix events and courses.
- Booking flow pages are Reservations routes, embedded in the course page as a sheet / step flow.
- JSON-LD: `Course` + `CourseInstance` (per edition/series, with `courseSchedule`, `instructor` from People, `offers` from booking options). Sitemap: one URL per locale with a slug.
- Visibility: one helper (ADR-038 D8) gates page, listing, sitemap, partner API and feeds.

### D6 — Dashboard
- Nav: **Courses** (Content group), segment `courses`, permission `courses.course.read`.
- **Courses list** = *Content* kind (list ⇄ cards). **Bookings** and **Participants** inside an edition = *Records* kind.
- **Create flow:** Basics → Schedule → Booking → Publish. Two bespoke wizards already exist (`WizardShell`, `ItemWizard`), so under the rule of two a shared **Stepper / Wizard** component must be built first and both existing wizards should move to it (separate small task; Tom's approval for the new component).
- **Course editor** sections: Words, Photo, Details, Teachers (default per series), Publishing.
- **Edition dashboard:** registration status, places per session, upcoming sessions, bookings, payments to confirm, eligibility to verify, minimum-participant warnings, failed urgent emails.
- **Schedule editor:** the shared scheduling editor (Events 2.0 Stage E), not a copy. Uses the existing `WeeklyScheduleEditor`, `DateTimePicker`, `PersonPicker`.
- Desktop lists/tables, phone cards and bottom sheets (Tom's UI rules); no new colours; 24-hour times in the project time zone.

### D7 — Teachers
Default teachers on each series (`instructor_public_ids`), per-session override (`instructor_override`), always via `assertPeopleBelongToProject`. Guests are host-only persons. No new structure.

### D8 — Capabilities (Studio → Modules → Courses, super admin)
Editions (on), recurring classes (on once Phase 2 ships), passes, packages, drop-in, joining-mid-term pricing, online sessions, printable timetable, course FAQ, course gallery. Defaults off except basics; disabled = hidden + server-rejected; stored content keeps rendering (ADR-038 D6 pattern).

### D9 — Permissions
`courses.course.read` (owner, editor), `courses.course.write` (owner, editor), `courses.course.delete` (owner), `courses.taxonomy.write` (owner, editor). Schedule writes reuse the scheduling guards. Booking permissions are Reservations' (ADR-044 D12).

### D10 — Clarifications from the Phase 0 cross-check
- **Routable checklist in full:** primary lookup (no slug fallback), redirect lookup, list query with resolved slug, route with `SlugMapProvider` and hreflang in `generateMetadata`, sitemap entries, migration N/A (new type).
- **Registration modes** per course edition: off / external link / Abluo bookings (ADR-044 D16.8).
- **Edition publication** is stored on `schedule_editions.publication_status` using the ADR-032 vocabulary (Amendment A2 corrected). Publishing stays under `courses.course.write` (ADR-032 decision: publishing under the edit permission). There is no separate `courses.publish`.
- **Calendar section** is a platform section (never module-gated). It shows whatever events and courses the site has installed and published.
- **Sections:** `courseListingSection`, `courseScheduleSection` and a teacher-links block on the course page; teacher profile links come from People routes.
- **Home widget:** "Needs attention" items (payments to confirm, eligibility to verify, minimum not reached, failed urgent emails) go into the existing ADR-029 attention list.
- **Dependencies:** course content, page and editor need no recurrence (step 3 in parallel). Showing and editing repeating sessions on a course needs Amendment A3.

## Consequences
- Courses is mostly editorial + composition; the hard parts live in shared engines once.
- Depends on ADR-038 Phase 1 cutover and Phase 2 recurrence.

## Out of scope
LMS features (lessons, progress, certificates), protected video (Access later), memberships (separate module).
