/**
 * News item detail page — /[locale]/[tenant]/news/[slug]
 *
 * ADR-020. Satisfies Requirement 3 of the Publicly Routable Content Pattern
 * (CLAUDE.md):
 *   • primary lookup with NO locale fallback on the slug
 *   • 301 redirect via the redirectFrom table when the primary lookup misses
 *   • notFound() only after both have missed
 *   • a SlugMapProvider carrying the per-locale slug map, prefixed with
 *     `news/` so the language switcher builds /{tenant}/news/{slug} rather
 *     than /{tenant}/{slug}, which would hit the generic page route and 404
 *   • hreflang alternates built from the site's supportedLocales × slugMap,
 *     emitted only for locales where a slug actually exists
 */

import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { isProduction, isDev } from '@/lib/deployment'
import { tenantClient, fetchDesignSystemById } from '@/lib/sanity/client'
import {
  newsArticleBySlugQuery,
  newsArticleByOldSlugQuery,
  localeConfigQuery,
  designSystemQuery,
  projectDomainQuery,
  projectModuleConfigQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveCategories, charsPerMinute, DEFAULT_CHARS_PER_MINUTE } from '@/lib/modules/categories'
import type { NewsArticle, LocaleConfig, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import { imageUrl, imageSrcSet, ogImageUrl } from '@/lib/sanity/image'
import { SlideUp } from '@/components/animation'
import { SlugMapProvider, type SlugMap } from '@/components/SlugMapContext'
import { BackButton } from '@/components/events/BackButton'
import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import { getNewsModuleMessages, formatNewsDate } from '@/lib/i18n/news-module-messages'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string; slug: string }>
  searchParams?: Promise<{ from?: string }>
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: tenantId, locale, slug } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const supportedLocales: SupportedLocale[] = localeConfig?.supportedLocales ?? [defaultLocale]

  const [article, customDomain] = await Promise.all([
    fetchForTenant<NewsArticle>(newsArticleBySlugQuery, {
      slug,
      locale: locale as SupportedLocale,
      defaultLocale,
      charsPerMinute: DEFAULT_CHARS_PER_MINUTE,
    }),
    fetchForTenant<string | null>(projectDomainQuery, {}),
  ])

  const canonicalBase = customDomain ? `https://${customDomain}` : null
  const currentSlug = article?.slugMap?.[locale as SupportedLocale]?.current ?? slug

  // hreflang: only for locales that actually have a slug. Emitting an alternate
  // for a locale with no translation would advertise a URL that 404s.
  const alternates: Record<string, string> = {}
  if (canonicalBase && article?.slugMap) {
    for (const loc of supportedLocales) {
      const locSlug = article.slugMap[loc as SupportedLocale]?.current
      if (locSlug) {
        alternates[loc] = `${canonicalBase}/${loc}/${tenantId}/news/${locSlug}`
      }
    }
  }

  const ogImage = article?.coverImage?.asset
    ? ogImageUrl(article.seoImage ?? article.coverImage)
    : undefined

  return {
    title: article?.seoTitle ?? article?.title,
    description: article?.seoDescription ?? article?.excerpt,
    alternates: {
      canonical:
        isProduction() && canonicalBase
          ? `${canonicalBase}/${locale}/${tenantId}/news/${currentSlug}`
          : undefined,
      languages: !isDev() && Object.keys(alternates).length > 0 ? alternates : undefined,
    },
    openGraph: {
      title: article?.seoTitle ?? article?.title,
      description: article?.seoDescription ?? article?.excerpt ?? undefined,
      type: 'article',
      publishedTime: article?.publishedAt,
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: article?.seoTitle ?? article?.title,
      description: article?.seoDescription ?? article?.excerpt ?? undefined,
      images: ogImage ? [ogImage] : undefined,
    },
  }
}

// ─── Static params ────────────────────────────────────────────────────────────
// Rendered on demand (`dynamic = 'force-dynamic'`), matching the blog route.

export async function generateStaticParams() {
  return []
}

// ─── Back-button context ──────────────────────────────────────────────────────

/**
 * Resolves the back link from the `?from=` parameter set on listing cards.
 *
 * The label is localized, unlike the blog route's equivalent helper, which
 * builds English strings ("Back to Home") regardless of locale. For an
 * arbitrary page slug there is no authored label available at this point, so
 * the module's generic "back to news" label is used rather than title-casing
 * a URL segment into a pseudo-English phrase.
 */
function getBackContext(
  from: string | undefined,
  locale: string,
  tenantId: string
): { label: string; url: string } {
  const msg = getNewsModuleMessages(locale)
  const newsUrl = `/${locale}/${tenantId}/news`

  if (!from || from === 'news') {
    return { label: msg.backToNews, url: newsUrl }
  }
  // Came from another page (a composed News Listing section). Send the visitor
  // back where they were, with the module's generic label.
  return { label: msg.backToNews, url: `/${locale}/${tenantId}/${from}` }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NewsDetailPage({ params, searchParams }: PageProps) {
  const { tenant: tenantId, locale, slug } = await params
  const resolvedSearch = await searchParams
  const from = resolvedSearch?.from
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ADR-020 Amendment B — category labels and reading speed come from the module.
  const moduleConfig = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, {
    locale,
    defaultLocale,
  })

  const [article, designSystem] = await Promise.all([
    fetchForTenant<NewsArticle>(newsArticleBySlugQuery, {
      slug,
      locale: locale as SupportedLocale,
      defaultLocale,
      charsPerMinute: charsPerMinute(moduleConfig, 'news'),
    }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
  ])

  // Primary lookup missed — consult the redirect table before giving up, so a
  // renamed slug keeps its inbound links and search ranking.
  if (!article) {
    const redirectResult = await fetchForTenant<{ currentSlug: string }>(newsArticleByOldSlugQuery, {
      slug,
      locale: locale as SupportedLocale,
    })
    if (redirectResult?.currentSlug) {
      redirect(`/${locale}/${tenantId}/news/${redirectResult.currentSlug}`)
    }
    notFound()
  }

  // Slug map for the language switcher. The `news/` prefix is load-bearing:
  // without it the switcher builds /{tenant}/{slug} and hits the generic page
  // route, which 404s.
  const slugMap: SlugMap = {}
  if (article.slugMap) {
    for (const [loc, slugObj] of Object.entries(article.slugMap)) {
      if (slugObj?.current) {
        slugMap[loc as SupportedLocale] = `news/${slugObj.current}`
      }
    }
  }

  article.categories = resolveCategories(article.categoryKeys, moduleConfig, 'news', locale, defaultLocale)

  const msg = getNewsModuleMessages(locale)
  const { label: backLabel, url: backUrl } = getBackContext(from, locale, tenantId)

  const coverSrc = imageUrl(article.coverImage, 1600)
  const coverSrcSet = imageSrcSet(article.coverImage, [800, 1200, 1600, 2400])

  const publishedDate = article.publishedAt
    ? formatNewsDate(article.publishedAt, locale)
    : null

  // Motion tokens — durationSlow for content entrances (platform convention).
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  return (
    <SlugMapProvider slugMap={slugMap}>
      <article className="mx-auto w-full max-w-[760px] px-6 py-16 md:py-24">
        <SlideUp duration={duration} ease={ease} delay={0}>
          <BackButton label={backLabel} fallbackUrl={backUrl} />
        </SlideUp>

        {/* Header */}
        <SlideUp duration={duration} ease={ease} delay={0.05}>
          <header className="mt-8">
            {article.categories && article.categories.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {article.categories.map((cat) => (
                  <span
                    key={cat.key}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest"
                    style={{
                      background: cat.color
                        ? `color-mix(in oklch, ${cat.color} 12%, transparent)`
                        : 'color-mix(in oklch, var(--color-primary) 12%, transparent)',
                      color: cat.color ?? 'var(--color-primary)',
                    }}
                  >
                    {cat.title}
                  </span>
                ))}
              </div>
            )}

            <h1
              className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
            >
              {article.title}
            </h1>

            {(publishedDate || article.readingTimeMinutes) && (
              <div
                className="mt-4 flex items-center gap-1.5 text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {publishedDate && article.publishedAt && (
                  <time dateTime={article.publishedAt}>
                    <span className="sr-only">{msg.publishedOn} </span>
                    {publishedDate}
                  </time>
                )}
                {publishedDate && article.readingTimeMinutes && <span aria-hidden="true">·</span>}
                {article.readingTimeMinutes && (
                  <span>{msg.readingTime(article.readingTimeMinutes)}</span>
                )}
              </div>
            )}

            {article.excerpt && (
              <p
                className="mt-6 text-lg leading-relaxed"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {article.excerpt}
              </p>
            )}
          </header>
        </SlideUp>

        {/* Cover image */}
        {coverSrc && (
          <SlideUp duration={duration} ease={ease} delay={0.1}>
            <figure className="mt-10 overflow-hidden rounded-2xl">
              <img
                src={coverSrc}
                srcSet={coverSrcSet}
                sizes="(max-width: 768px) 100vw, 760px"
                alt={article.coverImage?.alt ?? article.title ?? ''}
                className="h-auto w-full object-cover"
                loading="eager"
              />
              {article.coverImage?.caption && (
                <figcaption
                  className="mt-2 text-center text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {article.coverImage.caption}
                </figcaption>
              )}
            </figure>
          </SlideUp>
        )}

        {/* Body */}
        {article.body && (
          <SlideUp duration={duration} ease={ease} delay={0.15}>
            <div className="mt-12">
              <PortableText value={article.body} components={articlePortableTextComponents} />
            </div>
          </SlideUp>
        )}
      </article>
    </SlugMapProvider>
  )
}
