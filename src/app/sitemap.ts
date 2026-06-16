import type { MetadataRoute } from 'next'

// Reverse of TENANT_TO_PROJECT in client.ts — projectSlug → URL tenant slug
const PROJECT_TO_TENANT: Record<string, string> = {
  'livener-main': 'livener',
  'studiomartegani-main': 'studiomartegani',
}

interface TenantSitemapData {
  projectSlug: string
  supportedLocales?: string[]
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) return []

  try {
    const { sanityClient } = await import('@/lib/sanity/client')

    // Fetch active projects with their tenant-specific supportedLocales.
    // Each project's siteConfig.supportedLocales determines which locale URLs to generate —
    // never all platform locales.
    const projects = await sanityClient.fetch<TenantSitemapData[]>(
      `*[_type == "project" && status == "active"] | order(projectName asc) {
        projectSlug,
        "supportedLocales": siteConfig->supportedLocales
      }`
    )

    return projects.flatMap(({ projectSlug, supportedLocales }) => {
      const tenantSlug = PROJECT_TO_TENANT[projectSlug] ?? projectSlug
      // Fall back to English only if the tenant has no locales configured yet.
      const locales = supportedLocales && supportedLocales.length > 0 ? supportedLocales : ['en']
      const defaultLocale = locales[0]

      return locales.map((locale) => ({
        url: `${baseUrl}/${locale}/${tenantSlug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: locale === defaultLocale ? 1.0 : 0.9,
      }))
    })
  } catch {
    return []
  }
}
