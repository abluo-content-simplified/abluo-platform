/**
 * The content reads behind `src/app/sitemap.ts`.
 *
 * Kept outside the route file (a metadata route module should export only
 * its handler) so the ADR-032 D3 coverage test can inspect them. Every
 * lifecycle type read here carries `publicFilterFor` — the sitemap lists
 * exactly what the website serves.
 *
 * These reads span every project (the sitemap is built per host afterwards),
 * so they filter `defined(projectSlug)` rather than one $projectSlug.
 */

import { pageIsOpen } from '@/lib/access/groq'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { visibilityFilter } from '@/lib/modules/catalogue/visibility'

// The photos of every Photo Gallery section on a page — composed galleries and
// the legacy single gallery — once each. Raw CDN originals: no query string, so
// nothing needs XML-escaping in the sitemap. Archived galleries are skipped.
const GALLERY_SECTION_IMAGES = /* groq */ `array::compact(array::unique(
  sections[_type == "photoGallerySection"].galleries[${publicFilterFor('gallery', '@->')}]->items[].mediaAsset->image.asset->url
  + sections[_type == "photoGallerySection"][${publicFilterFor('gallery', 'gallery->')}].gallery->items[].mediaAsset->image.asset->url
))`

// The home page is emitted as the bare locale URL, so it is not listed here.
// A `noindex` page is excluded too (a robots noindex meta plus a sitemap entry
// would contradict each other) — the same filter llms.txt applies.
// ADR-040 — `open` is the page's own access rule (pageIsOpen); sitemap.ts
// drops closed pages AND every page under a closed page's path
// (src/lib/access/listing.ts). A closed page's images are never projected.
export const SITEMAP_PAGES_QUERY = /* groq */ `*[_type == "page" && defined(projectSlug) && coalesce(pageType, "") != "home" && !(noindex == true)] { projectSlug, slug, "open": ${pageIsOpen()}, "images": select(${pageIsOpen()} => ${GALLERY_SECTION_IMAGES}) }`

// ADR-031 — unlisted events are reachable by link only and carry a robots
// noindex; listing them here would contradict that.
export const SITEMAP_EVENTS_QUERY = /* groq */ `*[_type == "event" && defined(projectSlug) && ${publicFilterFor('event')} && (!defined(visibility) || visibility != "unlisted")] { projectSlug, slug }`

export const SITEMAP_POSTS_QUERY = /* groq */ `*[_type == "post" && defined(projectSlug) && ${publicFilterFor('post')}] { projectSlug, slug, "images": select(${publicFilterFor('gallery', 'gallery->')} => gallery->items[].mediaAsset->image.asset->url) }`

// News items (ADR-020) — a scheduled, expired or archived item answers 404,
// so advertising it would point search engines at a missing page.
export const SITEMAP_NEWS_QUERY = /* groq */ `*[_type == "newsArticle" && defined(projectSlug) && ${publicFilterFor('newsArticle')}] { projectSlug, slug }`

// Gallery photos on each project's home page, attached to the bare locale URL.
export const SITEMAP_HOME_IMAGES_QUERY = /* groq */ `*[_type == "page" && defined(projectSlug) && pageType == "home"] { projectSlug, "images": ${GALLERY_SECTION_IMAGES} }`

// ── Catalogue (ADR-033 D4, D11; spec §6.5) ────────────────────────────────────
// Items and collections share the project's one configured public segment, so
// each row carries it. A row is listed only where the document has a page,
// passes the lifecycle rule and is not unlisted (unlisted pages are reachable
// by link only and carry a robots noindex). Rows whose project has no enabled
// catalogue installation (no segment) are dropped: without the module there is
// no route. The consumer emits one URL per locale whose slug is set.
const CATALOGUE_SEGMENT = /* groq */ `*[_type == "project" && projectSlug == ^.projectSlug][0].moduleInstallations[moduleId == "catalogue" && enabled != false][0].config.publicSegment`

export const SITEMAP_CATALOGUE_ITEMS_QUERY = /* groq */ `*[_type == "catalogueItem" && defined(projectSlug) && hasPage == true && defined(slug) && ${publicFilterFor('catalogueItem')} && ${visibilityFilter('sitemap')}] { projectSlug, slug, "segment": ${CATALOGUE_SEGMENT}, "images": array::compact((images[]->)[_type == "mediaAsset" && projectSlug == ^.projectSlug].image.asset->url) }[defined(segment)]`

export const SITEMAP_CATALOGUE_COLLECTIONS_QUERY = /* groq */ `*[_type == "catalogueCollection" && defined(projectSlug) && hasPage == true && defined(slug) && ${publicFilterFor('catalogueCollection')} && ${visibilityFilter('sitemap')}] { projectSlug, slug, "segment": ${CATALOGUE_SEGMENT} }[defined(segment)]`

// The landing page at /{segment} (ADR-033 C1) — listed only while its own
// lifecycle makes it public, and only where the project has a segment.
export const SITEMAP_CATALOGUE_LANDING_QUERY = /* groq */ `*[_type == "cataloguePage" && defined(projectSlug) && ${publicFilterFor('cataloguePage')}] { projectSlug, "segment": ${CATALOGUE_SEGMENT} }[defined(segment)]`
