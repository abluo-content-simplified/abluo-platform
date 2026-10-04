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

### D7 — One design system: a shared foundation, three surfaces
The Abluo app gets its own design system, built fresh rather than reusing the shadcn starter theme (2026-10-04, Tom). Light mode is inspired by Airbnb: ink on white, the main action in ink, selection shown by a border. Dark mode is Linear-style, using the current colours as its starting point. Tenant websites are unaffected; they keep their Sanity design systems.

- **Foundation, shared by every app surface:** colours (light + dark), fonts, focus, and base components (button, input, chip, card, SavePill, theme switch). Base components live in `src/components/ui`.
- **The app tokens are scoped, not global.** Tenant websites use the same variable names (`--background`, `--border`, `--primary`…) and rely on the `:root` values for the ones their design system doesn't emit. So the app tokens live under the app root (`.abluo-app`, with `[data-theme="dark"]`), never on `:root`. The app theme preference uses its own key (`abluo-app-theme` + cookie) and never touches the website theme switch (`abluo-theme`, `html.light`).
- **Surfaces** may adjust **size, spacing, radius, density and motion only — never colour or font**. Each surface is set by an attribute on its root (e.g. `data-surface="create"`):
  - **Create:** the tenant's guided creation flow (wizard). Generous type, large cards, more space and motion. Components go in `src/components/client/create/`.
  - **Manage:** the tenant's dashboard (home, lists, submissions, settings). Calmer and slightly denser.
  - **Admin:** the Abluo admin. The densest surface, plus a permanent admin marker: a slim top bar with a reserved admin-only accent colour, which no other surface uses. Adopted later; the admin's hardcoded colours (≈135 classes) are a separate cleanup.
- When an Abluo admin opens a tenant's dashboard (after migration 028), a banner reads "Viewing <project> as Abluo admin" and offers Exit. Tenants never see it.
- The default theme is **follow system**. A Light / Dark / Auto switch in the account menu is saved per user (Supabase profile) and mirrored in a cookie, so the first paint is right. The website's dark-first boot script (`html.light`) stays as it is; the app resolves its own theme on its root.
- No raw palette classes (`zinc-*`, `gray-*`, `#hex`, `bg-white`, `text-black`) in client code (verification T2).
- **Only exception:** the Preview step renders the real article with the tenant's design system, inside a frame.

### D8 — Content types are module-driven, with a soft upsell
- The "What would you like to create?" cards come from installed modules that declare `dashboard.create` and for which the user holds `edit`. Those are the only selectable cards.
- **The step is always shown, including for a single module** (Tom, 2026-10-04). When only one type is available it is pre-selected, so it stays one tap.
- Under the selectable cards, a quieter **"More you can add to your site"** row lists modules the project doesn't have (e.g. Events, Video). They are clearly not choices: smaller, with an "Add" label instead of a selection state. Tapping one opens a short sheet that explains it and offers "Ask us to add it", which sends a request to Abluo. Only owners see this row, never editors or viewers.
- Blog is first. News and Events use the same wizard shell later, with their own step lists.

### D9 — Languages: a step of its own, and no fallback to the default language
- On a site with more than one locale, the wizard has a **Languages** step after the cover and before the preview. The original language comes first. For every other language the choices are **Translate for me** (pre-selected), **I'll write it** and **Not now**. Translation runs in the background, and the preview can switch language. Single-locale sites never see this step.
- **A post appears only in the languages it has content for.** If a language has no title and body, the post is left out of that locale's lists, detail route, sitemap and hreflang. It never falls back to the default language and never shows as an empty page. This is a platform query rule, not a wizard rule (it also affects the `coalesce(field[$locale], field[$defaultLocale], …)` pattern for routable content, which needs a review).
- "Not now" stays visible: the Publish step lists each language with its status, and Home shows a "Missing translations" card until the language is filled or explicitly turned off for that post.
- Machine translation goes through the Translate module (ADR-023). Values are marked `translationStatus: 'machine'`, and `original` / `reviewed` text is never overwritten.
- **Per-site setting (Translate module config): "Publish translations automatically"**, on by default. When it is on, machine translations go live with the original and get a "review suggested" note in the app. When it is off, they wait for "Looks good" before that language goes live. Publishing the original never waits on translations.

## Consequences
- First tenant write surface, so the security review is mandatory for S2.
- One new Supabase migration (D3) plus a profile column for the theme (D7).
- Website queries change (D5). Every blog query is touched, so `npm run test` must cover the filter.
- `@portabletext/editor` is a new dependency (gated by the D6 spike).
- New dev dependencies for the verification harness: `@playwright/test` and `@axe-core/playwright`.
