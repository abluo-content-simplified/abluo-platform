# ADR-043 — People module: one list of people per site, reused everywhere

**Status:** Proposed. Decisions approved by Tom on 2026-11-03; implementation not started.
**Date:** 2026-11-03
**Owner:** Tom
**Relates:** ADR-038 (Events scheduling — amended by this ADR, see D9), ADR-020 Amendment B (module vocabularies), ADR-022 (Gallery, focal points), ADR-023 (Translate), ADR-025/029 (tenant editor and dashboard), ADR-028 (roles), ADR-031 (Connections), ADR-032 (content lifecycle), ADR-037 (FAQ — field-helper pattern)
**Working paper:** project doc `claude/people-module-brief-v1.1-review-2026-11-03.md`

---

## Context

A site's people are stored three times today, each time as a copy: inline `teamMemberObject`s in `teamSection`, `postAuthor` documents (Blog), and inline `eventHost` objects (Events). ADR-038 also planned a fourth store, `eventInstructor`, not yet built. Courses (next) need teachers. One person must be created once per site and referenced everywhere.

## Decisions

### D1 — Names and placement in the dashboard
- This module is **People**, in the **Library** group (next to Media and Categories & Tags): a shared list other modules pick from.
- The existing ADR-028 page (site logins and invitations, today `/{project}/people`) is renamed **Users** and moves under **Project**. "Access" is not used — it is the members module's label.
- The `people` route segment moves to this module; `/{project}/people` for logins becomes `/{project}/users` with a redirect.

### D2 — Where the data lives (split by audience)
| Sanity `person` (public, editorial) | Supabase `person_private` (server-only) |
|---|---|
| `projectSlug`, `publicId`, first name, last name (required), display name, honorific (localized), professional title (localized), groups (vocabulary keys), photo → `mediaAsset`, short bio (localized text), long bio (restricted rich text, localized), languages, website, **public** contact methods, qualifications (text), status, website visibility, `localizedSlug` + `redirectFrom`, sort order | key `(project_id, person_public_id)`; **private** contact methods, birthday (optional), internal notes, `linked_user_id` (nullable, unused in V1) |

- Reason: Sanity gives the public profile Translate, Media Library photos, drafts/publish, history and direct references for free. Private data never sits where a website query could project it.
- `person_private` follows ADR-038 D8: RLS on, no grants to `anon`/`authenticated`, service role only, every call authorised by `assertModuleAction` and scoped by `project_id`. Sandbox first.
- The editor shows one form. Making a contact method private moves it from Sanity to Supabase in one server action (Sanity first, then Supabase — ADR-038 D5).
- Birthday is optional and empty by default. The site's privacy policy (tenant legal documents) must mention it when used.
- Contact types: email, phone, WhatsApp, Instagram, LinkedIn, website, custom URL. Each has an optional label, public/private (default **private**) and a preferred flag.

### D3 — Groups
Groups ("Dentist", "Yoga Teacher", "Author") are a People **vocabulary** in Categories & Tags (ADR-020 B): stable keys, localized labels, rename-safe. No `PersonRole` entity. Group labels are for filtering; the per-person professional title carries the wording shown on cards.

### D4 — Status and visibility
- **Status:** Active / Archived (ADR-032).
- **On the website:** Off / Listed / Listed + own page.
- **Off** → never rendered anywhere (an event shows no teacher, a post shows no author).
- **Archived** → still rendered on content that already references them; gone from team listings; own page 308s to the site's people page.
- **Anonymise** (owner only): clears photo, bios, contacts, links and private data; keeps `publicId`; rendered as nothing. Permanent deletion only when unreferenced (ADR-032).

### D5 — Relationships
One field helper `peopleRefsField({ role })` (pattern of `faqSetsField()`), one projection `PERSON_PUBLIC_FIELDS`, one server renderer.

| Placement | Field | Notes |
|---|---|---|
| `teamSection` | `people[]` (ordered refs) **and/or** `groupFilter` | Group filter shows members in the global order; hand-picked overrides it. Inline `members` kept as deprecated fallback. |
| `post` | `authors[]` (ordered refs) | First = main author (bylines, `Person` JSON-LD). Old `author` → `postAuthor` read as fallback. |
| `event` | `hosts` → refs | Inline hosts kept as fallback. |
| `event_series` / `event_occurrences` | existing `instructor_public_ids` / `instructor_override` | See D9. |
| News | none | News stays authorless; a future byline uses this module. |

People merely mentioned in body text stay text. A **test fails if any website query projects a `person` field outside `PERSON_PUBLIC_FIELDS`**.

### D6 — Ordering
One global order per site (drag in the People list). A team section may hand-pick and reorder.

### D7 — Website
- People card grid (team section), byline (posts, events), optional profile page.
- Profile pages follow the five-requirement routable checklist. The base path is per site and localized (`/team`, `/insegnanti`…) — People module config, never hardcoded.
- No photo → initials on a colour from the design system.
- Public emails are never in the HTML as plain text (obfuscated, assembled client-side); WhatsApp opens click-to-chat.
- `Person` JSON-LD on profile pages and as `author` on posts.

### D8 — Editing and permissions
- Clients edit in the tenant dashboard (built only from Component Lab components); Studio is read-only for People.
- List screen kind **Content** (ListToolbar + DataTable + ContentCard, list ⇄ cards).
- Editor: Profile · About · Contact · On the website. Only first + last name required.
- `PersonPicker` is a shared component (Lab entry + demo): search, photo/name/group, multi-select with order, "Add new person" in a sheet without leaving the current editor.
- AI: "Shorten" (long bio → short bio) and Translate on every localized field.
- Permissions (ADR-028): `people.read`; `people.write` (owner, editor); `people.archive`, `people.anonymise`, `people.delete` (owner). Server-enforced with capability checks.

### D9 — Amendment to ADR-038
`eventInstructor` is **not built**. Event instructors, hosts and speakers are `person` documents, referenced by `publicId` exactly as ADR-038 D2 specifies. Permissions `events.instructor.*` are replaced by `people.*`. The Supabase columns are unchanged.
- Inheritance is already correct (`store.ts`): `instructor_override` **null** = inherit the series; **`{}`** = explicitly nobody.
- Different teacher per weekday = one series per weekday under the same event. One date = occurrence override.
- **New guard:** every scheduling, post and section write checks that each referenced person `publicId` belongs to the same project (`assertPeopleBelongToProject()`); today `store.ts` only checks the id is a UUID.

### D10 — Migration (never ahead of the readers)
1. Ship the module; readers prefer refs and fall back to inline / `postAuthor` / inline hosts. No site changes.
2. Per tenant, a dry-run script proposes `person` documents from existing team members, authors and hosts, listing possible duplicates for Tom — never auto-merged.
3. Order: **CYCE first** (not live), then **Studio Martegani**, then the rest.
4. Keep existing `anchorId`s working (`/teachers#florian-parra` → profile page when one exists).
5. Hide deprecated fields only after every tenant is verified; remove in a later release.

## Out of scope (V1)
HR, payroll, booking, attendance, availability; certification documents and renewals (later, private Supabase Storage); gender; person self-service login (`linked_user_id` reserved); partner-API exposure; cross-tenant identities; catalogue/book authors; birthday features.

## Tests required
Cross-project isolation (Sanity refs and Supabase ids); no private or non-whitelisted projection; Off / Archived / Anonymised rendering; `null` vs `{}` override; multiple authors with main author; slug redirect and sitemap; email obfuscation; Users rename redirect; Lab guards for `PersonPicker`.

## Amendments (2026-11-03, during the build)

- **A1 — Sandbox exception (Tom).** `063_person_private.sql` is a new, isolated, additive table, so it is applied directly to the live Supabase project, without the ADR-038 D8 sandbox rehearsal. The safety step is moved: after applying, run the migration's CHECK block (anon/authenticated have no access) **before** the dashboard writes any private data. Automated tests still run against the Sandbox only. ADR-038 D8 "sandbox first" stays in force for any change to existing tables.
- **A2 — Build deviations accepted:** person references are **weak** (a draft person can be attached; deleting is guarded by the service, not by Sanity); `person` is not in the public lifecycle rule set (archived people stay visible on content that names them, enforced by the People conditions + projection test); anonymise is audited as `deleted` with `detail.anonymised = true`; post authors are a wizard step (like Gallery/FAQ); People is in the "Show" group of the module order and "Library" in the dashboard sidebar; the Categories & Tags manager still says "Categories" for People groups (no per-module labels yet).
- **A3 — Not yet built:** dashboard Translate button for People fields (the Translate API is admin-only today); People activity sheet; `profileSegment` validator in module settings (the route ignores invalid/reserved segments); profile-page draft preview; an instructors UI (only the server guard exists, `saveOneOffGuarded`).
- **A4 — One-name people (Tom, 2026-11-03).** Only the first name is required; the last name is optional (CYCE's Emmanuelle and Dorota have no known surname). Applies to the schema, the service, the dashboard, the PersonPicker and the migration scripts.
- **A5 — Finishing round (2026-11-03).** Built: Translate button on People title and short bio (tenant path per ADR-023: `people.person.write` + Translate installed, metered, never overwrites original/reviewed); person activity sheet; "Groups" wording for People in Categories & Tags; `profileSegment` validator (syntax, reserved, page clash per language, Catalogue clash); draft preview of profile pages (`/{locale}/{project}/preview/person/{id}`, signed 15-minute link, noindex) with a Preview item in the editor menu. Still open: Translate for the long bio (no Portable Text translator yet), "mark as reviewed", instructors UI (Courses), removal of the deprecated inline fields.
