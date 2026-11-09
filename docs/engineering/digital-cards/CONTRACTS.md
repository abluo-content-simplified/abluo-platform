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
- `description`: localizedText (optional short line; person card falls back to People `shortBio`)
- `links`: array of `digitalCardLink` { `_key`, `kind`: `url|page|form|booking|whatsapp|phone|email|file`, `label` localizedString, `url` (url), `page` (scopedRef page), `file` (scopedRef mediaAsset), `value` (string: phone/email/whatsapp number), `hidden` boolean, `primary` boolean } — at most one `primary` among non-hidden links
- `background`: scopedRef → `mediaAsset` (person card: empty = inherit site card's)
- `show`: object of switches —
  - shared: `name`, `description`, `phone`, `email`, `whatsapp`, `saveContact` (booleans), `socials` (string[] — site: `socialLink.platform` values; person: People contact `_key`s of kind instagram/linkedin/website/url)
  - site: `logo`, `businessName` (booleans), `locations` (string[] of `siteConfig.locations[]._key`; first = vCard address)
  - person: `photo`, `role`, `nameMode` (`'full' | 'first'`), `businessName`, `profileLink` (booleans)
- publishing: `publishingStatusField('optional')`, `unpublishOnField`, `archivedFields()` (same as testimonial)

Defaults (`defaultShow(kind)` in `model.ts`): site → all true, all socials, all locations; person → photo/name/role/businessName/profileLink true, nameMode `full`, phone/email/whatsapp/saveContact false, socials [].

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
- Editor: header actions top right (Publish / Unpublish / Archive); sections: What's shown (switches, disabled with reason + link when data missing), Links (add/edit/reorder/show-hide/primary), URL name (person; live uniqueness), Background, QR (SVG + PNG download, canonical host, `?src=qr`), Tagged links (copy buttons for instagram, linkedin, facebook, whatsapp, email, print), Statistics (KPI cards, per-link table, sources, 7/30/90/365).
- Deletes ask first; "Done · Undo"; disabled actions explain why; 24h local time.
