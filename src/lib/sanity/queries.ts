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
 * - GROQ resolves them: coalesce(field[$locale], field.it, field)
 *   → requested locale → Italian fallback → plain string (legacy data safety)
 * - Components receive plain strings — unaware of localization.
 * - Pass $locale in params (e.g. { locale: 'it' }). Defaults to 'it' via fallback.
 */

// ─── Locale resolver helper ───────────────────────────────────────────────────
const loc = (field: string) =>
  `coalesce(${field}[$locale], ${field}.it, ${field})`

// ─── Shared queries ───────────────────────────────────────────────────────────

export const siteConfigQuery = /* groq */ `
  *[_type == "siteConfig" && tenantSlug == $tenantId][0] {
    tenantSlug,
    siteName,
    "tagline": ${loc('tagline')},
    primaryColor,
    navigation,
    enabledFeatures
  }
`

// All published posts for a tenant
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

// Single post by slug
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

// ─── Website rendering queries ────────────────────────────────────────────────

// Minimal siteConfig for public website header/footer
export const websiteSiteConfigQuery = /* groq */ `
  *[_type == "siteConfig" && tenantSlug == $tenantId][0] {
    tenantSlug,
    siteName,
    "tagline": ${loc('tagline')},
    phone,
    email,
    address,
    logo { asset }
  }
`

// Full homepage with all sections — locale-resolved
export const homePageQuery = /* groq */ `
  *[_type == "homePage" && tenantSlug == $tenantId][0] {
    tenantSlug,
    sections[] {
      _type,
      _key,

      // heroSection
      "headline": ${loc('headline')},
      "subheadline": ${loc('subheadline')},
      "ctaLabel": ${loc('ctaLabel')},
      ctaHref,

      // contentSection
      "title": ${loc('title')},
      "body": ${loc('body')},
      imagePosition,

      // treatmentsSection
      "eyebrow": ${loc('eyebrow')},
      "intro": ${loc('intro')},
      treatments[] {
        _type, _key,
        "name": ${loc('name')},
        "tagline": ${loc('tagline')},
        "description": ${loc('description')},
      },

      // teamSection
      "subtitle": ${loc('subtitle')},
      members[] {
        _type, _key,
        name,
        "role": ${loc('role')},
        "bio": ${loc('bio')},
      },

      // textSection
      "content": ${loc('content')},
      backgroundColor,

      // faqSection
      items[] {
        _key,
        "question": ${loc('question')},
        "answer": ${loc('answer')},
      },

      // contactSection
      mapEmbedUrl
    }
  }
`
