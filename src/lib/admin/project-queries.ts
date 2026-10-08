/**
 * GROQ for the admin project page (ADR-030). Plain strings, run through
 * `tenantClient(projectSlug).fetchForTenant` — the same tenant-scope
 * chokepoint as the website, so every sub-query is bound to `$projectSlug`
 * (`fetch-for-tenant-call-sites.test.ts` resolves these exports and checks them).
 *
 * Published documents only (the shared read client): what the client sees on
 * their site. Unpublished draft copies (`drafts.*`) are not counted here.
 */

/** Media assets scanned for missing descriptions (same cap as the client's Media tile). */
export const ADMIN_MEDIA_SCAN = 1000

/** Items in each "Latest" list (same as the client Home). */
export const ADMIN_LATEST_COUNT = 3

const PUBLISHED = `!(_id in path("drafts.**"))`

export const adminProjectOverviewQuery = /* groq */ `{
  "project": *[_type == "project" && projectSlug == $projectSlug && ${PUBLISHED}][0]{
    "enabledModuleIds": coalesce(moduleInstallations[enabled != false].moduleId, []),
    customDomain
  },
  "site": *[_type == "siteConfig" && projectSlug == $projectSlug && ${PUBLISHED}][0]{ defaultLocale, supportedLocales },
  "posts": *[_type == "post" && projectSlug == $projectSlug && ${PUBLISHED}]{
    _id,
    "status": select(
      !defined(publishedAt) => "draft",
      publishedAt > now() => "scheduled",
      defined(expiresAt) && expiresAt <= now() => "offline",
      "published"
    )
  },
  "latestPosts": *[_type == "post" && projectSlug == $projectSlug && ${PUBLISHED}
      && defined(publishedAt) && (!defined(expiresAt) || expiresAt > now())]
    | order(publishedAt desc)[0...${ADMIN_LATEST_COUNT}]{
      _id,
      title,
      publishedAt,
      "status": select(publishedAt > now() => "scheduled", "published"),
      "coverUrl": coverImage.asset->url,
      "coverHotspot": coverImage.hotspot
    },
  "galleryCount": count(*[_type == "gallery" && projectSlug == $projectSlug && ${PUBLISHED}]),
  "latestGalleries": *[_type == "gallery" && projectSlug == $projectSlug && ${PUBLISHED}]
    | order(_updatedAt desc)[0...${ADMIN_LATEST_COUNT}]{
      _id,
      title,
      internalName,
      "count": count(items),
      "coverUrl": coalesce(mainImage->image.asset->url, items[0].mediaAsset->image.asset->url),
      "coverHotspot": coalesce(mainImage->image.hotspot, items[0].mediaAsset->image.hotspot)
    },
  "mediaTotal": count(*[_type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset) && ${PUBLISHED}]),
  "mediaAlts": *[_type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset) && ${PUBLISHED}]
    | order(_createdAt desc)[0...${ADMIN_MEDIA_SCAN}].altText
}`
