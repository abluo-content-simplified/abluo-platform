import { headers } from 'next/headers'
import { isProduction } from '@/lib/deployment'
import { isStagingHost } from '@/lib/seo/indexability'
import { canonicalUrl } from '@/lib/seo/canonical'
import { normalizeHost } from '@/lib/tenancy/host-scope'
import { LLMS_NEWS_QUERY, LLMS_POSTS_QUERY, entryLinesFor, type EntryRow } from '@/lib/seo/llms'

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
  pageType?: string
  /** Full per-locale maps — resolved in JS so one read serves every language. */
  titles?: Record<string, string | undefined>
  slugs?: Record<string, { current?: string } | undefined>
  descriptions?: Record<string, string | undefined>
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
        // Every siteConfig field is read through a coalesce with a lookup by
        // projectSlug, because NO project document sets its \`siteConfig\`
        // reference — the dereference silently yields null for all of them.
        // sitemap.ts carries the same fallback for the same reason; without it
        // this file lost the site name, the summary AND every language but the
        // default, which is most of what it exists to publish.
        "defaultLocale": coalesce(
          siteConfig->defaultLocale,
          *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].defaultLocale
        ),
        "supportedLocales": coalesce(
          siteConfig->supportedLocales,
          *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].supportedLocales
        ),
        "siteName": coalesce(
          siteConfig->siteName,
          *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].siteName
        ),
        "tagline": coalesce(
          siteConfig->tagline[$defaultLocale],
          siteConfig->tagline.en,
          *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].tagline[$defaultLocale],
          *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].tagline.en
        ),
        "description": coalesce(
          siteConfig->seoDefaultDescription[$defaultLocale],
          siteConfig->seoDefaultDescription.en,
          *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].seoDefaultDescription[$defaultLocale],
          *[_type == "siteConfig" && projectSlug == ^.projectSlug][0].seoDefaultDescription.en
        )
      }`,
      { host, defaultLocale: 'en' }
    )

    if (!project?.customDomain) return NOT_FOUND

    const locale = project.defaultLocale ?? 'en'
    const origin = `https://${project.customDomain}`

    // The whole localized objects, not one language's projection: this file
    // lists every language the site publishes, and a second read per locale
    // would be six more round trips for data already in these documents.
    const [pages, news, posts] = await Promise.all([
      sanityClient.fetch<PageRow[]>(
        `*[_type == "page" && projectSlug == $projectSlug && !(noindex == true)] | order(pageType asc) {
          pageType,
          "titles": title,
          "slugs": slug,
          "descriptions": seoDescription
        }`,
        { projectSlug: project.projectSlug }
      ),
      sanityClient.fetch<EntryRow[]>(LLMS_NEWS_QUERY, { projectSlug: project.projectSlug }),
      sanityClient.fetch<EntryRow[]>(LLMS_POSTS_QUERY, { projectSlug: project.projectSlug }),
    ])

    const name = project.siteName ?? project.projectName ?? project.projectSlug
    const summary = project.description ?? project.tagline

    const lines: string[] = [`# ${name}`, '']
    if (summary) lines.push(`> ${summary}`, '')

    // Every language the site actually publishes, default first. Listing only
    // the default locale and telling the model to "replace the language
    // segment" asked it to guess six localized slugs — `/it/privacy-policy` is
    // not `/fr/politique-de-confidentialite`. Each language gets its own
    // section with its own titles, descriptions and real URLs.
    const supported = project.supportedLocales ?? []
    const otherLocales = supported.filter((l) => l !== locale)
    if (otherLocales.length > 0) {
      lines.push(`This site is published in ${[locale, ...otherLocales].join(', ')}.`, '')
    }

    /** One `## …` block of page links for a single language. */
    const sectionFor = (loc: string): string[] => {
      const out: string[] = []
      for (const page of pages) {
        const isHome = page.pageType === 'home'
        const slug = page.slugs?.[loc]?.current
        // A page with no slug in this language does not exist in it.
        if (!isHome && !slug) continue
        const url = isHome ? canonicalUrl(origin, loc) : canonicalUrl(origin, loc, slug)
        if (!url) continue
        const label = page.titles?.[loc] ?? page.titles?.en ?? name
        const description = page.descriptions?.[loc] ?? (loc === locale ? page.descriptions?.en : undefined)
        out.push(description ? `- [${label}](${url}): ${description}` : `- [${label}](${url})`)
      }
      return out
    }

    const primary = sectionFor(locale)
    if (primary.length > 0) lines.push('## Pages', '', ...primary)

    for (const loc of otherLocales) {
      const block = sectionFor(loc)
      if (block.length === 0) continue
      lines.push('', `## Pages (${loc})`, '', ...block)
    }

    // News and blog — one block per language, exactly like pages: the default
    // language under a bare heading, every other language suffixed with its
    // code, and a language with no entries omitted.
    for (const [heading, entries, routePrefix] of [
      ['News', news ?? [], 'news'],
      ['Blog', posts ?? [], 'blog'],
    ] as const) {
      for (const loc of [locale, ...otherLocales]) {
        const block = entryLinesFor(entries, origin, loc, routePrefix)
        if (block.length === 0) continue
        if (lines[lines.length - 1] !== '') lines.push('')
        lines.push(loc === locale ? `## ${heading}` : `## ${heading} (${loc})`, '', ...block)
      }
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
