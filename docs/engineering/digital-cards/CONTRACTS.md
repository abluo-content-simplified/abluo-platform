# Digital Cards — build contracts (ADR-049)

Shared names every build stream uses. Change a name here first, then in code.

## Rules for every stream
- Read `CLAUDE.md`, ADR-049, this file. Follow the module patterns of **Testimonials (ADR-048)** and **People (ADR-043)** — copy their structure, guards and tests, don't invent new ones.
- Work in `~/Abluo/abluo-platform` on the user's machine (device shell). **Never run git writes** (no add/commit/stash/checkout/reset). Use `git --no-optional-locks` for reads. Other uncommitted edits in `src/lib/sanity/schema.ts` and `src/lib/sanity/queries.ts` (abluo credit) belong to another session: keep them, never revert.
- Deleting files is not permitted in the sandbox; don't rely on `rm`. `npm run build` may fail for sandbox (unlink) reasons — use `npx tsc --noEmit` and `npx vitest run` instead.
- No hardcoded user-facing strings: website strings in `src/lib/i18n/digital-cards-site-messages.ts`, dashboard strings in `src/lib/i18n/digital-cards-messages.ts` (en, it, de; same `getXMessages(locale)` pattern as testimonials-messages).
- Dashboard UI only from Component Lab components (`src/lab/registry.ts`); rule of two; handmade test must stay green.

## Identifiers
| Thing | Name |
|---|---|
| Module id | `digital-cards` (`DIGITAL_CARDS_MODULE_ID`) |
| Code folder | `src/lib/modules/digital-cards/` |
| Sanity document type | `digitalCard` (`DIGITAL_CARD_TYPE`) |
| Link object type | `digitalCardLink` |
| Permissions (prefix = module id, required by registry validation Rule 11; constants `DIGITAL_CARD_PERMISSIONS` in `model.ts`) | `digital-cards.read` (owner, editor, viewer) · `digital-cards.write` (owner, editor — edit, publish, unpublish, archive, restore) · `digital-cards.delete` (owner) · `digital-cards.stats.read` (owner, editor) |
| Lifecycle rule | `digitalCard: 'optional'` in `LIFECYCLE_PUBLIC_RULES` |
| Nav label | "Digital Cards" (en) · "Biglietti digitali" (it) · "Digitale Karten" (de) |
| Dashboard route | `/{project}/cards`, editor `/{project}/cards/[id]` |
| Website routes | `src/app/[locale]/(website)/[tenant]/link/page.tsx` (site card), `link/[name]/page.tsx` (person card), `link/contact.vcf/route.ts`, `link/[name]/contact.vcf/route.ts` |
| Proxy marker | request header `x-abluo-card: 1` (`DIGITAL_CARD_HEADER` in `src/lib/proxy/digital-card.ts`, with `isDigitalCardPath(pathname)`); response `X-Robots-Tag: noindex, nofollow` |
| Reserved segments | `link` (website tenant-level) and `cards` (client dashboard) in `src/lib/platform/reserved-slugs.ts` |
| Hit endpoint | `POST /api/cards/hit` |
| Retention cron | `GET /api/cron/digital-cards-sweep` (daily, in `vercel.json`) |
| Supabase migration | `supabase/migrations/068_digital_card_stats.sql` |
| npm | `qrcode@1.5.4` + `@types/qrcode` |

## `digitalCard` document (Sanity)
- `projectSlug` (projectSlugField)
- `publicId` string, readOnly, permanent (used by stats; never changes) — `validateUniquePublicId`
- `kind`: `'site' | 'person'`
- `person`: scopedRef → `person` (person cards only)
- `urlName`: string, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 60 (person cards only; unique per project across `urlName` AND `retiredUrlNames` of all cards)
- `retiredUrlNames`: string[] (append-only; redirect to current)
- `description`: localizedText (optional short text, ≤ 600 per language — `DIGITAL_CARD_LIMITS.description`, counted by `cardTextLength` on server, Studio and dashboard alike; person card falls back to People `shortBio`)
- `links`: array of `digitalCardLink` { `_key`, `kind`: `url|page|form|booking|whatsapp|phone|email|file`, `label` localizedString, `description` localizedString (optional one-liner under the label, ≤ 120 per language; shown on the card as described-by text, never in the vCard), `url` (url), `page` (scopedRef page), `file` (scopedRef mediaAsset), `value` (string: phone/email/whatsapp number), `hidden` boolean, `primary` boolean } — at most one `primary` among non-hidden links
- `background`: scopedRef → `mediaAsset` (person card: empty = inherit site card's)
- `show`: object of switches —
  - shared: `name`, `description`, `phone`, `email`, `whatsapp`, `saveContact` (booleans), `hiddenSocials` (string[] — the social profiles turned OFF; site: `socialLink.platform` values; person: People contact `_key`s of kind instagram/linkedin/website/url). **Amendment A:** profiles are on by default and stored as an opt-out, so a profile added later appears by itself. The old shown-list `socials` stays in the schema (hidden, read-only) but is never read or written; `resolveShow` derives `socials` = available − hidden (in source order).
  - site: `logo`, `businessName` (booleans), `locations` (string[] of `siteConfig.locations[]._key`; first = vCard address)
  - person: `photo`, `role`, `nameMode` (`'full' | 'first'`), `businessName`, `profileLink` (booleans)
- publishing: `publishingStatusField('optional')`, `unpublishOnField`, `archivedFields()` (same as testimonial)

Defaults (`defaultShow(kind)` in `model.ts`): site → all true, all socials, all locations; person → photo/name/role/businessName/profileLink true, every social profile shown, nameMode `full`, phone/email/whatsapp/saveContact false (D7). `hiddenSocials: []` for both.

## `model.ts` (pure, tested)
- `slugifyUrlName(fullName)`, `suggestUrlName(fullName, peopleSlug?, taken: Set<string>)` → peopleSlug if free, else slug, else `slug-2`, `-3`…
- `isValidUrlName(s)`
- `defaultShow(kind)`
- `encodeContact(value: string): string` / `decodeContact(enc: string): string` — reversible, non-plain (base64 of a fixed XOR + reverse); the HTML never contains `@` addresses or digit runs of phone numbers.
- `buildVCard(input)` → vCard 3.0 string (FN, N, ORG, TITLE, TEL, EMAIL, ADR, URL, PHOTO omitted), escaping per RFC 6350.
- `normalizeSource(srcParam, referrerHost)` → allow-listed slug `[a-z0-9-]{1,32}` from `src`, else known referrer map (instagram, facebook, linkedin, google, whatsapp, x, tiktok, youtube…), else `direct`.
- `cardPath(kind, urlName?)` → `/link` | `/link/<urlName>`; `qrTarget(canonicalOrigin, path)` → `${origin}${path}?src=qr`.

## Website (public)
- Bare layout: in `[tenant]/layout.tsx`, when the `x-abluo-card` header is `1` (after design-system resolution, before the Livener/generic branches), return only `SiteLinkScopeProvider` + `DesignSystemHead` (+ page gradient if any) + `<main>{children}</main>`. No ConsentProvider banner, TrackingScripts, FirstTouchRecorder, header, footer, WhatsApp FAB.
- Page: noindex metadata, OG title/description/image (no contact data), excluded from sitemap. Module not installed → 404. Offline rules per ADR-049 D6. Retired name → 308 to current.
- Render: background (focal point via `focalObjectPosition`, overlay from DS token), logo/photo, name, role/description, Primary Action, links, contacts (client component decoding `data-enc`), socials, Save contact button (→ `contact.vcf`), automatic footer (privacy / legal notice links from the tenant's legal documents), small "More about …" link.
- Beacon: client component posts `{p: projectSlug, c: publicId, k:'visit'}` once per page view and `{…, k:'click', l: linkKey}` on link click via `navigator.sendBeacon` to `/api/cards/hit`, including `src` from the URL and `document.referrer` host only.
- vCard routes: GET, `text/vcard; charset=utf-8`, `Content-Disposition: attachment; filename="<name>.vcf"`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`; 404 when the card's `saveContact` switch is off or card offline; bot UA → 403; in-memory per-instance rate limit (no IP stored).

## Statistics (Supabase 068)
```sql
create table public.digital_card_daily (
  project_slug text not null,
  card_id text not null,         -- digitalCard.publicId
  link_key text not null default '',  -- '' = the card itself
  source text not null default 'direct',
  day date not null,
  visits integer not null default 0,
  clicks integer not null default 0,
  primary key (project_slug, card_id, link_key, source, day)
);
alter table public.digital_card_daily enable row level security; -- no policies: service role only
-- digital_card_hit(p_project text, p_card text, p_link text, p_source text, p_kind text) security definer: upsert +1
-- digital_card_stats(p_project text, p_card text /* null = all cards */, p_from date, p_to date) → totals, per link, per source, per day (SQL aggregation)
-- digital_card_sweep() deletes day < current_date - interval '13 months'
```
- Hit endpoint counts only when `isProduction()` and the request host is a production custom domain; ignores bots (UA list), requests with a Supabase auth cookie, unknown project/card/link (checked against published Sanity data, cached); best-effort in-memory rate limit; responds 204 always.
- Dashboard reads through a server function guarded by `digital-cards.stats.read`, project from the grant.

## Dashboard
- Nav: "Digital Cards" (Content group, after Testimonials), module-gated, permission `digital-cards.read`.
- List screen `DigitalCardsBrowser.tsx` = **Records** kind (ListToolbar + DataTable on desktop, ListRow on phones; declare in `KIND`). Site card first, then person cards. "New person card" picks from People (people without a card, renderable).
- Editor (Amendment A — supersedes the section list below where they differ): three tabs with the shared `Tabs` (as the People editor), **Card · Share · Statistics** (`?tab=share|stats`, `editor-tabs.ts`).
  - **Card:** "What's on your card" (`DigitalCardContents.tsx`) — one list grouped About / Contact / Social profiles / Locations / Buttons, every row with its REAL value (`availability.values` for phone / e-mail / WhatsApp / role) and one shared `Switch`; missing data → no switch, a link "Add it in …" (site socials → `/{project}/settings/social-profiles`; other site data → Support; person data → the person in People). Then Buttons (links editor), Address, Background with the focus point (`AssetFocusPanel`, saved ON the Media Library asset through `updateMediaPhotoAction`; read with `getMediaPhotoFocalAction`; needs `media.library.manage`). Beside it on desktop (below behind "Show preview" on phones): the **live preview** (`DigitalCardPreview.tsx`) — `DigitalCardView` with `preview`, built by `previewCardView()` (`modules/digital-cards/preview.ts`) from the values on screen + `getDigitalCardPreview` (`lib/api/digital-card-preview.ts`, digital-cards.read, grant project, one GROQ read: site fields, the PUBLIC person, live site card background, pages, files, chosen background) and the site's design system as CSS scoped to `[data-card-preview="<id>"]` (`preview-theme.ts`, from `resolveColours`). The frame is `inert`; no beacon; no legal footer.
  - **Share:** "QR Code" ("For print: business cards, flyers, reception desk") + "Links to share", each row saying where to use it; a phone-only Share button (`navigator.share`). Hidden with an explanation when the project has no custom domain.
  - **Statistics:** `DigitalCardStats`.
- Analytics page: `DigitalCardsAnalytics` block when the module is installed and the reader holds `digital-cards.stats.read` — `getDigitalCardsOverview(ctx, projectId, { days: 30 })` (readStats with `cardId: null`, project from the grant): totals, CTR, top cards (each → its Statistics tab), sources.
- Settings → Social Profiles (`/{project}/settings/social-profiles`, nav id `socialProfiles`, label "Social Profiles"): writes `siteConfig.socialLinks` through `lib/settings/service.ts` `saveSettings` (path `socialLinks` allow-listed in `paths.ts`, validated by `lib/settings/social-links.ts`: https only, host on the platform, ≤ 20, platforms = the `socialLink` schema list) — `site.details.write`, single-project guard, `ifRevisionID` on the published document AND the Studio draft (live at once). Action: `settings/social-profiles/actions.ts`.
- Public card: "Show QR code" button (`CardQrButton.tsx`, native modal `<dialog>`) showing `view.qr` = `qrTarget(canonicalOrigin, cardPath)` (`?src=qr`); none without a custom domain; not a `data-card-link`, never counted. Strings `showQr`, `qrTitle`, `qrHint`, `qrAlt`, `qrFailed`, `close` in every site locale.
- Editor (round 1, kept for reference): header actions top right (Publish / Unpublish / Archive); sections: What's shown (switches, disabled with reason + link when data missing; description never cut — over 600 it stays on screen with the count and is not sent), Links (add — a new link is a page of the site, a web address when the site has no pages — /edit/reorder/show-hide/primary; label + one-liner per language), URL name (person; live uniqueness), Background, QR (SVG + PNG download, canonical host, `?src=qr`), Tagged links (copy buttons for instagram, linkedin, facebook, whatsapp, email, print), Statistics (KPI cards, per-link table, sources, 7/30/90/365).
- Deletes ask first; "Done · Undo"; disabled actions explain why; 24h local time.

## Round 4 (2026-11-09, Tom's test on Claudia Hoffmann's card)
- **Autosave ↔ publish.** Every draft-based editor's `send` is `openThenSave` (`src/lib/client/autosave/open-then-save.ts`): a save failing right after the draft was opened reports the opened revision (`SendResult.rev`), and the engine continues from it. Publish / discard / lifecycle / reload run through `autosave.exclusive(op)` (flush → op with the confirmed revision → continue from the revision op returns; `''` = no draft, the next change opens one). Edits typed meanwhile are kept and saved after. The revision guard is unchanged.
- **Address without `locations[]`.** The single `siteConfig.location` (businessLocation) is the card's one location, key `SITE_LOCATION_FALLBACK_KEY` (`'location'`) in `show.locations`, availability, website card, preview and vCard ADR (`cardSiteLocations` / `siteLocations`).
- **Social profiles in a Studio draft.** The card shows what the website shows (published); `availability.socialsPendingInStudio` adds a one-line notice. Settings → Social Profiles reads with the raw perspective, shows the draft's list over the published one (when the draft holds the field) with a notice, and Save makes it live on both documents.
- **Links editor.** List rows show the label visitors see (`linkDisplay`; empty label → `linkDefaultLabel` = page / file title or the kind's standard label, the same function the website uses), the one-liner and "type · target"; reorder with the shared `DragGrip` (drag or ArrowUp / ArrowDown); ⋯ = Edit, Show / Hide, Primary Action, Remove. Add link opens the new link: Type → target → Label (optional, placeholder = default) → one-liner.
- **Preview language.** The preview has its own language switch (all site languages); it follows the editing tab until another language is picked there.
- **Share tab.** Two columns from `lg`: Links to share (left, per-row where-to-put-it hints), QR Code (right).
