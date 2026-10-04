# ADR-025 — Client content editor: guided creation, autosave, scheduling

- **Status:** Proposed (2026-10-04)
- **Owner:** Tom
- **Related:** ADR-017 (client dashboard), ADR-020 (modules, category keys), ADR-022 (Gallery / Media Library), ADR-023 (Translate), route-auth-matrix, `docs/engineering/client-dashboard/content-wizard-spec.md`, `docs/engineering/client-dashboard/verification.md`

## Context

Clients never see Sanity (CLAUDE.md principle 4). Today the client dashboard is read-only. The first write path is the blog editor. Tom wants it to feel like Airbnb's listing flow: one decision per screen, mobile first, and **no possibility of losing work**. The dashboard ships in light and dark.

## Decisions

### D1 — The Sanity draft is the single source of truth
- Choosing a content type creates `drafts.<uuid>` straight away, with `projectSlug` taken from the server-side grant (never from the request body).
- Edits go through one server action per document (`patchDraft`). It is debounced on the client (~800 ms, plus a flush on blur, `visibilitychange` and `pagehide`) and sent with `ifRevisionID`. If the revision has moved (another tab or device), the patch is refused. The UI then shows "Edited elsewhere — reload" and never overwrites silently.
- Every write path goes through `assertModuleAction(module, 'edit')` → `tenantScopedSanityClient` → `assertSameTenantReference`. The routes are classified in `route-auth-matrix.test.ts`.
- Reading drafts needs the private-dataset read token with `perspective: 'drafts'`. Only the dashboard data layer does this. Website queries stay on `published`.

### D2 — Offline journal in the browser
- Every pending patch is first written to IndexedDB (keyed by document and field). It is replayed in order when the connection returns. This covers a phone call, lost signal or a closed tab.
- The journal is a buffer, not a store. Once the server confirms, the entry is deleted. If IndexedDB is unavailable, the editor still works online.
- Save state is one small pill: `Saving…` → `Saved` → `Offline — saved on this device`. There is no Save button.

### D3 — Wizard position lives in Supabase
- New table `content_drafts_progress (user_id, project_id, document_id, step, updated_at)`, with RLS so a user only sees their own rows.
- "Continue editing" opens the step the user was on, on any device. Once a document is published, its row is deleted and further edits use the direct editor.

### D4 — Schema additions to `post` (additive only, no migration)
| Field | Type | Why |
|---|---|---|
| `subtitle` | `localizedString` | Wizard step 3. |
| `unpublishAt` | `datetime` | Optional "take offline automatically". |
| `promotion` | object `{ homepage: boolean, featured: boolean, pinned: boolean }` | S10 only. It renders only once a section reads it. |

- **Excerpt** stays. When it is empty, it is filled by default from the subtitle (and later by AI).
- **SEO title** defaults to the title. **SEO description** defaults to excerpt, then subtitle.
- **Author** defaults to the `postAuthor` whose `supabaseUserId` matches the current user. If there is none, it is created on first publish.
- Every new field is checked against the five-step Schema Evolution rules and the routable-content checklist (no new routes).

### D5 — Scheduling and expiry need no job runner
- A scheduled post is a **published** document whose `publishedAt` is in the future.
- Every website list and detail query adds `publishedAt <= now() && (!defined(unpublishAt) || unpublishAt > now())`. The sitemap does the same.
- ISR revalidation time for blog surfaces is ≤ 5 min, so a scheduled post shows up within that window. No cron and no Sanity Releases.

### D6 — Body editor: `@portabletext/editor`
- It stores native Portable Text, so there is no HTML↔PT conversion and it matches `localizedPortableText`.
- **Gate:** a one-day spike on iOS Safari plus React 19 / Next 16. If it fails, fall back to TipTap with the round-trip converter proven in the Hoffmann migration.

### D7 — Dashboard theming
- The dashboard uses Abluo's own semantic tokens (`globals.css`, shadcn: `background`, `foreground`, `card`, `muted`, `border`, `primary`…). It never uses tenant DS tokens, and never raw palette classes (`zinc-*`, `gray-*`, `#hex`, `bg-white`, `text-black`).
- Default is **follow system**. A Light / Dark / Auto switch in the account menu is saved per user (Supabase profile) and mirrored in a cookie so the first render doesn't flash.
- **Only exception:** the Preview step renders the real article with the tenant's design system, inside a frame.

### D8 — Content types are module-driven
- The "What would you like to create?" cards come from installed modules that declare `dashboard.create` and for which the user holds `edit`.
- When there is exactly one type, the step is skipped.
- Blog is first. News and Events use the same wizard shell later, with their own step lists.

### D9 — Machine translation stays a draft
- The Languages step calls the Translate module (ADR-023) and writes values with `translationStatus: 'machine'`. It never overwrites `original` or `reviewed` text.
- Publishing the original language never waits on translations.

## Consequences
- First tenant write surface, so the security review is mandatory for S2.
- One new Supabase migration (D3) plus a profile column for the theme (D7).
- Website queries change (D5). Every blog query is touched, so `npm run test` must cover the filter.
- `@portabletext/editor` is a new dependency (gated by the D6 spike).
- New dev dependencies for the verification harness: `@playwright/test` and `@axe-core/playwright`.
