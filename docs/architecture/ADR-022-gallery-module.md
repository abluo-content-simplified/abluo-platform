# ADR-022 — Gallery as a first-class module

**Status:** Accepted — implemented on `feat/gallery-module` (2026-09-28), not yet released
**Date:** 2026-09-28
**Owner:** Tom
**Relates:** ADR-020 (modules first-class), ADR-021 (consent — video embeds), Sections vs Modules principle (CLAUDE.md), the "media library first" rule

---

## Context

Galleries shipped in v1.0.3 (2026-06-30) and the `featured` layout was added on 2026-09-07 (`ecd3492`, now in production). What exists today:

- `gallery` document: `projectSlug`, `internalName`, optional `slug`, `description` (localizedString), and `items[]`: an ordered list of `galleryItem`.
- `galleryItem`: a reference to a `mediaAsset`, with optional per-gallery title and caption overrides.
- `photoGallerySection`: points to **one** gallery. Its options are `layout` (grid | featured), `columns`, `imageRatio`, `spacing` and `showCaptions`. It renders responsive `srcSet` images.

What is missing:

1. **It is not a module.** The types sit in `schema.ts` under a "Gallery Module" comment, but there is no `MODULE_REGISTRY` entry. So a project cannot switch galleries on or off, and there are no permissions or collection.
2. **A section shows one gallery only.** A "whole studio" page (exterior, room 1, room 2, treatments) cannot be built without stacking separate sections.
3. **Galleries cannot be used in blog posts.** `localizedPortableText` has only `block` members.
4. **There is no lightbox, and no gallery structured data.**
5. **A gallery has no public title.** `internalName` is Studio-only, so there is nothing to put on a tab.

Driving use case: a dental studio wants a full gallery page split into *Exterior / Room 1 / Room 2 / Special treatments*. It also wants the *Special treatments* photos inside the blog post about that treatment, with **one** source for both.

## Decision

### 1. Galleries are small, reusable sets; placements compose them

A gallery is one focused, hand-ordered set (e.g. *Exterior*, *Room 1*, *Implantology*). A gallery page is built by a section that **lists several galleries**. A blog post embeds **one** gallery. Editing a gallery updates every place that uses it.

We rejected two alternatives:

- **Groups inside one big gallery.** Every reuse would have to point at "group X of gallery Y". That reference is awkward and breaks silently when a group is renamed or moved.
- **Per-placement exclusion lists** ("show these galleries but hide photos A, B, C"). These are invisible and drift over time: a photo added later goes missing from one page and nobody knows why. If a page needs a different selection, make another gallery. The images live once in the Media Library, so a second gallery duplicates nothing.

Tags on `mediaAsset` stay a **finding aid** when building a gallery in Studio. They are never a live query that decides what a gallery shows.

### 2. Register the Gallery module

Add a `gallery` manifest to `MODULE_REGISTRY` following the ADR-020 pattern:

- `schemaTypes`: `gallery`, `galleryItem` (moved from `schema.ts` into `src/lib/modules/gallery/schema.ts`; type names unchanged)
- `sectionTypes`: `photoGallerySection`
- Studio collection: *Galleries*, scoped by `projectSlug`
- Permissions declared now: `gallery.read` and `gallery.write`. v1 editing is **admin-only in Studio**. Declaring them now means a client-side gallery editor later needs no redesign.
- Enabled per project through `moduleInstallations`. Existing tenants that already use galleries (Hoffmann) are installed as part of the rollout.

### 3. Section: several galleries, optional tabs

New fields on `photoGallerySection` (all additive):

- `galleries`: an ordered array of references to `gallery`. The existing single `gallery` reference is still read as a fallback (`coalesce(galleries, [gallery])`), so sections authored today render unchanged.
- `display`: `combined` (one continuous set) | `tabs` (one tab per gallery).
- `showAllTab` (tabs only): prepends an "All" tab with the union of the galleries, de-duplicated by `mediaAsset` and ordered by gallery then item.

New field on `gallery`: `title` (**localizedString**, created localized from the start). It is the public label used for tabs and headings, falling back to `internalName` only in Studio previews.

### 4. Layouts — the layout decides the tile shape, never the photo

**Problem observed on Hoffmann (production).** The `featured` layout forced the lead tile square, while the tiles beside it used the section's 4:3 landscape shape. The square lead set the height of its two rows, and the shorter landscape tiles next to it did not fill them, which left visible gaps. With 4 items, the last photo was orphaned alone on its row.

**Rules:**

1. **Every tile has a fixed shape set by the layout.** The photo is cropped into it around its focal point (§4a). Any photo, portrait or landscape, works in any tile, so there are no gaps. The lightbox always shows the full, uncropped photo.
2. **Layouts always fill cleanly for any item count.** A partial last row is spread across the full width, each tile widened and given a proportionally wider shape so the row keeps the height of the rows above. Because widening one photo to three times its width is a brutal crop, a small remainder first rebalances the last two rows (3 + 1 → 2 + 2, 4 + 1 → 3 + 2, 4 + 2 → 3 + 3). No tile is ever widened by more than half again, except a lone leftover in a two-column grid (2×). Implemented and tested in `src/lib/gallery/layout.ts` (`gridCells`, `planTiles`).
3. **Editors control only order and layout, with no per-photo sizing.** Dragging decides which photo leads; the layout decides what "leading" looks like. Per-photo size controls break on mobile, on reorder, when photos are added, and when the same gallery is reused elsewhere. An optional per-item "emphasise" flag is deferred until a real case needs it.

**Layouts:**

- `grid`: equal tiles in `columns`.
- `featured` (fixed): on wide screens the lead is two thirds wide with **no ratio of its own**: it stretches to the height of the tiles stacked beside it, so it cannot leave a gap. Two tiles stack beside it; with exactly four photos the fourth joins them (three stacked) instead of being orphaned. The rest follow as a grid in thirds. On phones and tablets the lead takes a full row. Falls back to `grid` below 3 items.
- `wideLead` (new): the first photo spans the full width at 16:9 (21:9 was tried and cropped too much), then a grid.
- `rows` (new): justified rows. Each photo keeps its real proportions, and row heights adjust so every row fills the width exactly. The last row keeps its natural height instead of being blown up. Pure CSS, no measuring. This is the no-crop choice for mixed portrait and landscape sets.
- `masonry` (new): columns with no cropping and a ragged bottom.
- `carousel` (new): horizontal and swipeable; the natural choice in blog posts and on mobile.
- `tabs` is a display mode, not a layout. It combines with any layout.
- Deferred: `beforeAfter` (see §9).

`imageRatio` stays for `grid`, `featured` and `wideLead`, but loses `auto`. The no-crop layouts are `rows` and `masonry`. `auto` values already stored are read as `landscape`; this is handled in code, with no data change.

### 4a. Focal point (Sanity "hotspot")

Whenever a tile crops a photo, the editor must be able to say what matters in it. Today they can't:

- `mediaAsset.image` has `options: { hotspot: false }`, so the Studio shows no focal-point or crop tool on Media Library images.
- The gallery query already fetches `hotspot` and `crop`, but `PhotoGallerySection` ignores them. It uses CSS `object-cover`, which always crops around the centre.

**Decision:**

- Turn on `hotspot: true` for `mediaAsset.image`. This is a Studio UI option, not a field type change, so no data migration is needed. Focal points are set **once per photo in the Media Library** and apply everywhere the photo is used: every gallery, section and blog post.
- Render crops around the focal point with `object-position` taken from the stored `hotspot.x` and `hotspot.y`. It works with responsive tile shapes and needs no extra image URLs. The editor's crop rectangle is applied through the image URL builder.
- Photos without a focal point fall back to the centre, which is today's behaviour.
- The same helper is reused by every component that crops a Media Library image, not only galleries.

### 5. Lightbox: one shared, platform-owned component

Every layout, whether in a section or in a blog post, opens the same lightbox (on by default, `lightbox: false` per placement to disable):

- Next/previous via buttons, arrow keys and swipe. Esc and backdrop click close it. Focus is trapped while open and returned to the clicked thumbnail on close.
- Caption, and a position counter ("3 / 12"). (A thumbnail strip is deferred.)
- Deep link: the URL reflects the open photo (`#photo-3`), so a specific image can be shared. Numbers count the placement's combined "All" set, so a link points at the same photo whichever tab was open; opening one shows the All tab behind it. A section with an anchor id namespaces its links (`#studio-photo-3`) so two galleries on one page do not answer the same link. Written with `history.replaceState`, so opening photos does not fill the back button.
- Animation duration and easing come from `designSystem.motion` (no raw keyframes). The backdrop is near-black on every site, the one colour not taken from the design system: photos are judged against black, and a light theme's background would wash them out.
- Every string (close, next, previous, the counter pattern, aria labels) comes from locale dictionaries. None is hardcoded.
- It loads the full-size image only when opened, and preloads the neighbours.

### 6. Gallery in a blog post

Most posts have no gallery, so it is an optional **post-level field**, not a block inside the text:

- `gallery`: a reference picked from a dropdown that lists only the galleries of the post's own project (the `projectSlug`-scoped filter pattern). It is empty by default.
- `galleryLayout`: `grid` | `carousel` | `featured` | `rows`.
- The gallery renders **below the article text**, headed by the gallery's public `title`, with the lightbox.
- It is picked once per post, not once per language: the post's language versions share it. Captions and title are localized on the gallery itself.
- It is the **only** coupling between the Blog and Gallery modules. It renders only when the Gallery module is installed for the post's project (an unresolved module list fails open, like module sections). Otherwise it renders nothing. It never breaks the post.

### 7. SEO, performance, accessibility (acceptance criteria, not extras)

- `altText` is required on every `mediaAsset` (already enforced by the Studio before ADR-022), consistent with the media-library-first rule. Alt text and captions are localized. At render, a missing alt falls back to the photo's title.
- `ImageGallery` / `ImageObject` JSON-LD for gallery sections and blog galleries, with localized names and captions (`src/lib/gallery/jsonld.ts`, emitted by `GalleryPlacement`). Image URLs are JPEG renditions, because some Media Library originals are AVIF.
- Gallery images are listed in the sitemap (`<image:image>`) for the page that shows them, the home page and blog posts included. Raw CDN URLs, so nothing needs XML-escaping.
- Responsive `srcSet`/`sizes` for every layout. Explicit width and height (or aspect ratio) so there is no layout shift. Lazy loading below the fold. LQIP blur placeholder.
- Real `<button>` thumbnails with accessible names. Tabs follow the WAI-ARIA tabs pattern.

### 8. Media library first (unchanged, now enforced by the model)

Gallery items reference `mediaAsset` only. There are no direct uploads into galleries, sections or embeds.

Noted, out of scope here: the Events module has its own inline `gallery[]` of `localizedImage`, which breaks this rule. Move it to a gallery reference in a later change.

### 9. Health data and before/after images

Clinical photos of real patients (treatment results, before/after) are health data. They need written patient consent, and national rules on healthcare advertising may restrict them (in Italy, the professional codes and advertising rules for healthcare professionals). The platform does not decide this for the client. v1 ships **no** before/after layout. It is revisited only once there is a confirmed, compliant use case. Studio, room and exterior photos carry no such issue.

## Data and rollout safety

Every schema change here is **additive** (new optional fields). No existing field changes type, and no stored document changes shape: `gallery`, `galleryItem` and `photoGallerySection` keep their names, and `imageRatio: auto` is handled in code.

**One data step is required, and it must come FIRST.** `photoGallerySection` is now owned by the Gallery module, and module sections render only where the module is installed. Projects that already show a gallery (Hoffmann's home page, Studio Martegani's team page) would lose it the moment this code deploys. Migration `006-install-gallery-module.ts` appends a `gallery` installation to every project that owns a gallery (hoffmann, studiomartegani, tmz as of 2026-09-28). It is safe to run before the deploy: the code in production reads installation ids and ignores ones it does not know. The old Studio shows the new entry as an unknown type until the deploy, which is cosmetic.

Following the 2026-08-14 lesson: the reading code (the `coalesce(galleries, [gallery])` fallback) ships to production **before** anyone authors content in the new fields. Retiring the old `gallery` field is a separate, later change, done only after a Sanity query confirms that no document still depends on it.

## Delivery slices

All six were built together on `feat/gallery-module`. They are listed in the order they were planned:

1. **Hoffmann fix (can ship on its own, first).** Enable the focal point on `mediaAsset`, a shared `object-position` helper, fixed tile shapes, the `featured` fill fix and the orphan fix. This fixes the live Hoffmann gallery before any module work.
2. **Module and composition.** Register the module, move the schema, add `gallery.title`, `galleries[]`, `display` and `showAllTab`, and install the module for the current tenants. Tests: fallback from `gallery` to `galleries`, de-duplication in "All", registry validation.
3. **Lightbox.** The shared component, deep link, i18n keys (all seven platform locales), and motion tokens.
4. **SEO.** JSON-LD, image sitemap entries, required alt text, and the LQIP and dimension work.
5. **Blog gallery.** The post-level `gallery` and `galleryLayout` fields, rendering below the text, and the module-installed guard.
6. **Layouts.** `wideLead`, `rows`, `masonry` and `carousel`.

Later (not scheduled): video items (`mediaAsset.videoUrl` already exists; each embed needs a click-to-load consent step per ADR-021), a client-side gallery editor, moving the Events gallery over, and before/after (§9).

The section renders through `SECTION_MAP` (`src/lib/modules/gallery/sections.tsx`), so every route that uses `SectionRenderer` picks it up. The ordinary `dev → preview → main` release flow applies, with migration 006 run before the promotion that reaches production (see above).

## Resolved questions (Tom, 2026-09-28)

1. With `showAllTab` on, **"All" is the tab selected on load.**
2. Blog: a **post-level gallery picker**, rendered below the text (§6), not an inline block.
3. Lightbox deep link: a hash (`#photo-3`). It keeps canonical URLs clean and needs no server round-trip. Kept (Tom: OK).

## Implementation map

| Concern | Where |
|---|---|
| Tile plans (grid, featured, wide lead), no gaps / no orphans | `src/lib/gallery/layout.ts` |
| Focal point → `object-position` | `src/lib/gallery/focal.ts` |
| Composing galleries, "All", de-duplication | `src/lib/gallery/compose.ts` |
| Deep links | `src/lib/gallery/deeplink.ts` |
| Server → client view model | `src/lib/gallery/view.ts` |
| Structured data | `src/lib/gallery/jsonld.ts` |
| Image sitemap entries | `src/lib/seo/sitemap-images.ts`, `src/app/sitemap.ts` |
| Placement (server), shared by section and blog post | `src/components/gallery/GalleryPlacement.tsx` |
| Tabs, layouts, tiles, lightbox (client) | `src/components/gallery/` |
| UI strings | `src/lib/i18n/gallery-messages.ts` |
| Schema, manifest, section map | `src/lib/modules/gallery/`, `src/lib/modules/registry.ts` |
| One GROQ projection for every placement | `GALLERY_FIELDS` in `src/lib/sanity/queries.ts` |
| Install migration | `src/lib/sanity/migrations/006-install-gallery-module.ts` |

Verified before merge: type check, the full test suite, a production build, and a rendered check of every layout (desktop, tablet, phone), tabs, the lightbox (keyboard, focus return, deep link) against a fixture built from Hoffmann's and Studio Martegani's real galleries.
