/**
 * Sanity GROQ queries for the Abluo platform.
 *
 * Rules:
 * - Every query MUST filter by projectSlug — no unscoped queries ever.
 * - Use `tenantClient('slug').fetchForTenant(query, params)` to execute.
 *   tenantClient resolves the URL tenant slug (e.g. "livener") to the
 *   Sanity projectSlug (e.g. "livener-main") and injects it as $projectSlug.
 *
 * Multilingual fields:
 * - Text fields are stored as { it: "...", en: "..." } objects in Sanity.
 * - GROQ resolves with locale-aware fallback chain:
 *     coalesce(field[$locale], field[$defaultLocale], field.en, field)
 *     → requested locale → tenant default → English → raw value
 * - $locale        = current UI locale (e.g. 'de')
 * - $defaultLocale = tenant's primary language from siteConfig (e.g. 'it' for Martegani)
 * - Components receive plain strings — unaware of localization internals.
 */

const loc = (field: string) =>
  `coalesce(${field}[$locale], ${field}[$defaultLocale], ${field}.en, ${field})`

const locImage = (field: string) => /* groq */ `
  ${field} {
    asset,
    hotspot,
    crop,
    "alt": ${loc('alt')},
    "caption": ${loc('caption')}
  }
`

// ─── CTA fields projection ────────────────────────────────────────────────────
// Reusable GROQ inline fragment for the cta object type.
// Include it in any section projection that uses a CTA field.
//
// Usage in a section query:
//   primaryCta { ${CTA_FIELDS} },
//   secondaryCta { ${CTA_FIELDS} },
//
// The fragment resolves all references so the frontend receives plain values —
// no Sanity reference objects, no URL construction needed.
export const CTA_FIELDS = /* groq */ `
  "label": ${loc('label')},
  internalName,
  actionType,
  "pageSlug": coalesce(
    pageRef->slug[$locale].current,
    pageRef->slug[$defaultLocale].current
  ),
  "formId": formRef._ref,
  "formInquiryType": formRef->inquiryType,
  "fileUrl": file.asset->url,
  "fileName": file.asset->originalFilename,
  externalUrl,
  openInNewTab
`

// ─── Page sections[] projection ───────────────────────────────────────────────
// Single source of truth for the `sections[]` GROQ projection — every field
// any current section type (platform or module) can carry, locale-resolved
// via the same coalesce(field[$locale], field[$defaultLocale], field.en)
// chain as every other content field. Used verbatim (no divergent copies) by
// pageHomeQuery, pageBySlugQuery, and — as of ADR-016 Phase A — livePageQuery,
// eventsPageQuery, and blogPageQuery, so the three composable-page singletons
// project sections identically to a regular `page`. A new section field added
// here is available to every query below automatically.
//
// Emitted as a bare `sections[] { ... }` fragment (no leading/trailing comma)
// — call sites splice it in as a field alongside a document's other fields.
export const PAGE_SECTIONS_PROJECTION = /* groq */ `
    sections[] {
      _type,
      _key,
      background,
      "eyebrow": ${loc('eyebrow')},
      "headline": ${loc('headline')},
      "subheadline": ${loc('subheadline')},
      "ctaLabel": ${loc('ctaLabel')},
      ctaHref,
      "title": ${loc('title')},
      "body": ${loc('body')},
      // mediaContentSection fields — coalesce migrates old imagePosition data
      "mediaPosition": coalesce(mediaPosition, imagePosition),
      contentRatio,
      reverseOnMobile,
      mediaStyle,
      "primaryCta": primaryCta { ${CTA_FIELDS} },
      "secondaryCta": secondaryCta { ${CTA_FIELDS} },
      // statementSection fields
      "description": ${loc('description')},
      alignment,
      image { asset, hotspot, crop },
      "intro": ${loc('intro')},
      treatments[] {
        _type, _key,
        "name": ${loc('name')},
        "tagline": ${loc('tagline')},
        "description": ${loc('description')},
      },
      "subtitle": ${loc('subtitle')},
      members[] {
        _type, _key,
        photo { asset, hotspot, crop },
        name,
        "role": ${loc('role')},
        "bio": ${loc('bio')},
      },
      "content": ${loc('content')},
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },
      showMap, mapHeight, mapTheme,
      // Blog listing section fields — null on all other section types
      filterMode,
      sortOrder,
      layout,
      maxItems,
      "viewAllLabel": ${loc('viewAllLabel')},
      viewAllHref,
      "categoryId": category->._id,
      "eventId": event->._id,
      "postIds": posts[]->._id,
      // eventsListingSection fields — null on all other section types
      // (filterMode, sortOrder, layout, maxItems, viewAllLabel, viewAllHref,
      // categoryId above are shared field names, reused verbatim)
      timeFilter,
      "eventIds": events[]->._id,
      // Shared localized empty-state fields — blogListingSection,
      // eventsListingSection, liveLatestSection (ADR-016 Phase B)
      "emptyStateHeading": ${loc('emptyStateHeading')},
      "emptyStateBody": ${loc('emptyStateBody')},
      // formSection fields
      "definition": form->{
        _id,
        formId,
        formType,
        version,
        "title": ${loc('title')},
        tenantSlug,
        steps[]{
          key,
          "title": ${loc('title')},
          fields[]{
            "id": internalKey,
            type,
            required,
            width,
            contextMappable,
            "label": ${loc('label')},
            "placeholder": ${loc('placeholder')},
            "help": ${loc('help')},
            options[]{ value, "label": ${loc('label')} }
          }
        },
        "requireConsent": privacy.requireConsent,
        "consentText": ${loc('privacy.consentText')},
        "successTitle": ${loc('success.title')},
        "successBody": ${loc('success.body')}
      },
      "context": context[]{ key, value },
      // formOverlayButtonSection fields (reuses "definition" + "context" above)
      "buttonLabel": ${loc('buttonLabel')},
      "overlayTitle": ${loc('overlayTitle')},
      buttonStyle,
      buttonAlign,
      // heroSection media / layout / style fields
      mediaType,
      heroImage { asset, hotspot, crop },
      heroVideo,
      posterImage { asset, hotspot, crop },
      heroHeight,
      mediaLayout,
      contentWidth,
      contentAlignment,
      verticalAlignment,
      overlayOpacity,
      blur,
      brightness,
      // heroLiveCaptureSection + heroLensSection CTA array
      ctas[] { ${CTA_FIELDS} },
      backgroundImage { asset, hotspot, crop },
      phoneScreenImage { asset, hotspot, crop },
      circleSize,
      animationIntensity,
      // heroLensSection fields
      foregroundImage { asset, hotspot, crop },
      // videoSection fields — eyebrow/title already projected generically above
      provider,
      videoId,
      videoUrl,
      "caption": ${loc('caption')},
      aspectRatio,
      // metricsSection fields
      metrics[] {
        _type, _key,
        "value": ${loc('value')},
        animateNumber,
        "label": ${loc('label')},
        "description": ${loc('description')},
      },
      // photoGallerySection fields
      columns,
      imageRatio,
      spacing,
      showCaptions,
      "gallery": gallery->{
        _id,
        internalName,
        "description": ${loc('description')},
        items[] {
          _key,
          titleOverrideEnabled,
          "titleOverride": select(titleOverrideEnabled == true => ${loc('titleOverride')}),
          captionOverrideEnabled,
          "captionOverride": select(captionOverrideEnabled == true => ${loc('captionOverride')}),
          "mediaAsset": mediaAsset->{
            _id,
            mediaType,
            image { asset, hotspot, crop },
            videoUrl,
            "altText": ${loc('altText')},
            "title": ${loc('title')},
            "caption": ${loc('caption')},
          }
        }
      }
    }
`

export const localeConfigQuery = /* groq */ `
  *[_type == "siteConfig" && projectSlug == $projectSlug][0] {
    defaultLocale,
    supportedLocales
  }
`

// ─── Favicon-only query (no locale params needed) ─────────────────────────────
// Used by generateMetadata in the tenant layout. Fetches only the favicon
// fields from siteConfig so we can apply the three-level precedence:
//   siteConfig.faviconSvg → siteConfig.faviconPng → designSystem.branding.favicon
// Fetches branding assets needed for <head> metadata only (no locale params).
// Used by generateMetadata in the tenant layout to resolve favicon + OG image.
export const siteConfigFaviconQuery = /* groq */ `
  *[_type == "siteConfig" && projectSlug == $projectSlug][0] {
    faviconSvg { asset },
    faviconPng { asset },
    openGraphImage { asset },
    appleTouchIcon { asset },
    "googleSiteVerification": googleSiteVerification,
    "bingSiteVerification": bingSiteVerification
  }
`

export const websiteSiteConfigQuery = /* groq */ `
  *[_type == "siteConfig" && projectSlug == $projectSlug][0] {
    projectSlug,
    siteName,
    defaultLocale,
    supportedLocales,
    showLangSwitcherInNav,
    "tagline": ${loc('tagline')},
    ${locImage('logo')},
    ${locImage('logoLight')},
    backgroundGraphic {
      enabled,
      ${locImage('asset')},
      opacity,
      scale,
      mobileScale,
      rotation,
      positionPreset,
      offsetX,
      offsetY,
      mobileOffsetX,
      mobileOffsetY,
      scrollBehavior,
      scope
    },
    headerAppearance {
      stickyHeader,
      initialStyle,
      scrolledStyle,
      backgroundOpacity,
      blurEffect,
      shadow,
      headerHeight,
      customHeight,
      zIndex,
      borderStyle
    },
    languageSwitcherPlacement,
    themeMode,
    themeSwitcherPlacement,
    navLinks[] {
      "label": ${loc('label')},
      linkType,
      "pageSlug": coalesce(pageRef->slug[$locale].current, pageRef->slug[$defaultLocale].current),
      internalPage,
      externalUrl,
      openInNewTab,
      href,
      external,
      children[] {
        "label": ${loc('label')},
        linkType,
        "pageSlug": coalesce(pageRef->slug[$locale].current, pageRef->slug[$defaultLocale].current),
        internalPage,
        externalUrl,
        openInNewTab,
        href,
        external
      }
    },
    "ctaLabel": ${loc('ctaLabel')},
    ctaHref,
    footerLinks[] {
      "label": ${loc('label')},
      linkType,
      internalPage,
      externalUrl,
      openInNewTab,
      href,
      external
    },
    "footerCtaHeading": ${loc('footerCtaHeading')},
    "footerCtaSubtext": ${loc('footerCtaSubtext')},
    "footerCtaInputPlaceholder": ${loc('footerCtaInputPlaceholder')},
    "footerCtaButtonLabel": ${loc('footerCtaButtonLabel')},
    legalName,
    legalAddress,
    registrationInfo,
    foundedYear,
    youtubeChannelUrl,
    socialLinks[] { platform, url },
    phone,
    email,
    location { street, postalCode, city, state, country },
    address,
    openGraphImage { asset },
    logoHeightDesktop,
    logoHeightMobile,
    "seoDefaultTitle": ${loc('seoDefaultTitle')},
    "seoDefaultDescription": ${loc('seoDefaultDescription')},
    "customDomain": *[_type == "project" && projectSlug == $projectSlug && defined(customDomain)][0].customDomain
  }
`

// ─── Minimal query for canonical URL resolution ───────────────────────────────
// Used by generateMetadata in pages that don't fetch websiteSiteConfigQuery
// (blog/[slug], events/[slug], live). Source of truth: project.customDomain,
// synced from Supabase via ProjectLinker.
export const projectDomainQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug && defined(customDomain)][0].customDomain
`

// ─── Runtime integration configuration (ADR-014 Phase C) ──────────────────────
// Source of truth for tracking/analytics runtime behavior: project.integrationConfigs
// (the Integration Registry, ADR-014 Phase A) and project.privacy (Phase B). Replaces
// the removed siteConfig.integrations block — no compatibility layer, per Tom's
// explicit rule (the old model was already removed from the schema in Phase B).
// Consumed by TrackingScripts.tsx via fetchForTenant, same pattern as projectDomainQuery.
export const projectIntegrationsQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0] {
    integrationConfigs[] { integrationId, enabled, values },
    privacy { consentModeEnabled, trackingKillSwitch }
  }
`

// ─── Enabled module IDs (ADR-016 Phase D) ─────────────────────────────────────
// Single source of truth for a tenant's installed-module set at website
// render time. Mirrors the exact select() projection used for Studio nav in
// sanity.config.ts (the "enabledModuleIds" projection there) — do not fork
// this logic into a second shape. For migrated projects: derived from
// moduleInstallations[enabled != false].moduleId. For unmigrated projects:
// falls back to coalesce(enabledModules, []). Returns the array directly
// (not wrapped in an object) via the trailing dot-projection.
// Consumed by hydrateSections/SectionRenderer via fetchForTenant, same
// pattern as projectDomainQuery / projectIntegrationsQuery.
export const enabledModuleIdsQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0] {
    "enabledModuleIds": select(
      defined(moduleInstallations) && count(moduleInstallations) > 0 => moduleInstallations[enabled != false].moduleId,
      coalesce(enabledModules, [])
    )
  }.enabledModuleIds
`

export const postsQuery = /* groq */ `
  *[
    _type == "post"
    && projectSlug == $projectSlug
    && defined(publishedAt)
    && publishedAt <= now()
    && (!defined(expiresAt) || expiresAt > now())
  ]
  | order(featured desc, publishedAt desc) [$offset...$offset + $limit] {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    "excerpt": ${loc('excerpt')},
    publishedAt,
    expiresAt,
    featured,
    ${locImage('coverImage')},
    "readingTimeMinutes": math::max([1, round(
      length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / 1200
    )]),
    "author": author-> {
      name,
      "role": ${loc('role')},
      avatar { asset, hotspot, crop }
    },
    "categories": categories[]-> {
      _id,
      "title": ${loc('title')},
      "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
      color
    },
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
  }
`

// ─── Dashboard posts (ADR-017 slice 6 / ADR-015 close-out) ────────────────────
// The client dashboard's posts list. UNLIKE postsQuery (the PUBLIC website
// list, which filters `defined(publishedAt) && publishedAt <= now()`), this
// query returns ALL posts for the project regardless of publish state — the
// client needs to see drafts and scheduled posts they haven't published yet.
//
// A `status` field is derived so the dashboard can label each row without a
// second pass: "published" when publishedAt is set and in the past, otherwise
// "draft" (covers both never-published and future-scheduled posts). Ordered by
// most-recently-touched first (publishedAt when set, else _updatedAt).
//
// Executed ONLY through tenantScopedSanityClient (getDashboardPosts), which
// forces $projectSlug from the caller's ProjectGrant — this query references
// $projectSlug (required by the chokepoint's assertQueryIsTenantScoped guard)
// and never interpolates tenant identity.
export const dashboardPostsQuery = /* groq */ `
  *[_type == "post" && projectSlug == $projectSlug]
  | order(coalesce(publishedAt, _updatedAt) desc) {
    _id,
    "title": ${loc('title')},
    "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
    "status": select(
      defined(publishedAt) && publishedAt <= now() => "published",
      "draft"
    ),
    "updatedAt": _updatedAt
  }
`

export const postBySlugQuery = /* groq */ `
  *[_type == "post" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
    _id,
    "title": ${loc('title')},
    "slugMap": slug,
    "redirectFrom": redirectFrom,
    "excerpt": ${loc('excerpt')},
    "body": ${loc('body')},
    publishedAt,
    featured,
    ${locImage('coverImage')},
    featuredVideo {
      provider,
      youtubeUrl,
      cloudflareVideoId
    },
    "readingTimeMinutes": math::max([1, round(
      length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / 1200
    )]),
    "author": author-> {
      _id,
      name,
      "role": ${loc('role')},
      "bio": ${loc('bio')},
      avatar { asset, hotspot, crop }
    },
    "categories": categories[]-> {
      _id,
      "title": ${loc('title')},
      "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
      color
    },
    "relatedEvent": relatedEvent-> {
      _id,
      "title": ${loc('title')},
      "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
      status,
      startDate,
      endDate,
      "location": ${loc('location')},
      "shortDescription": ${loc('shortDescription')},
      ${locImage('heroImage')}
    },
    "seoTitle": coalesce(${loc('seoTitle')}, ${loc('title')}),
    "seoDescription": coalesce(${loc('seoDescription')}, ${loc('excerpt')}),
    seoImage { asset, hotspot, crop },
  }
`

export const postByOldSlugQuery = /* groq */ `
  *[_type == "post" && projectSlug == $projectSlug && $slug in redirectFrom[$locale]][0] {
    "currentSlug": slug[$locale].current
  }
`

// Fetches up to 3 related posts for the blog detail page.
// Prioritises posts that share at least one category with the current post,
// then falls back to featured / most recent from the same project.
// $excludeId prevents the current post from appearing in the results.
// $categoryIds should be the array of _ref strings from the current post's categories.
export const relatedPostsQuery = /* groq */ `
  *[
    _type == "post"
    && projectSlug == $projectSlug
    && _id != $excludeId
    && defined(publishedAt)
    && publishedAt <= now()
    && (!defined(expiresAt) || expiresAt > now())
  ] | order(
    count((categories[]._ref)[@ in $categoryIds]) desc,
    featured desc,
    publishedAt desc
  ) [0...3] {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    "excerpt": ${loc('excerpt')},
    publishedAt,
    featured,
    ${locImage('coverImage')},
    "readingTimeMinutes": math::max([1, round(
      length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / 1200
    )]),
    "author": author-> {
      name,
      "role": ${loc('role')},
      avatar { asset, hotspot, crop }
    },
    "categories": categories[]-> {
      _id,
      "title": ${loc('title')},
      "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
      color
    }
  }
`

// ─── Blog Listing Section ─────────────────────────────────────────────────────
//
// Shared post card fields used by the blog listing section component.
// Separate query exports for each sort order — GROQ does not support
// dynamic sort direction via parameters, so we select the right query
// in the page server component based on section.sortOrder.

const blogListingCardFields = /* groq */ `
  _id,
  "title": coalesce(title[$locale], title[$defaultLocale], title.en, title),
  "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
  "excerpt": coalesce(excerpt[$locale], excerpt[$defaultLocale], excerpt.en, excerpt),
  publishedAt,
  featured,
  coverImage {
    asset,
    hotspot,
    crop,
    "alt": coalesce(alt[$locale], alt[$defaultLocale], alt.en, alt),
    "caption": coalesce(caption[$locale], caption[$defaultLocale], caption.en, caption)
  },
  "readingTimeMinutes": math::max([1, round(
    length(pt::text(coalesce(body[$locale], body[$defaultLocale], body.en))) / 1200
  )]),
  "author": author-> {
    name,
    "role": coalesce(role[$locale], role[$defaultLocale], role.en, role),
    avatar { asset, hotspot, crop }
  },
  "categories": categories[]-> {
    _id,
    "title": coalesce(title[$locale], title[$defaultLocale], title.en, title),
    "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
    color
  }
`

// Core filter — applied by all three blog listing queries.
// filterMode is injected as a GROQ parameter. Conditional logic:
//   latest       → no extra filter
//   featured     → featured == true
//   byCategory   → $categoryId in categories[]._ref
//   byEvent      → relatedEvent._ref == $eventId
const blogListingFilter = /* groq */ `
  _type == "post"
  && projectSlug == $projectSlug
  && defined(publishedAt)
  && publishedAt <= now()
  && (!defined(expiresAt) || expiresAt > now())
  && (
    $filterMode == "latest"
    || ($filterMode == "featured" && featured == true)
    || ($filterMode == "byCategory" && $categoryId in categories[]._ref)
    || ($filterMode == "byEvent" && relatedEvent._ref == $eventId)
  )
`

// Fetch up to $maxItems posts — newest first.
// Also fetches one extra ($maxItems + 1) so the page component can detect
// whether a "View All" button is warranted without a separate count query.
export const blogListingPostsNewestQuery = /* groq */ `
  *[${blogListingFilter}]
  | order(featured desc, publishedAt desc)
  [0...$maxItems] { ${blogListingCardFields} }
`

// Oldest first variant (identical filter, ascending sort).
export const blogListingPostsOldestQuery = /* groq */ `
  *[${blogListingFilter}]
  | order(publishedAt asc)
  [0...$maxItems] { ${blogListingCardFields} }
`

// Manual selection — fetch by explicit post IDs.
// The page component re-orders the result to match the original $postIds array order.
export const blogListingManualPostsQuery = /* groq */ `
  *[_type == "post" && _id in $postIds] { ${blogListingCardFields} }
`

// ─── Events Listing Section (ADR-016 Phase B, 'live' added Phase C) ───────────
//
// Modeled on the Blog Listing Section queries above. Adds a $timeFilter
// parameter (upcoming / live / past / all) compared against event.startDate /
// event.status — events carry a date + status dimension blog posts don't.
//
// Consumers (frontend-sections, hydrateSections): pick the query matching
// section.sortOrder exactly as blogListing* is picked today. Params required
// on all three: projectSlug (injected by fetchForTenant), locale,
// defaultLocale, maxItems, timeFilter, filterMode, and — depending on
// filterMode — categoryId (byCategory) or eventIds (manual, via the
// *Manual* query's $eventIds).

const eventsListingCardFields = /* groq */ `
  _id,
  "title": coalesce(title[$locale], title[$defaultLocale], title.en, title),
  "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
  status,
  startDate,
  endDate,
  "location": coalesce(location[$locale], location[$defaultLocale], location.en, location),
  "shortDescription": coalesce(shortDescription[$locale], shortDescription[$defaultLocale], shortDescription.en, shortDescription),
  heroImage {
    asset,
    hotspot,
    crop,
    "alt": coalesce(alt[$locale], alt[$defaultLocale], alt.en, alt),
    "caption": coalesce(caption[$locale], caption[$defaultLocale], caption.en, caption)
  },
  "categories": categories[]-> {
    _id,
    "title": coalesce(title[$locale], title[$defaultLocale], title.en, title),
    "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
    color
  }
`

// Core filter — applied by all three eventsListing queries.
// $timeFilter and $filterMode are injected as GROQ parameters.
//   timeFilter: upcoming → startDate >= now() | live → status == "live" (mirrors
//               additionalLiveEventsQuery/currentLiveEventQuery's live-status
//               check, including the endDate guard) | past → startDate < now()
//               | all → no restriction
//   filterMode: latest → no extra filter | featured → featuredOnHomePage == true
//               | byCategory → $categoryId in categories[]._ref
//
// ADR-016 Phase C — 'live' added so eventsListingSection can reproduce the
// livePage "More Live Productions" block. Unlike additionalLiveEventsQuery,
// this does NOT exclude any particular event (e.g. the one a co-located
// liveLatestSection is showing) — a generic section has no way to know what
// another section selected. See schema.ts eventsListingSectionType comment
// for the accepted parity delta.
const eventsListingFilter = /* groq */ `
  _type == "event"
  && projectSlug == $projectSlug
  && (
    $timeFilter == "all"
    || ($timeFilter == "upcoming" && startDate >= now())
    || ($timeFilter == "live" && status == "live" && (endDate == null || now() <= endDate))
    || ($timeFilter == "past" && startDate < now())
  )
  && (
    $filterMode == "latest"
    || ($filterMode == "featured" && featuredOnHomePage == true)
    || ($filterMode == "byCategory" && $categoryId in categories[]._ref)
  )
`

// Fetch up to $maxItems events — newest (soonest/most-recent) first.
// Also fetches one extra ($maxItems + 1) so the page component can detect
// whether a "View All" button is warranted, matching the blogListing pattern.
export const eventsListingEventsNewestQuery = /* groq */ `
  *[${eventsListingFilter}]
  | order(startDate desc)
  [0...$maxItems] { ${eventsListingCardFields} }
`

// Oldest first variant (identical filter, ascending sort by startDate).
export const eventsListingEventsOldestQuery = /* groq */ `
  *[${eventsListingFilter}]
  | order(startDate asc)
  [0...$maxItems] { ${eventsListingCardFields} }
`

// Manual selection — fetch by explicit event IDs.
// The page component re-orders the result to match the original $eventIds array order.
export const eventsListingManualEventsQuery = /* groq */ `
  *[_type == "event" && _id in $eventIds] { ${eventsListingCardFields} }
`

export const currentLiveEventQuery = /* groq */ `
  coalesce(
    // Explicitly featured on live page, within optional scheduling window
    *[
      _type == "event"
      && projectSlug == $projectSlug
      && (featuredOnLivePage == true || isCurrentLiveEvent == true)
      && (livePageFeatureStartDate == null || now() >= livePageFeatureStartDate)
      && (livePageFeatureEndDate == null || now() <= livePageFeatureEndDate)
      && (endDate == null || now() <= endDate)
    ][0],
    // Fallback: any live-status event
    *[_type == "event" && projectSlug == $projectSlug && status == "live" && (endDate == null || now() <= endDate)][0],
    // Fallback: next upcoming event
    *[_type == "event" && projectSlug == $projectSlug && status == "upcoming" && now() < startDate]
      | order(startDate asc)[0]
  ) {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    status,
    featuredOnLivePage,
    isCurrentLiveEvent,
    startDate,
    endDate,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    "fullDescription": ${loc('fullDescription')},
    ${locImage('heroImage')},
    schedule[] {
      _key,
      time,
      "title": ${loc('title')},
      "description": ${loc('description')}
    },
    embedPlayerEnabled,
    embedVideoUrl,
    "primaryStreamLabel": ${loc('primaryStreamLabel')},
    primaryStreamUrl,
    "secondaryStreamLabel": ${loc('secondaryStreamLabel')},
    secondaryStreamUrl,
    youtubeChannelUrl,
    youtubeUrl,
    "ctaLabel": ${loc('ctaLabel')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')}
  }
`

// ─── Homepage Featured Event ───────────────────────────────────────────────────
// Returns the single active homepage-featured event, or null if none qualifies.
// Sorting: live events first, then upcoming by nearest start date.
const homepageFeaturedEventFields = /* groq */ `
  _id,
  "title": ${loc('title')},
  "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
  status,
  featuredOnHomePage,
  startDate,
  endDate,
  "location": ${loc('location')},
  "shortDescription": ${loc('shortDescription')},
  ${locImage('heroImage')},
  "primaryStreamLabel": ${loc('primaryStreamLabel')},
  primaryStreamUrl,
  "secondaryStreamLabel": ${loc('secondaryStreamLabel')},
  secondaryStreamUrl,
  youtubeUrl,
  "ctaLabel": ${loc('ctaLabel')}
`

export const homepageFeaturedEventQuery = /* groq */ `
  coalesce(
    // Live events that are featured on homepage (within date window)
    *[
      _type == "event"
      && projectSlug == $projectSlug
      && featuredOnHomePage == true
      && status == "live"
      && (homePageFeatureStartDate == null || now() >= homePageFeatureStartDate)
      && (homePageFeatureEndDate == null || now() <= homePageFeatureEndDate)
    ] | order(startDate asc)[0] { ${homepageFeaturedEventFields} },
    // Upcoming events that are featured on homepage (within date window)
    *[
      _type == "event"
      && projectSlug == $projectSlug
      && featuredOnHomePage == true
      && status == "upcoming"
      && (homePageFeatureStartDate == null || now() >= homePageFeatureStartDate)
      && (homePageFeatureEndDate == null || now() <= homePageFeatureEndDate)
    ] | order(startDate asc)[0] { ${homepageFeaturedEventFields} }
  )
`

export const eventsQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug]
  | order(startDate desc) {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    status,
    startDate,
    endDate,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    ${locImage('heroImage')},
    youtubeChannelUrl
  }
`

export const pastEventsQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && (status == "past" || now() > endDate)]
  | order(startDate desc) [0..4] {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    status,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    ${locImage('heroImage')},
    startDate,
    endDate
  }
`

// Additional live events — all events with status "live" except the featured one.
// $featuredEventId should be the _id of the currently featured live event (or "" if none).
export const additionalLiveEventsQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && status == "live" && _id != $featuredEventId && (endDate == null || now() <= endDate)]
  | order(startDate asc) {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
    status,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    ${locImage('heroImage')},
    startDate,
    endDate
  }
`

export const eventByOldSlugQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && $slug in redirectFrom[$locale]][0] {
    "currentSlug": slug[$locale].current
  }
`

export const eventBySlugQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
    _id,
    "title": ${loc('title')},
    "slugMap": slug,
    "redirectFrom": redirectFrom,
    status,
    featuredOnLivePage,
    isCurrentLiveEvent,
    featuredOnHomePage,
    homePageFeatureStartDate,
    homePageFeatureEndDate,
    startDate,
    endDate,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    "fullDescription": ${loc('fullDescription')},
    ${locImage('heroImage')},
    gallery[] {
      asset,
      hotspot,
      crop,
      "alt": ${loc('alt')},
      "caption": ${loc('caption')}
    },
    schedule[] {
      _key,
      time,
      "title": ${loc('title')},
      "description": ${loc('description')}
    },
    embedPlayerEnabled,
    embedVideoUrl,
    "primaryStreamLabel": ${loc('primaryStreamLabel')},
    primaryStreamUrl,
    "secondaryStreamLabel": ${loc('secondaryStreamLabel')},
    secondaryStreamUrl,
    youtubeChannelUrl,
    youtubeUrl,
    "ctaLabel": ${loc('ctaLabel')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')}
  }
`

// Legacy — kept for backward compat. New tenants use pageHomeQuery below.
export const homePageQuery = /* groq */ `
  *[_type == "homePage" && projectSlug == $projectSlug][0] {
    projectSlug,
    backgroundPattern,
    sections[] {
      _type,
      _key,
      background,
      "eyebrow": ${loc('eyebrow')},
      "headline": ${loc('headline')},
      "subheadline": ${loc('subheadline')},
      "ctaLabel": ${loc('ctaLabel')},
      ctaHref,
      "title": ${loc('title')},
      "body": ${loc('body')},
      // mediaContentSection fields — coalesce migrates old imagePosition data
      "mediaPosition": coalesce(mediaPosition, imagePosition),
      contentRatio,
      reverseOnMobile,
      mediaStyle,
      "primaryCta": primaryCta { ${CTA_FIELDS} },
      "secondaryCta": secondaryCta { ${CTA_FIELDS} },
      // statementSection fields
      "description": ${loc('description')},
      alignment,
      image { asset, hotspot, crop },
      "intro": ${loc('intro')},
      treatments[] {
        _type, _key,
        "name": ${loc('name')},
        "tagline": ${loc('tagline')},
        "description": ${loc('description')},
      },
      "subtitle": ${loc('subtitle')},
      members[] {
        _type, _key,
        photo { asset, hotspot, crop },
        name,
        "role": ${loc('role')},
        "bio": ${loc('bio')},
      },
      "content": ${loc('content')},
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },
      showMap, mapHeight, mapTheme,
      "definition": form->{
        _id,
        formId,
        formType,
        version,
        "title": ${loc('title')},
        tenantSlug,
        steps[]{
          key,
          "title": ${loc('title')},
          fields[]{
            "id": internalKey,
            type,
            required,
            width,
            contextMappable,
            "label": ${loc('label')},
            "placeholder": ${loc('placeholder')},
            "help": ${loc('help')},
            options[]{ value, "label": ${loc('label')} }
          }
        },
        "requireConsent": privacy.requireConsent,
        "consentText": ${loc('privacy.consentText')},
        "successTitle": ${loc('success.title')},
        "successBody": ${loc('success.body')}
      },
      "context": context[]{ key, value },
      // formOverlayButtonSection fields (reuses "definition" + "context" above)
      "buttonLabel": ${loc('buttonLabel')},
      "overlayTitle": ${loc('overlayTitle')},
      buttonStyle,
      buttonAlign,
      // heroSection media / layout / style fields
      mediaType,
      heroImage { asset, hotspot, crop },
      heroVideo,
      posterImage { asset, hotspot, crop },
      heroHeight,
      mediaLayout,
      contentWidth,
      contentAlignment,
      verticalAlignment,
      overlayOpacity,
      blur,
      brightness,
      // metricsSection fields
      metrics[] {
        _type, _key,
        "value": ${loc('value')},
        animateNumber,
        "label": ${loc('label')},
        "description": ${loc('description')},
      },
      // photoGallerySection fields
      columns,
      imageRatio,
      spacing,
      showCaptions,
      "gallery": gallery->{
        _id,
        internalName,
        "description": ${loc('description')},
        items[] {
          _key,
          titleOverrideEnabled,
          "titleOverride": select(titleOverrideEnabled == true => ${loc('titleOverride')}),
          captionOverrideEnabled,
          "captionOverride": select(captionOverrideEnabled == true => ${loc('captionOverride')}),
          "mediaAsset": mediaAsset->{
            _id,
            mediaType,
            image { asset, hotspot, crop },
            videoUrl,
            "altText": ${loc('altText')},
            "title": ${loc('title')},
            "caption": ${loc('caption')},
          }
        }
      }
    }
  }
`

// Fetches the homepage from the new page system (pageType == "home").
export const pageHomeQuery = /* groq */ `
  *[_type == "page" && projectSlug == $projectSlug && pageType == "home"][0] {
    _id,
    pageType,
    "title": ${loc('title')},
    slug,
    backgroundPattern,
    ${PAGE_SECTIONS_PROJECTION}
  }
`

export const pageBySlugQuery = /* groq */ `
  *[_type == "page" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
    _id,
    pageType,
    "title": ${loc('title')},
    "slugMap": slug,
    "redirectFrom": redirectFrom,
    backgroundPattern,
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// Used for 301 redirects: find the page that has $slug in its redirectFrom[$locale] array.
// Returns just the current slug for the locale so we can redirect to it.
export const pageByOldSlugQuery = /* groq */ `
  *[_type == "page" && projectSlug == $projectSlug && $slug in redirectFrom[$locale]][0] {
    "currentSlug": slug[$locale].current
  }
`

export const siteConfigQuery = websiteSiteConfigQuery

// ─── Live Page ────────────────────────────────────────────────────────────────
// ADR-016 Phase A: projects the additive sections[] field via the shared
// PAGE_SECTIONS_PROJECTION fragment — identical to how page queries project
// it. Absent on documents published before this field existed; GROQ resolves
// a missing array field to null, which the frontend already treats as empty.

// ADR-016 Phase C — heroTitle, heroSubtitle, betaNotice, introText,
// heroImage, cloudflareVideoId, featuredEvents projections retired: zero
// remaining runtime reads (live/page.tsx renders body + metadata entirely
// from sections[]/seoTitle/seoDescription). See migration 002 + 003.
export const livePageQuery = /* groq */ `
  *[_type == "livePage" && projectSlug == $projectSlug][0] {
    _id,
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// ─── Events Page ──────────────────────────────────────────────────────────────
// ADR-016 Phase C — introText, heroImage, cloudflareVideoId projections
// retired (no remaining reads). heroTitle/heroSubtitle are KEPT — still
// read as SEO-fallback strings by generateMetadata in events/page.tsx.

export const eventsPageQuery = /* groq */ `
  *[_type == "eventsPage" && projectSlug == $projectSlug][0] {
    _id,
    "heroTitle": ${loc('heroTitle')},
    "heroSubtitle": ${loc('heroSubtitle')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// ─── Blog Page ────────────────────────────────────────────────────────────────
// ADR-016 Phase C — eyebrow projection retired (no remaining reads).
// heroTitle/heroSubtitle are KEPT — still read as SEO-fallback strings by
// generateMetadata in blog/page.tsx.

export const blogPageQuery = /* groq */ `
  *[_type == "blogPage" && projectSlug == $projectSlug][0] {
    _id,
    "heroTitle": ${loc('heroTitle')},
    "heroSubtitle": ${loc('heroSubtitle')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')},
    ${PAGE_SECTIONS_PROJECTION}
  }
`

// ─── Design System ────────────────────────────────────────────────────────────

/**
 * Canonical GROQ field selection for a design system document.
 *
 * This is the SINGLE SOURCE OF TRUTH for which fields are fetched.
 * Used in both designSystemQuery (primary tenant fetch) and
 * fetchDesignSystemById (parent fetch during inheritance resolution).
 *
 * Adding a new design system field? Do it here — both query paths
 * update automatically. Then add the merge logic in design-system-resolver.ts.
 */
export const DS_FIELDS_SELECTION = /* groq */ `{
  _id,
  name,
  role,
  description,
  parentDesignSystem,
  eyebrowAccent,

  colors {
    darkTheme {
      background, backgroundAlt, surface,
      primary, secondary, accent,
      textPrimary, textSecondary, textMuted,
      border,
      success, warning, danger
    },
    lightTheme {
      background, backgroundAlt, surface,
      primary, secondary, accent,
      textPrimary, textSecondary, textMuted,
      border,
      success, warning, danger
    }
  },

  typography {
    headingFont { source, libraryFont, googleFont },
    bodyFont { source, libraryFont, googleFont }
  },

  radius { small, medium, large },
  spacing { xs, s, m, l, xl },

  buttons {
    primary {
      lightTheme { background, text, borderRadius, hover { background, text } },
      darkTheme { background, text, borderRadius, hover { background, text } }
    },
    secondary {
      lightTheme { background, text, borderRadius, hover { background, text } },
      darkTheme { background, text, borderRadius, hover { background, text } }
    }
  },

  cards {
    lightTheme { background, border },
    darkTheme { background, border }
  },

  sectionSurfaces {
    lightTheme {
      surface1, surface2, surface3, brandSurface,
      glass { backgroundOklch, backdropBlur, borderColor, borderWidth }
    },
    darkTheme {
      surface1, surface2, surface3, brandSurface,
      glass { backgroundOklch, backdropBlur, borderColor, borderWidth }
    }
  },

  branding {
    logo { asset },
    logoLight { asset },
    logoHeightDesktop,
    logoHeightMobile,
    favicon { asset }
  },

  backgroundAssets[] {
    key, name,
    lightImage { asset-> },
    darkImage { asset-> }
  },

  glass { backgroundOklch, backdropBlur, borderColor, borderWidth },

  forms {
    input    { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    textarea { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    select   { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    checkbox { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    radio    { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } },
    typography { labelColor, labelSize, labelWeight, helpTextColor, helpTextSize, errorTextColor, errorTextSize, requiredColor },
    geometry   { inputHeight, paddingX, paddingY, labelGap, fieldGap, borderRadius }
  },

  navigation { menuRadius, menuGap, dropdownRadius, dropdownStyle },

  cardVariants[] {
    key, label,
    lightTheme { background, border },
    darkTheme { background, border }
  },

  shadows { card, dropdown, modal },

  layout {
    maxContentWidth, maxTextWidth,
    sectionPaddingY, sectionPaddingYCompact, sectionPaddingYLarge
  },

  motion {
    durationFast, durationBase, durationSlow, durationSlower,
    easingStandard, easingDecelerate, easingAccelerate, easingEmphasized
  },

  mediaStyles[] { key, label, borderRadius, aspectRatio, objectFit }
}`

// Fetches the design system for a project.
// Primary path:  project.designSystemRef -> design system document
// Fallback path: design system where projectSlug matches (legacy / unmigrated projects)
// Includes parentDesignSystem reference for inheritance resolution.
export const designSystemQuery = /* groq */ `
  coalesce(
    *[_type == "project" && projectSlug == $projectSlug][0].designSystemRef->,
    *[_type == "designSystem" && projectSlug == $projectSlug][0]
  ) ${DS_FIELDS_SELECTION}
`


// ── Project notification recipients (ADR-019) ─────────────────────────────────
// Returns the project's notifications.recipients groups (topic/emails/enabled),
// read at send time by the form-notification consumer. Same $projectSlug pattern
// as projectIntegrationsQuery / enabledModuleIdsQuery.
export const projectNotificationsQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0].notifications.recipients[]{
    topic, emails, enabled
  }
`

// ── Internal-email personalization config (ADR-019 Amendment A) ───────────────
// Tenant/project-level identity + copy, read at send time. `intro` is resolved
// at the event locale; `clientName` is the fromName default. Takes $projectSlug,
// $locale, $defaultLocale.
export const projectInternalEmailQuery = /* groq */ `
  *[_type == "project" && projectSlug == $projectSlug][0]{
    "internalEmail": notifications.internalEmail{
      fromName,
      subjectTemplate,
      replyToSubmitter,
      "intro": coalesce(intro[$locale], intro[$defaultLocale], intro.en)
    },
    "clientName": clientRef->displayName,
    "logoUrl": *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].logo.asset->url
  }
`
