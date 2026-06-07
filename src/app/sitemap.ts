import type { MetadataRoute } from 'next'

const locales = ['it', 'en'] as const

// Reverse of TENANT_TO_PROJECT in client.ts — projectSlug → URL tenant slug
const PROJECT_TO_TENANT: Record<string, string> = {
  'livener-main': 'livener',
  'studiomartegani-main': 'studiomartegani',
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) return []

  try {
    const { sanityClient } = await import('@/lib/sanity/client')
    const projects = await sanityClient.fetch<{ projectSlug: string }[]>(
      `*[_type == "project" && status == "active"] | order(projectName asc) { projectSlug }`
    )

    return projects.flatMap(({ projectSlug }) => {
      const tenantSlug = PROJECT_TO_TENANT[projectSlug] ?? projectSlug
      return locales.map((locale) => ({
        url: `${baseUrl}/${locale}/${tenantSlug}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: locale === 'it' ? 1.0 : 0.9,
      }))
    })
  } catch {
    return []
  }
}
