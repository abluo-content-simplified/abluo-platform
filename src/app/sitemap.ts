import type { MetadataRoute } from 'next'

const locales = ['it', 'en'] as const

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  // Guard: skip Sanity fetch if env vars are not configured (e.g. during build preview)
  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
    return []
  }

  try {
    // Dynamic import avoids module-level client instantiation during builds
    // where env vars may not yet be available
    const { sanityClient } = await import('@/lib/sanity/client')
    const tenants = await sanityClient.fetch<{ tenantSlug: string }[]>(
      `*[_type == "siteConfig"] | order(siteName asc) { tenantSlug }`
    )

    return tenants.flatMap(({ tenantSlug }) =>
      locales.map((locale) => ({
        url: `${baseUrl}/${locale}/${tenantSlug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: locale === 'it' ? 1.0 : 0.9,
      }))
    )
  } catch {
    return []
  }
}
