# ADR-048 — Testimonials module

**Status:** Accepted (2026-11-08 — Tom approved Phase 1 and Phase 2 together, to be built in one go)
**Date:** 2026-11-08
**Owner:** Tom
**Relates:** ADR-018 (Forms), ADR-020 B (module vocabularies), ADR-023 (Translate), ADR-025/029 (tenant editor and dashboard), ADR-028 (roles), ADR-032 (content lifecycle), ADR-037 (FAQ — module pattern), ADR-040 (Access), ADR-043 (People — public/private split), ADR-047 (dashboard search), Sections vs Modules (CLAUDE.md)
**Working papers:** `claude/testimonials-module-brief-2026-11-08.md`, `claude/testimonials-module-assessment-2026-11-08.md`

---

## Context

Testimonials are sold as an everyday module (pricing page: Flex / Complete, Yoga & wellness package) but don't exist. Two tenants are waiting: **CYCE** (en + fr) and **Claudia Hoffmann** (it, de later; 5 real testimonials). Tom decided on 2026-08-29 that testimonials are a **module, not a section** ("very similar to the blog").

Guiding rule from Tom (2026-11-08): **keep it simple for the tenant and the visitor.** The tenant decides what to publish; the visitor decides what to share. The platform doesn't add legal gates or forced defaults beyond one permission tick.

## Decisions

### D1 — Module `testimonials`
- Registry entry following FAQ / People: schema types `testimonial`, `testimonialsSection`; Studio collection per project (`projectSlug`); installable per project via `moduleInstallations`; `integratesWith: translate, forms, categories`.
- Nav label **"Testimonials"**, Content group.
- `testimonialsSection` is module-gated: no installation → the section renders nothing.

### D2 — Public `testimonial` (Sanity)

| Field | Type | Notes |
|---|---|---|
| `displayName` | string | As the person wants it shown: full name, nickname, initials. Not localized. |
| `anonymous` | boolean | Shows the dictionary label ("Anonymous" / "Anonimo" / "Anonyme" …) instead of a name. |
| `context` | localizedString | Optional line: "Member since 2019", "Hatha course". |
| `age` | number | Optional. |
| `abstract` | localizedText | Optional short version. Empty → the card shows the first ~3 lines of `body`. |
| `body` | localizedText | The full testimonial (plain paragraphs — it's a quote, no rich text). |
| `originalLocale` | string (site locale) | Language it was written in. Drives the "Translated from …" label (D6). |
| `rating` | number 1–5 | Optional. Never required of anyone. |
| `givenOn` | date | When the person gave it. |
| `source` | enum: website · google · facebook · trustpilot · other | Plus optional `sourceUrl`. Attribution only, never a "verified" badge. |
| `featured` | boolean | The tenant's lever on what sections show. |
| `tags` | Testimonials vocabulary keys | Categories & Tags (ADR-020 B); lets a section show e.g. only "Couples therapy" testimonials. |
| `permissionToPublish` | boolean | **The one tick** (Tom, 2026-11-08). Required to Publish. Set automatically when the testimonial comes from a form submission whose consent box was ticked. |
| Lifecycle | ADR-032 | Draft · Published · Unpublished · Archived. No scheduling. |

**Not in V1:** photos (no visitor upload, no Media Library photo either — Tom), a People link, own pages.

### D3 — Private record (Supabase `testimonial_private`, new migration, Sandbox first)
- Key `(project_id, testimonial_public_id)`: full name, email, phone, internal note, `submission_id` (when it came from a form), `permission_given_at`.
- RLS on, no grants to `anon` / `authenticated`, service role only; every call through `assertModuleAction`, scoped by `project_id` (same as `person_private`, ADR-043 D2).
- All fields optional. The tenant stores only what the person gave.
- A test fails if any website query projects a field from this record (it isn't in Sanity, so this is a guard on the server actions that read it).

### D4 — Submissions reuse Forms (Phase 2 — timing Tom's call)
- A built-in **Testimonial form template** in the Forms module: display name, full name, email, phone (optional), testimonial text, rating (optional), the existing GDPR consent box.
- Submissions are stored, spam-checked, notified and retained by Forms as today; the original stays untouched.
- They appear under **Testimonials → Submissions**, not in Contact Requests (filtered by the form's purpose).
- **"Create testimonial"** copies the text into a new **draft** testimonial + its private record. Reject = submission status only. Nothing a visitor writes is ever published automatically.
- Members-only: place the form on an Access-protected page (ADR-040). No setting.

### D5 — Section `testimonialsSection`
- **Selection:** featured · latest N · by tag · hand-picked (Studio).
- **Layouts:** **carousel** (Tom) with previous/next buttons left and right, no autoplay, keyboard and swipe; plus **grid**. (Single large quote can come later as a third layout.)
- **Cards are short:** abstract, or the body cut to ~3 lines, then **"Read more"**.
- **"Read more" opens a window on the same page** (Tom, 2026-11-08): the full testimonial in a dialog — no page load, no own URL, so the routable-content checklist doesn't apply and names never become web addresses. Uses the shared dialog primitive; focus trapped, Esc closes, all labels from dictionaries.
- **Options:** show rating, show date, show source; **disclosure line on by default** ("Selected testimonials, published with permission" — localized dictionary text, tenant can switch it off).
- Full New Section Checklist (schema arrays, types, three queries, both SectionRenderers, Studio preview). Animations via `SlideUp` / `FadeIn` with motion tokens.
- One projection `TESTIMONIAL_FIELDS` in `queries.ts` for every placement; only Published, non-archived testimonials with `permissionToPublish`.

### D6 — Languages
- Every text field is localized. The Translate button works on them (ADR-023).
- When the shown text isn't in `originalLocale` and its `translationStatus` is `machine`, the card and window show **"Translated from French"** (etc., dictionary text naming the language in the visitor's language).
- A locale with no text: the testimonial is shown in its original language, labelled "(in French)". Never a mixed card.

### D7 — Structured data
None in V1: no `Review` / `AggregateRating`, and **no average rating ever computed over curated testimonials**. (An average shown for a synced external source, using that source's own figure, is a later integration.)

### D8 — Permissions

| Permission | Default roles | Covers |
|---|---|---|
| `testimonials.read` | owner, editor, viewer | List and view |
| `testimonials.write` | owner, editor | Create, edit, translate, publish, unpublish, archive, restore, tick permission, Create from submission |
| `testimonials.private.read` | owner, editor | See full name / email / phone |
| `testimonials.delete` | owner (Owner / Site admin) | Permanently delete (also removes the private record) |

All checks server-side; activity rows to `content_audit_log`.

### D9 — Dashboard
- **Testimonials** list: *Content* kind (ListToolbar + DataTable + ContentCard, list ⇄ cards, list first, remembered per person). Columns: Name · Excerpt · Rating · Languages · Featured · Status · Updated.
- **Editor** from Component Lab components only, mobile-first: text fields with language switch + Translate, rating, source, tags, featured, the **Permission to publish** tick, private contact fields in their own panel. Autosave to draft; Publish disabled until the tick is set, with the reason shown and a link to the tick (platform UX rule).
- **Done · Undo** after archive / unpublish; delete asks for confirmation (and uses Recently deleted once the platform bin exists).
- **Submissions** tab (Phase 2): *Records* kind (table, ListRow on phones).
- Indexed in dashboard search (ADR-047).

### D10 — Module config (one surface, ADR-014)
Only: accept submissions on/off (Phase 2) and which form is the testimonial form. Everything else is a section option or a form field choice.

## Phases

| Phase | Scope |
|---|---|
| **1** | D1–D3, D5–D9: module, schema, private record + migration (Sandbox first), section (carousel + grid + window), dashboard list/editor, Translate labels, tests. CYCE and Hoffmann enter testimonials by hand. |
| **2** | D4 + D10: Testimonial form template, Submissions tab, Create from submission. Built together with Phase 1 (Tom, 2026-11-08). |
| **Later** | Single-quote layout, placements on posts/courses (FAQ-style field helper), photos, Google Business Profile sync via Connections (read-only synced items), tenant replies, analytics. |

Phase 1 parts that don't depend on each other (schema + registry, migration, section, dashboard) are built in parallel.

## Consequences
- One more module following an existing pattern; no new infrastructure.
- Private data never in the public Sanity dataset.
- No own pages → nothing to add to sitemap, redirects or hreflang.
- Hoffmann's 5 testimonials can be entered as soon as Claudia ticks permission for each.
