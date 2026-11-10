# ADR-049 — Digital Cards module (link page / digital business card)

**Status:** Accepted (2026-11-09 — Tom approved the brief v1.1 + decision rounds 1–4 in chat and asked to build it in one go)
**Date:** 2026-11-09
**Owner:** Tom
**Relates:** ADR-014 (one configuration surface), ADR-020 (modules), ADR-021 (cookie consent), ADR-022 (Media Library focal points), ADR-028 (roles), ADR-032 (content lifecycle), ADR-034 (canonical host), ADR-043 (People), ADR-044 (Reservations), Sections vs Modules (CLAUDE.md)
**Working paper:** project doc `claude/link-page-module-brief-2026-11-09.md`
**Build contracts:** `docs/engineering/digital-cards/CONTRACTS.md`

## Context
Tenants want a Linktree-like digital business card: one branded mobile page, one permanent URL, a few actions, a QR code to print, and privacy-first statistics. CYCE (yoga club) is first and wants a card per teacher from day one.

## Decisions

**D1 — Module `digital-cards`**, nav label **"Digital Cards"**. Owns `digitalCard` documents (Sanity) and aggregate statistics (Supabase). Not a section; the `/link` routes present the module's data. Module-gated: not installed → `/link…` 404s.

**D2 — One record per card, two kinds.** `site` (at most one per project, at `/link`) and `person` (references a People `person`, at `/link/<urlName>`). A person card stores only its own links, background and switches; photo, name, role and public contacts are READ from People through `PERSON_PUBLIC_FIELDS` (never `person_private`). Links are never stored in People.

**D3 — No second configuration surface.** Logo, site name, socials, locations, contacts come from Website Settings (`siteConfig`) and People. Cards store visibility switches only, never copies of the data.

**D4 — Look = the design system.** No themes, colours or fonts. The only extra personalisation: one background image (Media Library asset, focal point honoured, readability overlay from an existing DS token). Person cards inherit the site card's background unless they set their own.

**D5 — URLs.** `/link` and `/link/<urlName>`, the same in every language, landing in the visitor's language (language negotiation). Person urlName = the person's People slug (default locale) when it exists, else the full name slugified (`sofia-rossi`); unique per project; a number only for identical full names; editable. A renamed card keeps its old names in `retiredUrlNames` (redirect to the current name) and never gives them to another card. `link` is a reserved page/tenant segment. No short-link service.

**D6 — Offline cards never dead-end.** Unpublished/archived person card, or person `off`/anonymised/archived → redirect to `/link`. Offline site card → redirect to the homepage. Lifecycle = Publish / Unpublish / Archive like all content (no separate on/off switch). Lifecycle type `digitalCard: 'optional'`.

**D7 — What's shown.** Per-card switches. Site card: logo, business name, description, phone, email, WhatsApp, each location, each social profile, Save contact. Person card: photo, role, short description, name (full / first only), phone, email, WhatsApp (public People contacts), the person's socials, business name (links to site card), Save contact, "More about …" link when the person has a profile page. Defaults: site card — everything that exists on; person card — photo, name, role on; phone, email, WhatsApp, Save contact OFF. Missing data → the switch is disabled with a reason and a link to where it is added.

**D8 — Links.** Types: URL, page, form (contact form), booking (only with Reservations installed), WhatsApp, phone, email, file (Media Library). Label localized; show/hide; order; exactly one Primary Action per card.

**D9 — Contacts & spam.** Contacts shown visibly (no tap-to-reveal) but never as plain text in the HTML: stored encoded in the markup and assembled client-side, `mailto:`/`tel:` built the same way. Save contact (vCard) is generated on request by a route handler, rate-limited, bot-filtered, and follows the switches. Never in search engines, share-preview text or structured data. "Message me" via Forms: later.

**D10 — No cookie banner, no GA, noindex.** Card routes render in a bare layout (design-system CSS only — no header, footer, consent banner, tracking scripts or first-touch recorder). `noindex, nofollow` + excluded from the sitemap. Share previews (OG) still work.

**D11 — Statistics.** First-party, cookieless, no IP, no visitor id. Daily aggregate rows per project × card × link × source in Supabase; counted by a browser beacon (pages are cached) on visit and on click; production host only; never for signed-in previews; endpoint accepts only known card/link ids, rate-limited, bot-filtered. Sources: `?src=` tag first (allow-listed slug), referrer host fallback, else `direct`. Dashboard: visits, clicks, CTR, per-link, sources, 7/30/90/365 days, copy-ready tagged links. Wording "visits", never "people". **Retention 13 months**, swept daily by a cron.

**D12 — QR codes** generated in-house (npm `qrcode`), SVG + PNG download per card, black on white, encoding the canonical host (ADR-034) with `?src=qr`.

**D13 — Not now:** link scheduling, A/B tests, unique visitors, newsletter/latest-posts blocks, click redirects through our server, short links, contact form relay, per-person self-editing, packaging.

## Consequences
- The website layout gains one bare branch keyed on a proxy request header (`x-abluo-card`), like the draft-preview marker.
- Privacy-policy templates gain one sentence about anonymous visit counting.
- One Supabase migration (068) and one cron route.

## Amendment A — 2026-11-09 usability round

**Status:** Accepted (Tom approved the usability rework in chat, 2026-11-09). Build contracts updated in `docs/engineering/digital-cards/CONTRACTS.md`.

1. **Editor in three tabs** — Card · Share · Statistics, with the shared `Tabs` exactly like the People editor; `?tab=share|stats` opens a tab directly.
2. **Live preview** — the Card tab shows the card beside the fields (desktop) or below behind a toggle (phone), rendered by the website's own `DigitalCardView` from the values on screen, in the tenant's design system scoped to the preview frame (colours, buttons, radii, fonts from `resolveColours`; theme follows the dashboard's light/dark class, or the site's locked theme). The frame is inert and never counted; the legal footer is not shown in it.
3. **"What's on your card"** replaces the switch grid: one list grouped About / Contact / Social profiles / Locations / Buttons, each item with its real value and one switch; missing data has no switch and a short "Add it in …" link (site socials → Settings → Social Profiles; other site data → Support; person data → People).
4. **Social profiles on by default** (refines D7 for socials only): the card stores the profiles turned OFF (`show.hiddenSocials`), for both kinds, so a profile added later appears without touching the card. A previously stored shown-list (`show.socials`) is no longer read — every profile not hidden shows (Tom: on by default). Website, vCard and dashboard all go through `resolveShow`. A person's phone, e-mail, WhatsApp and Save contact stay OFF by default (D7 unchanged).
5. **Background focus point** — after choosing the background, the shared `FocalPointPicker` (through the new shared `AssetFocusPanel`, also used by People) saves the point on the Media Library asset with the Media screen's own action — no new store. The website already honours it (`focalObjectPosition`).
6. **"Show QR code" on the public card** — a small button opening the card's own canonical address with `?src=qr` as a large QR in an accessible modal dialog, drawn client-side; absent without a custom domain; not counted as a link click.
7. **Share tab** — "QR Code" for print, then "Links to share", each saying where to use it (profile bio, message or status, e-mail signature), with copy buttons and a phone-only Share button (system share sheet).
8. **Statistics** — the per-card statistics in their own tab; the Analytics page gains a Digital Cards block (all cards together, last 30 days, top cards linking to their Statistics tab, sources) for readers with `digital-cards.stats.read` when the module is installed.
9. **Settings → Social Profiles** — a client dashboard page where the client adds, edits, removes and reorders the website's social profiles. It writes the SAME `siteConfig.socialLinks` as Website Settings, through the existing Settings writer (`site.details.write`, allow-listed path, single-project guard, revision guard, published + Studio draft patched — live at once). This is a second editing surface for one field, accepted on purpose: Studio stays the Abluo-side editor of the same data, not a second configuration (ADR-014 holds — one field, one meaning).
10. **Optional logo per link** — a Media Library image (`digitalCardLink.logo`) chosen in the link's edit panel; shown at the start of the button, 24 px high, up to 48 px wide, never cropped, on a small neutral tile in the card's background colour (decorative, the label stays the name); not in the vCard.

Consequences: the `show.socials` field is kept hidden/read-only in the schema for stored data; `resolveShow` derives the shown list. One new client server action file (`settings/social-profiles/actions.ts`), one new read-only preview service, one new nav item.

## Amendment B — 2026-11-10 "Page on this website" reaches what the navigation reaches

**Status:** Proposed (bug fix from Tom's report on `tmz`: the page picker listed only `page` documents — no "Between the Lines" catalogue landing page, no catalogue collections). Build contracts updated in `docs/engineering/digital-cards/CONTRACTS.md`.

1. **One link-target model.** A link of kind `page` uses the platform's navigation link-target model (`navigationLink`, ADR-033 Amendment G) instead of a card-only one: `page` is a weak reference to `page | cataloguePage | catalogueCollection | catalogueItem` (navigationLink.pageRef's types), or `internalPage` (homepage, blog, news, events, live — navigationLink.internalPage), or `moduleId` (an installed module's public page — navigationLink linkType `module`; today the catalogue). Exactly one is set. `form` / `booking` links still reference a `page` only. Stored `page` references (all to `page` documents) are unchanged — no migration.
2. **One resolver.** The website card and the editor preview turn a page link into a `NavLink` (`cardPageNavLink`) and resolve it with `resolveNavLink` / `isRenderableNavLink` from `src/lib/sanity/nav-links.ts`, re-based onto the card's site base (`siteBasePath` — host-scoped on the site's own domain). The catalogue target is projected with the navigation's own filter and fields (`NAV_CATALOGUE_TARGET_FILTER` / `_FIELDS`): this project's, public, visible to an explicit reference, slug in the visitor's language only, segment of the enabled installation. A link whose target is not public (or a section whose module is off, or a members-only page) is left out, like in the menu.
3. **Picker.** One searchable list grouped Pages · Catalogue (landing page, collections and items with a page of their own — only while the Catalogue is on) · Sections (the built-in sections whose module is on; Home only when no Home page exists), titled in the site's default language, built from Lab components (PickerTrigger, BottomSheet, TextInput, PickerOption).
4. **Server validation.** A page link's reference must be a document of this project of an allowed type (catalogue types only while the Catalogue is on); a section / module page must be on; two targets, or a section / catalogue target on a form / booking link, are refused.
5. **Default label.** Left empty, the button shows the target's title — the page's, the catalogue landing page's hero title, the collection's / item's name, or the section's localized name.

Not covered: courses and people have no public index page (only `/{segment}/{slug}` pages), so there is no module page to offer for them.

