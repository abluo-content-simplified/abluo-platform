import type { MetadataRoute } from 'next'
import { sanityClient } from '@/lib/sanity/client'

const locales = ['it', 'en'] as const

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  // Fetch all published tenants from Sanity
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
}
