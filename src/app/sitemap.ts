import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { isProduction } from '@/lib/deployment'
import { isStagingHost } from '@/lib/seo/indexability'

// ─── projectSlug → URL tenant slug ───────────────────────────────────────────
// There is no longer a map here. This was `PROJECT_TO_TENANT`, the reverse of
// `TENANT_TO_PROJECT` in client.ts, and it carried exactly two rows —
// `livener-main` → `livener` and `studiomartegani-main` → `studiomartegani`.
// `src/lib/tenancy/RENAME.md` Step 4 renamed those documents, so neither key
// could ever match again: every lookup already fell through to the `?? projectSlug`
// default, and both rows were dead code producing the same string this line does.
// (`abluo` had needed a row too, until Step 1 renamed its URL segment.)
//
// It ASSUMES the URL segment equals `projects.slug`. Step 6 made that an
// enforced fact rather than an assumption: `src/proxy.ts` now derives the
// segment from `projects.slug` via the generated route table
// (`src/lib/tenancy/generated/route-config.ts`), so there is no longer a
// hand-maintained map that could make the two disagree.
//
// This file deliberately does NOT read that table. Its rows come from Sanity
// (`projectSlug` + `customDomain`), and the sitemap should describe what is
// actually PUBLISHED, not what is configured: a project row in Supabase with
// no content should not produce sitemap URLs. The two sources agreeing is the
// point of RENAME.md, not something this file should paper over.

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
  // Never expose a sitemap on non-production environments. This alone already
  // empties the sitemap on dev.abluo.app and preview.abluo.app today, because
  // both run in Vercel's `preview` environment.
  if (!isProduction()) return []

  // Belt and braces on the HOST as well as the environment. The env check above
  // is a property of the DEPLOYMENT; this one is a property of the REQUEST, and
  // it is what keeps the sitemap empty if a staging alias is ever pointed at a
  // production-environment deployment (a Vercel alias change, not a code
  // change, so nothing else here would catch it). Production client hosts are
  // unaffected: `isStagingHost` fails open, so an unknown or new custom domain
  // still gets the full sitemap.
  //
  // Note the entries below are always absolute `https://<customDomain>/…` URLs
  // built from Supabase, never from the request host, so this never removed a
  // staging URL — there were none to remove.
  //
  // This guard matters MORE than it looks, because staging robots.txt is now
  // deliberately PERMISSIVE (see the staging branch of `buildRobotsForHost` —
  // a crawl must be allowed for the X-Robots-Tag: noindex header to be seen).
  // A crawler is therefore expected on dev.abluo.app, and it must find an
  // empty /sitemap.xml there: permitting the crawl is not advertising the
  // content. robots.txt correspondingly emits no `Sitemap:` line on staging.
  if (isStagingHost((await headers()).get('host'))) return []

  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) return []

  try {
    // ── DELIBERATELY CROSS-PROJECT — not an oversight, do not "fix" this ─────
    // This is the single root sitemap for the whole multi-tenant deployment,
    // so it must enumerate EVERY active project; there is no tenant in scope
    // to hand `tenantClient()`. Using the raw client here is correct, and the
    // scoping guard does not apply.
    //
    // Two things keep it safe:
    //   1. It only ever emits URLs that are already public — published pages,
    //      events, posts and non-expired news, each under the tenant's own
    //      `customDomain`. Tenants without a custom domain are skipped, so no
    //      tenant's content is advertised on another tenant's host.
    //   2. It is production-only (`isProduction()` above).
    //
    // The `await import()` is a genuine dynamic import, kept so the Sanity
    // client is never constructed on non-production builds that return early.
    // Note that `no-restricted-imports` CANNOT see a dynamic import, so this
    // call site produces no lint warning — this comment is the only signal a
    // reviewer gets. If you make the raw client a hard error, remember this
    // file needs an explicit exemption in `eslint.config.mjs`.
    //
    // When the dataset goes private this read starts depending on
    // `SANITY_API_READ_TOKEN` being present in the Production environment.
    // The `catch` below swallows the failure and returns an EMPTY sitemap
    // rather than erroring — silent SEO degradation, not an outage. See
    // `docs/engineering/sanity-private-dataset.md`.
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

      const tenantSlug = projectSlug
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
