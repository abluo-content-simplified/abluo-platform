import type { MetadataRoute } from 'next'
import { isProduction } from '@/lib/deployment'

// Reverse of TENANT_TO_PROJECT in client.ts — projectSlug → URL tenant slug
const PROJECT_TO_TENANT: Record<string, string> = {
  'livener-main': 'livener',
  'studiomartegani-main': 'studiomartegani',
  'abluo': 'abluo-the-tiny-cms',
}

interface TenantSitemapData {
  projectSlug: string
  customDomain?: string
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

interface PostSitemapData {
  projectSlug: string
  slug: Record<string, { current: string } | undefined>
}

/** News module items (ADR-020) — same shape as posts, different route prefix. */
interface NewsArticleSitemapData {
  projectSlug: string
  slug: Record<string, { current: string } | undefined>
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Never expose a sitemap on non-production environments.
  if (!isProduction()) return []

  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) return []

  try {
    const { sanityClient } = await import('@/lib/sanity/client')

    // Fetch active projects with their tenant-specific supportedLocales.
    const projects = await sanityClient.fetch<TenantSitemapData[]>(
      `*[_type == "project" && status == "active"] | order(projectName asc) {
        projectSlug,
        customDomain,
        "supportedLocales": siteConfig->supportedLocales,
        "defaultLocale": siteConfig->defaultLocale
      }`
    )

    // Fetch all published pages, events, posts, and news with their per-locale slugs.
    const [pages, events, posts, newsArticles] = await Promise.all([
      sanityClient.fetch<PageSitemapData[]>(
        `*[_type == "page" && defined(projectSlug)] { projectSlug, slug }`
      ),
      sanityClient.fetch<EventSitemapData[]>(
        `*[_type == "event" && defined(projectSlug)] { projectSlug, slug }`
      ),
      sanityClient.fetch<PostSitemapData[]>(
        `*[_type == "post" && defined(projectSlug) && defined(publishedAt) && publishedAt <= now()] { projectSlug, slug }`
      ),
      // News items (ADR-020). Expired items are excluded as well as unpublished
      // ones: a news item past its expiry is removed from the website, so
      // advertising it in the sitemap would point search engines at a 404.
      sanityClient.fetch<NewsArticleSitemapData[]>(
        `*[
          _type == "newsArticle"
          && defined(projectSlug)
          && defined(publishedAt)
          && publishedAt <= now()
          && (!defined(expiresAt) || expiresAt > now())
        ] { projectSlug, slug }`
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

    const postsByProject = new Map<string, PostSitemapData[]>()
    for (const post of posts) {
      const list = postsByProject.get(post.projectSlug) ?? []
      list.push(post)
      postsByProject.set(post.projectSlug, list)
    }

    const newsByProject = new Map<string, NewsArticleSitemapData[]>()
    for (const item of newsArticles) {
      const list = newsByProject.get(item.projectSlug) ?? []
      list.push(item)
      newsByProject.set(item.projectSlug, list)
    }

    const entries: MetadataRoute.Sitemap = []

    for (const { projectSlug, customDomain, supportedLocales, defaultLocale } of projects) {
      // Skip tenants without a custom domain — no canonical URL to emit.
      if (!customDomain) continue

      const tenantSlug = PROJECT_TO_TENANT[projectSlug] ?? projectSlug
      const locales = supportedLocales && supportedLocales.length > 0 ? supportedLocales : ['en']
      const primaryLocale = defaultLocale ?? locales[0]
      const tenantBase = `https://${customDomain}`

      // Tenant homepage — one URL per locale
      for (const locale of locales) {
        entries.push({
          url: `${tenantBase}/${locale}/${tenantSlug}`,
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
              url: `${tenantBase}/${locale}/${tenantSlug}/${slugObj.current}`,
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
              url: `${tenantBase}/${locale}/${tenantSlug}/events/${slugObj.current}`,
              lastModified: new Date(),
              changeFrequency: 'weekly',
              priority: locale === primaryLocale ? 0.7 : 0.6,
            })
          }
        }
      }

      // Per-post entries — only for locales that have a slug set.
      const projectPosts = postsByProject.get(projectSlug) ?? []
      for (const post of projectPosts) {
        for (const locale of locales) {
          const slugObj = post.slug?.[locale]
          if (slugObj?.current) {
            entries.push({
              url: `${tenantBase}/${locale}/${tenantSlug}/blog/${slugObj.current}`,
              lastModified: new Date(),
              changeFrequency: 'monthly',
              priority: locale === primaryLocale ? 0.6 : 0.5,
            })
          }
        }
      }

      // Per-news entries (ADR-020) — only for locales that have a slug set.
      // Requirement 4 of the Publicly Routable Content Pattern.
      const projectNews = newsByProject.get(projectSlug) ?? []
      for (const item of projectNews) {
        for (const locale of locales) {
          const slugObj = item.slug?.[locale]
          if (slugObj?.current) {
            entries.push({
              url: `${tenantBase}/${locale}/${tenantSlug}/news/${slugObj.current}`,
              lastModified: new Date(),
              changeFrequency: 'monthly',
              priority: locale === primaryLocale ? 0.6 : 0.5,
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
