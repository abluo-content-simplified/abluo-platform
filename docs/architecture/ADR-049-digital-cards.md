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
