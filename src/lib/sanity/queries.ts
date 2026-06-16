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
      href,
      external,
      children[] {
        "label": ${loc('label')},
        href,
        external
      }
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
  *[_type == "post" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
    _id,
    "title": ${loc('title')},
    "slugMap": slug,
    "redirectFrom": redirectFrom,
    "excerpt": ${loc('excerpt')},
    "body": ${loc('body')},
    coverImage,
    publishedAt,
    seoMetadata,
  }
`

export const currentLiveEventQuery = /* groq */ `
  coalesce(
    *[_type == "event" && projectSlug == $projectSlug && isCurrentLiveEvent == true && now() <= endDate][0],
    *[_type == "event" && projectSlug == $projectSlug && status == "live" && now() <= endDate][0],
    *[_type == "event" && projectSlug == $projectSlug && status == "upcoming" && now() < startDate]
      | order(startDate asc)[0]
  ) {
    _id,
    "title": ${loc('title')},
    "slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) },
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
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },
      mapEmbedUrl
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
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },
      mapEmbedUrl
    }
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
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },
      mapEmbedUrl
    }
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
    radio    { lightTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity }, darkTheme { background, border, text, placeholder, focusBorder, errorBorder, successBorder, disabledOpacity } }
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
  }
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
