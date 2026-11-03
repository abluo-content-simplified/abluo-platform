// ── Catalogue — client dashboard reads (authenticated, project-scoped) ───────
//
// NOT delivery paths. Every query here runs for a signed-in member of the
// project, after `assertModuleAction(…, 'catalogue.item.read' | write)`, with
// `$projectSlug` taken from the GRANT — and lists EVERY state (drafts,
// scheduled, unpublished, archived), because the dashboard is where those are
// managed. The website reads the catalogue through the visibility fragment in
// src/lib/sanity/queries.ts; nothing here may ever be used to render a page.

import { FOOD_PROFILE_GROQ } from './profiles'
import { COMMERCE_HAS_PRICE_GROQ, COMMERCE_PRICE_COUNT_GROQ, COMMERCE_PRICES_GROQ } from './commerce/groq'
import { catalogueCategoryTermsGroq, catalogueTermsGroq } from '@/lib/taxonomy/vocabulary'
import { catalogueTaxonomyGroq } from './taxonomy/read'

/** Site languages and zone (dates are entered in the site's time zone, ADR-032 D8). */
export const CATALOGUE_SITE_QUERY = /* groq */ `{
  "site": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales, timeZone, amazonTrackingIds[]{ marketplace, trackingId }, awinPublisherId, affiliateShops[]{ shop } },
  "config": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "catalogue"][0].config,
  "translate": count(*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "translate" && enabled != false]) > 0,
  // ADR-033 Amendment J (dual-read): taxonomyTerm records, when present, replace config.categories
  // (catalogueCategoryVocabulary). Inside this one query — no extra round trip on the save path.
  "categoryTerms": ${catalogueCategoryTermsGroq('label')},
  // Slice 7 — tag term records (no config list exists for tags).
  "tagTerms": ${catalogueTermsGroq('tag', 'label')},
  // Catalogue V2 C1 (R1 triple dual-read): the catalogue-taxonomy document wins per kind when present.
  "taxonomy": ${catalogueTaxonomyGroq('label')}
}`

const LIFECYCLE = `publishedAt, expiresAt, archivedAt`

/** Every item, collection and option list of the project — published and draft copies (raw perspective). */
export const CATALOGUE_DASHBOARD_LIST_QUERY = /* groq */ `{
  "items": *[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{
    _id, _rev, _createdAt, _updatedAt, name, byline, slug, itemProfile, "bookAuthor": bookDetails.author, "bookYear": bookDetails.year, "bookStatus": bookDetails.readingStatus, "allergenStatus": allergenDeclaration.status, categories, primaryCategory, additionalCategories, hasPage, visibility, ${LIFECYCLE},
    "imageCount": count(images), "firstImage": images[0]._ref,
    // Dual-read (C10-4): formats when present, else legacy offers.
    "offerCount": ${COMMERCE_PRICE_COUNT_GROQ}, "prices": ${COMMERCE_PRICES_GROQ},
    "lists": optionLists[].list._ref
  },
  "collections": *[_type == "catalogueCollection" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{
    _id, _rev, _createdAt, _updatedAt, name, slug, collectionType, hasPage, visibility, ${LIFECYCLE},
    "sectionCount": count(sections), "sectionNames": sections[].name, "itemRefs": sections[].items[]._ref
  },
  "optionLists": *[_type == "catalogueOptionList" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{
    _id, _rev, _createdAt, _updatedAt, name, ${LIFECYCLE}, "optionCount": count(options)
  }
}`

/** Thumbnails of the first photos (Media Library assets of this project). */
export const CATALOGUE_THUMBS_QUERY = /* groq */ `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids]{ _id, "url": image.asset->url, "hotspot": image.hotspot }`

/** Photos of one item, in order (editor). */
export const CATALOGUE_ITEM_PHOTOS_QUERY = CATALOGUE_THUMBS_QUERY

/** Which of these ids are published media assets of this project (patch check). */
export const CATALOGUE_MEDIA_EXIST_QUERY = /* groq */ `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids && !(_id in path("drafts.**"))]._id`

/**
 * Reference targets (ADR-033 D-4): the published AND draft versions of these
 * ids among `$type` documents of this project — a draft-only target is
 * referenced weakly. `hasPrice` = the version carries at least one price on any
 * format (D2 + D-21: an option may link only to an item with a price; an item
 * with a price qualifies even when unavailable on a particular channel).
 */
export const CATALOGUE_REF_TARGETS_QUERY = /* groq */ `*[_type == $type && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]{ _id, "hasPrice": ${COMMERCE_HAS_PRICE_GROQ} }`

/** D-5 preview: how many OTHER documents (outside this publish) reference `$id`, in any version. */
export const CATALOGUE_REUSE_COUNT_QUERY = /* groq */ `count(*[projectSlug == $projectSlug && references($id) && !(_id in $ids) && !(_id in path("versions.**"))])`

/** Count of catalogue documents of one type (drafts + published) — caps creation. */
export const CATALOGUE_COUNT_QUERY = /* groq */ `count(*[_type == $type && projectSlug == $projectSlug])`

/** Home "At a glance": published items, drafts, and items without a price. */
export const CATALOGUE_GLANCE_QUERY = /* groq */ `{
  "published": count(*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !defined(archivedAt)]),
  "drafts": count(*[_type == "catalogueItem" && projectSlug == $projectSlug && _id in path("drafts.**") && !defined(archivedAt)]),
  "noPrice": count(*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !defined(archivedAt) && (${COMMERCE_PRICE_COUNT_GROQ}) == 0])
}`

/**
 * D-3a — the choices of these option lists, published and draft versions
 * (the caller takes the published one, else the draft that is being published).
 */
export const CATALOGUE_OPTION_LIST_CHOICES_QUERY = /* groq */ `*[_type == "catalogueOptionList" && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]{ _id, name, options[]{ _key, label, kind, item, allergenDeclaration } }`

/** D-3a — whether a non-archived food-or-drink item (any version) uses this option list. */
export const CATALOGUE_FOOD_USERS_COUNT_QUERY = /* groq */ `count(*[_type == "catalogueItem" && projectSlug == $projectSlug && ${FOOD_PROFILE_GROQ} && $id in optionLists[].list._ref && !defined(archivedAt) && !(_id in path("versions.**"))])`
