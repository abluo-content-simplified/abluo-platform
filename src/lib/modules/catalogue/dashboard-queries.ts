// ── Catalogue — client dashboard reads (authenticated, project-scoped) ───────
//
// NOT delivery paths. Every query here runs for a signed-in member of the
// project, after `assertModuleAction(…, 'catalogue.item.read' | write)`, with
// `$projectSlug` taken from the GRANT — and lists EVERY state (drafts,
// scheduled, unpublished, archived), because the dashboard is where those are
// managed. The website reads the catalogue through the visibility fragment in
// src/lib/sanity/queries.ts; nothing here may ever be used to render a page.

/** Site languages and zone (dates are entered in the site's time zone, ADR-032 D8). */
export const CATALOGUE_SITE_QUERY = /* groq */ `{
  "site": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales, timeZone },
  "config": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "catalogue"][0].config,
  "translate": count(*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "translate" && enabled != false]) > 0
}`

/** Only the dashboard label (ADR-033 D12) — presentation; read for the sidebar. */
export const CATALOGUE_NAV_LABEL_QUERY = /* groq */ `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "catalogue"][0].config.navLabel`

const LIFECYCLE = `publishedAt, expiresAt, archivedAt`

/** Every item, collection and option list of the project — published and draft copies (raw perspective). */
export const CATALOGUE_DASHBOARD_LIST_QUERY = /* groq */ `{
  "items": *[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{
    _id, _createdAt, _updatedAt, name, itemProfile, "allergenStatus": allergenDeclaration.status, categories, hasPage, visibility, ${LIFECYCLE},
    "imageCount": count(images), "firstImage": images[0]._ref,
    "offerCount": count(offers), "prices": offers[].price,
    "lists": optionLists[].list._ref
  },
  "collections": *[_type == "catalogueCollection" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{
    _id, _createdAt, _updatedAt, name, collectionType, hasPage, visibility, ${LIFECYCLE},
    "sectionCount": count(sections), "itemRefs": sections[].items[]._ref
  },
  "optionLists": *[_type == "catalogueOptionList" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{
    _id, _createdAt, _updatedAt, name, ${LIFECYCLE}, "optionCount": count(options)
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
 * referenced weakly. `offered` = the version carries a price (an option may
 * link only to an item that is itself offered, D2).
 */
export const CATALOGUE_REF_TARGETS_QUERY = /* groq */ `*[_type == $type && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]{ _id, "offered": count(coalesce(offers, [])) > 0 }`

/** D-5 preview: how many OTHER documents (outside this publish) reference `$id`, in any version. */
export const CATALOGUE_REUSE_COUNT_QUERY = /* groq */ `count(*[projectSlug == $projectSlug && references($id) && !(_id in $ids) && !(_id in path("versions.**"))])`

/** Count of catalogue documents of one type (drafts + published) — caps creation. */
export const CATALOGUE_COUNT_QUERY = /* groq */ `count(*[_type == $type && projectSlug == $projectSlug])`

/** Home "At a glance": published items, drafts, and items without a price. */
export const CATALOGUE_GLANCE_QUERY = /* groq */ `{
  "published": count(*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !defined(archivedAt)]),
  "drafts": count(*[_type == "catalogueItem" && projectSlug == $projectSlug && _id in path("drafts.**") && !defined(archivedAt)]),
  "noPrice": count(*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !defined(archivedAt) && count(coalesce(offers, [])) == 0])
}`

/**
 * D-3a — the choices of these option lists, published and draft versions
 * (the caller takes the published one, else the draft that is being published).
 */
export const CATALOGUE_OPTION_LIST_CHOICES_QUERY = /* groq */ `*[_type == "catalogueOptionList" && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]{ _id, name, options[]{ _key, label, kind, item, allergenDeclaration } }`

/** D-3a — whether a non-archived food-or-drink item (any version) uses this option list. */
export const CATALOGUE_FOOD_USERS_COUNT_QUERY = /* groq */ `count(*[_type == "catalogueItem" && projectSlug == $projectSlug && itemProfile == "foodOrDrink" && $id in optionLists[].list._ref && !defined(archivedAt) && !(_id in path("versions.**"))])`
