import type { MetadataRoute } from 'next'

// Reverse of TENANT_TO_PROJECT in client.ts — projectSlug → URL tenant slug
const PROJECT_TO_TENANT: Record<string, string> = {
  'livener-main': 'livener',
  'studiomartegani-main': 'studiomartegani',
  'abluo': 'abluo-the-tiny-cms',
}

interface TenantSitemapData {
  projectSlug: string
  supportedLocales?: string[]
  defaultLocale?: string
}

interface PageSitemapData {
  projectSlug: string
  slug: Record<string, { current: string } | undefined>
}

interface EventSitemapData {
  projectSlug: string
  slug: Record<string, { current: string } | undefined>
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) return []

  try {
    const { sanityClient } = await import('@/lib/sanity/client')

    // Fetch active projects with their tenant-specific supportedLocales.
    const projects = await sanityClient.fetch<TenantSitemapData[]>(
      `*[_type == "project" && status == "active"] | order(projectName asc) {
        projectSlug,
        "supportedLocales": siteConfig->supportedLocales,
        "defaultLocale": siteConfig->defaultLocale
      }`
    )

    // Fetch all published pages and events with their per-locale slugs.
    const [pages, events] = await Promise.all([
      sanityClient.fetch<PageSitemapData[]>(
        `*[_type == "page" && defined(projectSlug)] { projectSlug, slug }`
      ),
      sanityClient.fetch<EventSitemapData[]>(
        `*[_type == "event" && defined(projectSlug)] { projectSlug, slug }`
      ),
    ])

    // Build projectSlug → items maps for quick lookup.
    const pagesByProject = new Map<string, PageSitemapData[]>()
    for (const page of pages) {
      const list = pagesByProject.get(page.projectSlug) ?? []
      list.push(page)
      pagesByProject.set(page.projectSlug, list)
    }

    const eventsByProject = new Map<string, EventSitemapData[]>()
    for (const event of events) {
      const list = eventsByProject.get(event.projectSlug) ?? []
      list.push(event)
      eventsByProject.set(event.projectSlug, list)
    }

    const entries: MetadataRoute.Sitemap = []

    for (const { projectSlug, supportedLocales, defaultLocale } of projects) {
      const tenantSlug = PROJECT_TO_TENANT[projectSlug] ?? projectSlug
      const locales = supportedLocales && supportedLocales.length > 0 ? supportedLocales : ['en']
      const primaryLocale = defaultLocale ?? locales[0]

      // Tenant homepage — one URL per locale
      for (const locale of locales) {
        entries.push({
          url: `${baseUrl}/${locale}/${tenantSlug}`,
          lastModified: new Date(),
          changeFrequency: 'weekly',
          priority: locale === primaryLocale ? 1.0 : 0.9,
        })
      }

      // Per-page entries — only for locales that have a slug set.
      const projectPages = pagesByProject.get(projectSlug) ?? []
      for (const page of projectPages) {
        for (const locale of locales) {
          const slugObj = page.slug?.[locale]
          if (slugObj?.current) {
            entries.push({
              url: `${baseUrl}/${locale}/${tenantSlug}/${slugObj.current}`,
              lastModified: new Date(),
              changeFrequency: 'weekly',
              priority: locale === primaryLocale ? 0.8 : 0.7,
            })
          }
        }
      }

      // Per-event entries — only for locales that have a slug set.
      const projectEvents = eventsByProject.get(projectSlug) ?? []
      for (const event of projectEvents) {
        for (const locale of locales) {
          const slugObj = event.slug?.[locale]
          if (slugObj?.current) {
            entries.push({
              url: `${baseUrl}/${locale}/${tenantSlug}/events/${slugObj.current}`,
              lastModified: new Date(),
              changeFrequency: 'weekly',
              priority: locale === primaryLocale ? 0.7 : 0.6,
            })
          }
        }
      }
    }

    return entries
  } catch {
    return []
  }
}
