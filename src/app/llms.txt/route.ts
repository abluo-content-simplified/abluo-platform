import { headers } from 'next/headers'
import { isProduction } from '@/lib/deployment'
import { isStagingHost } from '@/lib/seo/indexability'
import { canonicalUrl } from '@/lib/seo/canonical'
import { normalizeHost } from '@/lib/tenancy/host-scope'

/**
 * `/llms.txt` — a plain-text map of the site for answer engines.
 *
 * The convention (llmstxt.org) is a single markdown file at the root: the
 * site's name, one paragraph saying what it is, then a linked list of the pages
 * worth reading. An assistant that finds it gets an accurate, first-party
 * description instead of inferring one from whichever paragraph its retriever
 * happened to return.
 *
 * Built from Sanity, per host, exactly like `sitemap.ts` — this is the same
 * data the sitemap and the JSON-LD describe, in the form a language model
 * reads. It is not a ranking signal and is not read by Googlebot; it is cheap,
 * it is first-party, and it is the only artefact on the site whose audience is
 * explicitly a model.
 *
 * ── Scoping ─────────────────────────────────────────────────────────────────
 * Host-scoped, and for the reason `sitemap.ts` now is too: one deployment
 * serves every client, so an unscoped file would hand every assistant the whole
 * client list. A host no project claims gets 404, not everyone's.
 *
 * ── Staging ─────────────────────────────────────────────────────────────────
 * 404 on staging and on non-production, matching the empty sitemap. The
 * `X-Robots-Tag: noindex` from `next.config.ts` covers crawlers that respect
 * it; not publishing a map of a staging copy covers the ones that do not.
 *
 * `/llms.txt` reaches this handler with the real Host header: `src/proxy.ts`
 * bypasses any path ending `.txt` before it rewrites anything.
 */

export const dynamic = 'force-dynamic'

interface ProjectRow {
  projectSlug: string
  projectName?: string
  customDomain?: string
  defaultLocale?: string
  supportedLocales?: string[]
  siteName?: string
  tagline?: string
  description?: string
}

interface PageRow {
  title?: string
  slug?: string
  description?: string
}

const NOT_FOUND = new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
})

export async function GET(): Promise<Response> {
  if (!isProduction()) return NOT_FOUND

  const host = normalizeHost((await headers()).get('host'))
  if (!host || isStagingHost(host)) return NOT_FOUND
  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) return NOT_FOUND

  try {
    // Unscoped read, single-project output — same contract as sitemap.ts.
    const { sanityClient } = await import('@/lib/sanity/client')

    const project = await sanityClient.fetch<ProjectRow | null>(
      `*[_type == "project" && status == "active" && customDomain == $host][0] {
        projectSlug,
        projectName,
        customDomain,
        "defaultLocale": siteConfig->defaultLocale,
        "supportedLocales": siteConfig->supportedLocales,
        "siteName": siteConfig->siteName,
        "tagline": coalesce(siteConfig->tagline[$defaultLocale], siteConfig->tagline.en),
        "description": coalesce(
          siteConfig->seoDefaultDescription[$defaultLocale],
          siteConfig->seoDefaultDescription.en
        )
      }`,
      { host, defaultLocale: 'en' }
    )

    if (!project?.customDomain) return NOT_FOUND

    const locale = project.defaultLocale ?? 'en'
    const origin = `https://${project.customDomain}`

    const pages = await sanityClient.fetch<PageRow[]>(
      `*[_type == "page" && projectSlug == $projectSlug && !(noindex == true)] | order(pageType asc) {
        "title": coalesce(title[$locale], title.en),
        "slug": slug[$locale].current,
        "description": coalesce(seoDescription[$locale], seoDescription.en)
      }`,
      { projectSlug: project.projectSlug, locale }
    )

    const name = project.siteName ?? project.projectName ?? project.projectSlug
    const summary = project.description ?? project.tagline

    const lines: string[] = [`# ${name}`, '']
    if (summary) lines.push(`> ${summary}`, '')

    const otherLocales = (project.supportedLocales ?? []).filter((l) => l !== locale)
    if (otherLocales.length > 0) {
      lines.push(
        `This site is published in ${[locale, ...otherLocales].join(', ')}. ` +
          `Replace the language segment in any URL below to read another translation.`,
        ''
      )
    }

    lines.push('## Pages', '')
    for (const page of pages) {
      // The home page is the locale root; every other page hangs below it.
      const isHome = !page.slug || page.slug === 'home'
      const url = isHome ? canonicalUrl(origin, locale) : canonicalUrl(origin, locale, page.slug)
      if (!url) continue
      const label = page.title ?? name
      lines.push(page.description ? `- [${label}](${url}): ${page.description}` : `- [${label}](${url})`)
    }

    lines.push('', '## Machine-readable', '')
    lines.push(`- [Sitemap](${origin}/sitemap.xml)`)

    return new Response(lines.join('\n') + '\n', {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        // Cheap to regenerate, rarely changes, and must not go stale for long
        // after an edit in Studio.
        'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch {
    // Same failure posture as the sitemap: degrade silently rather than 500.
    return NOT_FOUND
  }
}
