/**
 * Sanity GROQ queries for the Abluo platform.
 *
 * Rules:
 * - Every query MUST filter by tenantId — no unscoped queries ever.
 * - Use `tenantClient('slug').fetchForTenant(query, params)` to execute.
 * - $tenantId is always injected by tenantClient — do not pass it manually.
 *
 * Multilingual fields:
 * - Text fields are stored as { it: "...", en: "..." } objects in Sanity.
 * - GROQ resolves with tenant-aware fallback chain:
 *     coalesce(field[$locale], field[$defaultLocale], field.en, field)
 *     → requested locale → tenant default → English → raw value
 * - $locale      = current UI locale (e.g. 'de')
 * - $defaultLocale = tenant's primary language from siteConfig (e.g. 'it' for Martegani, 'en' for Livener)
 * - Components receive plain strings — unaware of localization internals.
 */

// ─── Locale resolver helper ───────────────────────────────────────────────────
// Tenant-aware fallback: requested locale → tenant default → English → raw
const loc = (field: string) =>
  `coalesce(${field}[$locale], ${field}[$defaultLocale], ${field}.en, ${field})`

// Localized image projection — resolves alt and caption
const locImage = (field: string) => /* groq */ `
  ${field} {
    asset,
    hotspot,
    crop,
    "alt": ${loc('alt')},
    "caption": ${loc('caption')}
  }
`

// ─── Locale config query (must be fetched first to get $defaultLocale) ────────
// Run this once per request in the layout to get the tenant's locale config.
// Then pass defaultLocale + supportedLocales down to all child queries.
export const localeConfigQuery = /* groq */ `
  *[_type == "siteConfig" && tenantSlug == $tenantId][0] {
    defaultLocale,
    supportedLocales
  }
`

// ─── Shared queries ───────────────────────────────────────────────────────────

// Full siteConfig for nav + footer rendering
// Requires: $tenantId, $locale, $defaultLocale
export const websiteSiteConfigQuery = /* groq */ `
  *[_type == "siteConfig" && tenantSlug == $tenantId][0] {
    tenantSlug,
    siteName,
    defaultLocale,
    supportedLocales,
    showLangSwitcherInNav,
    "tagline": ${loc('tagline')},
    ${locImage('logo')},
    ${locImage('logoLight')},
    navLinks[] {
      "label": ${loc('label')},
      href,
      external
    },
    "ctaLabel": ${loc('ctaLabel')},
    ctaHref,
    footerLinks[] {
      "label": ${loc('label')},
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
    address
  }
`

// ─── Post queries ─────────────────────────────────────────────────────────────

export const postsQuery = /* groq */ `
  *[_type == "post" && tenantSlug == $tenantId && defined(publishedAt)]
  | order(publishedAt desc) [$offset...$offset + $limit] {
    _id,
    "title": ${loc('title')},
    slug,
    "excerpt": ${loc('excerpt')},
    publishedAt,
    coverImage,
    seoMetadata,
  }
`

export const postBySlugQuery = /* groq */ `
  *[_type == "post" && tenantSlug == $tenantId && slug.current == $slug][0] {
    _id,
    "title": ${loc('title')},
    slug,
    "excerpt": ${loc('excerpt')},
    "body": ${loc('body')},
    coverImage,
    publishedAt,
    seoMetadata,
  }
`

// ─── Event queries ────────────────────────────────────────────────────────────

// /live page: event flagged as current, or next upcoming event as fallback
export const currentLiveEventQuery = /* groq */ `
  coalesce(
    *[_type == "event" && tenantSlug == $tenantId && isCurrentLiveEvent == true][0],
    *[_type == "event" && tenantSlug == $tenantId && status == "live"][0],
    *[_type == "event" && tenantSlug == $tenantId && status == "upcoming"]
      | order(startDate asc)[0]
  ) {
    _id,
    "title": ${loc('title')},
    slug,
    status,
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
    youtubeUrl,
    youtubeChannelUrl,
    "ctaLabel": ${loc('ctaLabel')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')}
  }
`

// /events listing: all events ordered by date
export const eventsQuery = /* groq */ `
  *[_type == "event" && tenantSlug == $tenantId]
  | order(startDate desc) {
    _id,
    "title": ${loc('title')},
    slug,
    status,
    startDate,
    endDate,
    "location": ${loc('location')},
    "shortDescription": ${loc('shortDescription')},
    ${locImage('heroImage')},
    youtubeChannelUrl
  }
`

// /events/[slug]: single event full detail
export const eventBySlugQuery = /* groq */ `
  *[_type == "event" && tenantSlug == $tenantId && slug.current == $slug][0] {
    _id,
    "title": ${loc('title')},
    slug,
    status,
    isCurrentLiveEvent,
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
    youtubeUrl,
    youtubeChannelUrl,
    "ctaLabel": ${loc('ctaLabel')},
    "seoTitle": ${loc('seoTitle')},
    "seoDescription": ${loc('seoDescription')}
  }
`

// ─── Homepage query (studiomartegani and future tenants with sections) ─────────

export const homePageQuery = /* groq */ `
  *[_type == "homePage" && tenantSlug == $tenantId][0] {
    tenantSlug,
    sections[] {
      _type,
      _key,
      "eyebrow": ${loc('eyebrow')},
      "headline": ${loc('headline')},
      "subheadline": ${loc('subheadline')},
      "ctaLabel": ${loc('ctaLabel')},
      ctaHref,
      "title": ${loc('title')},
      "body": ${loc('body')},
      imagePosition,
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
        name,
        "role": ${loc('role')},
        "bio": ${loc('bio')},
      },
      "content": ${loc('content')},
      backgroundColor,
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },
      mapEmbedUrl
    }
  }
`

// Legacy alias — keep for backward compatibility
export const siteConfigQuery = websiteSiteConfigQuery
