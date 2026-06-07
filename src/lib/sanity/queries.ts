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

export const localeConfigQuery = /* groq */ `
  *[_type == "siteConfig" && projectSlug == $projectSlug][0] {
    defaultLocale,
    supportedLocales
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
    address,
    "livePageHeadline": ${loc('livePageHeadline')},
    "livePageSubheadline": ${loc('livePageSubheadline')},
    "livePageBetaNotice": ${loc('livePageBetaNotice')}
  }
`

export const postsQuery = /* groq */ `
  *[_type == "post" && projectSlug == $projectSlug && defined(publishedAt)]
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
  *[_type == "post" && projectSlug == $projectSlug && slug.current == $slug][0] {
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

export const currentLiveEventQuery = /* groq */ `
  coalesce(
    *[_type == "event" && projectSlug == $projectSlug && isCurrentLiveEvent == true][0],
    *[_type == "event" && projectSlug == $projectSlug && status == "live"][0],
    *[_type == "event" && projectSlug == $projectSlug && status == "upcoming"]
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

export const eventsQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug]
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

export const eventBySlugQuery = /* groq */ `
  *[_type == "event" && projectSlug == $projectSlug && slug.current == $slug][0] {
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

export const homePageQuery = /* groq */ `
  *[_type == "homePage" && projectSlug == $projectSlug][0] {
    projectSlug,
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

export const siteConfigQuery = websiteSiteConfigQuery

// ─── Design System ────────────────────────────────────────────────────────────

export const designSystemQuery = /* groq */ `
  *[_type == "designSystem" && projectSlug == $projectSlug][0] {
    colors {
      darkTheme { background, backgroundAlt, primary, secondary, accent, textPrimary, textSecondary, border },
      lightTheme { background, backgroundAlt, primary, secondary, accent, textPrimary, textSecondary, border }
    },
    typography { headingFont, bodyFont },
    radius { small, medium, large },
    buttons {
      primary { background, text, borderRadius },
      secondary { background, text, borderRadius }
    },
    cards { background, border }
  }
`
