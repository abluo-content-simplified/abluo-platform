# ADR-047 — Dashboard search (v1)

**Status:** Accepted — v1 built 2026-11-08 (D3 field list confirmed by Tom; recent items in v1).
**Date:** 2026-11-08
**Owner:** Tom
**Relates:** ADR-030 (shared Abluo App layer), ADR-042 (dashboard navigation foundation), ADR-043 (People — public vs private), ADR-022 (Gallery / Media), ADR-033 (Catalogue), ADR-045 (Courses), migration 030 (contact requests follow `forms.submission.read`), Component Lab rule

---

## Context

The client dashboard has no search. As modules grow (posts, events, courses, catalogue, people, media, contact requests), finding "the course that mentions March" or "the request from Rossi" means opening each list. Tom also wants help and an "Ask Abluo" assistant (2026-11-08); those depend on help content that does not exist yet and are **out of scope here**. This ADR fixes the foundation they will plug into later.

## Decisions

### D1 — One search, as an overlay
- **Desktop:** search field at the top of the side nav (above Home) with a ⌘K / Ctrl K hint; a search icon when the nav is collapsed to the rail. Opens a centred dialog.
- **Phone:** search icon in the top bar beside the avatar. Opens a full-screen sheet with the keyboard up.
- No desktop top bar, no search results page. Esc closes; arrow keys + Enter navigate.
- **Client dashboard first.** The component is built in the shared Abluo App layer (ADR-030) so the admin dashboard adopts it later with no rewrite.

### D2 — Result groups, in this order
1. **Go to** — from `buildClientNavItems()` (same source as the side nav).
2. **Create** — from `buildCreateMenu()` (same source as the + sheet).
3. **Content** — one group per module, max 5 results each, last row "See all in {Module}".
4. *(Later)* **Help** and an **Ask Abluo** row — reserved, not built in v1.

Because Go to and Create reuse the existing builders, they inherit installed-module and permission filtering with no new logic.

### D3 — What is searched (v1) — *Tom to confirm*

Only modules **installed on the project** and readable by the person (the module's `*.read` permission).

| Module | Fields searched | Weight |
|---|---|---|
| Blog — posts | title · excerpt · category names · body text | title ×3, excerpt ×2, body ×1 |
| Events | title · summary/description · venue name · body text | same pattern |
| Courses | title · description · teacher names · body text | same pattern |
| Catalogue — items | public name · description · collection/category names | name ×3 |
| People | name · role/title · public bio | name ×3 |
| Media | title · alt text · filename · tags | title/alt ×2 |
| Contact requests | sender name · email · subject · message | name/email ×3 |

- **All content languages** of each field, not only the interface language.
- **Drafts included** (they are what people come back to). **Archived** only with a "Show archived" toggle. **Deleted / in the bin** never.
- **Contact requests** appear only for people holding `forms.submission.read` on that project — the same rule as the Requests screen (migration 030). Queried in Supabase, server-side.

**Not searched in v1:** website pages and sections (admin-managed); private People data (`person_private`); settings values; Documents (wait for Access Management); News, Live, Galleries, FAQ (candidates for v1.1 — add by declaring fields, see D4).

### D4 — Modules declare their own search fields
- New optional `search` block on `ModuleManifest`: document type(s), fields with weight, result title/subtitle/thumbnail projection, and the dashboard route of a result.
- Search code never names a module. A new module becomes searchable by declaring its block.
- **Guard test:** a module with dashboard content and no `search` block (and not in an explicit `NOT_SEARCHABLE` list with a reason) fails the build — same pattern as the Lab guards.

### D5 — One server action, safe by construction
- `searchDashboardAction` (`src/app/[locale]/(client)/[tenant]/search-actions.ts`, via `resolveProjectAction`) resolves the `ProjectGrant` server-side (project slug never trusted from the client), then:
  - **Sanity:** one GROQ query across the declared types, filtered by `projectSlug`, using `score(boost(...))` over the declared fields and `pt::text()` for rich text; capped per type.
  - **Supabase:** one query on form submissions, only if the grant holds `forms.submission.read`; RLS still applies.
- **Limits:** min 2 characters, ~250 ms debounce, 5 results per group, up to 4 words. No search runs while the overlay is closed. (No server cache in v1 — the debounce keeps it to about one query per pause.)
- **Nothing leaves Abluo:** no AI, no third-party search service in v1.

### D6 — "See all in {Module}" reuses the list screens
List screens accept `?q=` and pre-fill `ListToolbar`'s search. No new search page. (Today `ListToolbar` does not read the URL — small change, applies to every list screen.)

### D7 — Shared component, multilingual
- `SearchPalette` in `src/components/app/ui` — Lab registry entry + demo with fixture data (no backend), built from existing parts (DialogFrame / BottomSheet, fields, EmptyState).
- All text from `messages/{en,it,de}.json`: placeholder, group names, "See all in …", no results, "Show archived", keyboard hints, aria labels.
- States: empty (Recent — last 6 opened items, per project, in the browser's localStorage — then Go to and Create), loading (Skeleton), no results, error.

## Consequences
- Search becomes the place Help and Ask Abluo slot into later (D2 group 4) without redesign.
- Every new content module carries one more manifest block; the guard test makes it impossible to forget.
- Sanity load grows with typing; the D5 limits keep it to roughly one query per pause.

## v1.1 (2026-11-08)
- **Accents:** GROQ `match` is case-insensitive but accent-sensitive. Each word is OR-ed with its accent-folded form and, for words of 4+ letters ending in a vowel, its stem (`perche` → `perch*` finds "perché"). Mid-word accents are not covered.
- **Snippets:** when the title doesn't show the match, a second request for the shown ids only returns the matching text; the row shows "…around the **match**…" instead of the subtitle.

## Known gaps (accepted for v1)
- **No typo tolerance or meaning-based search** ("teeth cleaning" won't find "dental hygiene"). Revisit with Sanity embeddings if real use shows misses.

## As built (v1) — where it differs from the table
- **Categories and tags** match on their names (taxonomy term labels, any language) as well as the stored keys (v1.1, 2026-11-08).
- **Course teacher names are not searched** — they live in the Supabase schedule, not the course document. v1.1.
- **Media**: also matches animations (no thumbnail for them).
- A draft carries its published twin's state (`_pub`), so a draft whose text matched is not mislabelled "draft only".
- `?q=` on a list screen starts with the other filters at their defaults (a remembered "last 7 days" could hide the match) and does not overwrite the remembered filters; `?open=` opens one item on Media and Contact Requests.
- In a support visit each search writes one support-audit entry (the action pattern); contact requests only when the visit shows them.

Code: `src/lib/search/` (engine, guard `NOT_SEARCHABLE`), `ModuleManifest.search` in `src/lib/modules/types.ts` + `registry.ts`, `src/components/app/ui/SearchPalette.tsx` + `SearchTrigger.tsx`, `src/components/client/search/`, `src/lib/client/search-landing.ts`.
