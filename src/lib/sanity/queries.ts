/**
 * Sanity GROQ queries for the Abluo platform.
 *
 * Rules:
 * - Every query MUST filter by tenantId — no unscoped queries ever.
 * - Use `tenantClient('slug').fetchForTenant(query, params)` to execute.
 * - $tenantId is always injected by tenantClient — do not pass it manually.
 */

// Resolve tenant config from slug (used in middleware / server components)
export const siteConfigQuery = /* groq */ `
  *[_type == "siteConfig" && tenantSlug == $tenantId][0] {
    tenantSlug,
    siteName,
    tagline,
    primaryColor,
    navigation,
    enabledFeatures,
    "tenant": tenant-> {
      displayName,
      slug,
      domain,
      locales,
      status,
    }
  }
`

// All published posts for a tenant
export const postsQuery = /* groq */ `
  *[_type == "post" && tenantSlug == $tenantId && defined(publishedAt)]
  | order(publishedAt desc) [$offset...$offset + $limit] {
    _id,
    title,
    slug,
    excerpt,
    publishedAt,
    coverImage,
    seoMetadata,
  }
`

// Single post by slug
export const postBySlugQuery = /* groq */ `
  *[_type == "post" && tenantSlug == $tenantId && slug.current == $slug][0] {
    _id,
    title,
    slug,
    excerpt,
    body,
    coverImage,
    publishedAt,
    seoMetadata,
  }
`

// Page by slug
export const pageBySlugQuery = /* groq */ `
  *[_type == "page" && tenantSlug == $tenantId && slug.current == $slug][0] {
    _id,
    title,
    slug,
    sections,
  }
`

// ─── Website rendering queries ────────────────────────────────────────────────

// Minimal siteConfig for public website header/footer
export const websiteSiteConfigQuery = /* groq */ `
  *[_type == "siteConfig" && tenantSlug == $tenantId][0] {
    tenantSlug,
    siteName,
    tagline,
    phone,
    email,
    address,
    logo { asset }
  }
`

// Full homepage with all sections
export const homePageQuery = /* groq */ `
  *[_type == "homePage" && tenantSlug == $tenantId][0] {
    tenantSlug,
    sections[] {
      _type,
      _key,
      // heroSection
      headline,
      subheadline,
      ctaLabel,
      ctaHref,
      // contentSection
      title,
      body[] { _type, _key, style, markDefs, children[] { _type, _key, marks, text } },
      imagePosition,
      // treatmentsSection
      eyebrow,
      intro,
      treatments[] { _type, _key, name, tagline, description },
      // teamSection
      subtitle,
      members[] { _type, _key, name, role, bio },
      // textSection
      content[] { _type, _key, style, listItem, level, markDefs, children[] { _type, _key, marks, text } },
      backgroundColor,
      // contactSection
      mapEmbedUrl
    }
  }
`
