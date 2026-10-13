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

import { publicFilterFor } from '@/lib/lifecycle/public-types'

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
export const SITEMAP_PAGES_QUERY = /* groq */ `*[_type == "page" && defined(projectSlug) && coalesce(pageType, "") != "home" && !(noindex == true)] { projectSlug, slug, "images": ${GALLERY_SECTION_IMAGES} }`

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

export const SITEMAP_CATALOGUE_ITEMS_QUERY = /* groq */ `*[_type == "catalogueItem" && defined(projectSlug) && hasPage == true && defined(slug) && ${publicFilterFor('catalogueItem')} && (!defined(visibility) || visibility != "unlisted")] { projectSlug, slug, "segment": ${CATALOGUE_SEGMENT}, "images": array::compact((images[]->)[_type == "mediaAsset" && projectSlug == ^.projectSlug].image.asset->url) }[defined(segment)]`

export const SITEMAP_CATALOGUE_COLLECTIONS_QUERY = /* groq */ `*[_type == "catalogueCollection" && defined(projectSlug) && hasPage == true && defined(slug) && ${publicFilterFor('catalogueCollection')} && (!defined(visibility) || visibility != "unlisted")] { projectSlug, slug, "segment": ${CATALOGUE_SEGMENT} }[defined(segment)]`
