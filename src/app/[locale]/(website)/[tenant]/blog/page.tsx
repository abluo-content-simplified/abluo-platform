/**
 * News & Announcements listing page — /[locale]/[tenant]/blog
 *
 * Fetches all published posts for the tenant and renders:
 *   1. Hero section (eyebrow + title + subtitle)
 *   2. Article count
 *   3. Featured article card (most recent / top-featured)
 *   4. Remaining articles in a responsive grid
 *   5. Empty state when no posts are published
 *
 * Architecture notes:
 * - Posts are fetched via postsQuery with limit=1000 / offset=0.
 *   The query already accepts $offset/$limit, so pagination can be
 *   enabled later by swapping those values without any schema changes.
 * - Category filters, search, and sorting are intentionally omitted
 *   from V1. The data model keeps categories intact so they can be
 *   exposed as filters once content volume justifies it.
 * - The page uses no SlugMapProvider because the URL /blog is the same
 *   in every locale — the LanguageSwitcher's fallback path-preservation
 *   branch handles locale switching correctly.
 */

import type { Metadata } from 'next'
import { tenantClient } from '@/lib/sanity/client'
import {
  postsQuery,
  localeConfigQuery,
  websiteSiteConfigQuery,
  designSystemQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Post, LocaleConfig, SupportedLocale, DesignSystem, WebsiteSiteConfig } from '@/lib/sanity/types'
import { imageUrl } from '@/lib/sanity/image'
import { SlideUp, FadeIn } from '@/components/animation'
import { PostCard } from '@/components/blog/PostCard'
import { getNewsPageMessages } from '@/lib/i18n/news-page-messages'
import { isProduction, isDev } from '@/lib/deployment'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string }>
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const supportedLocales = localeConfig?.supportedLocales ?? [defaultLocale]

  const config = await fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale })
  const msg = getNewsPageMessages(locale)

  const canonicalBase = config?.customDomain ? `https://${config.customDomain}` : null
  const canonical = canonicalBase ? `${canonicalBase}/${locale}/${tenantId}/blog` : undefined

  // hreflang: /blog is locale-invariant in path.
  const languages: Record<string, string> = {}
  if (canonicalBase) {
    for (const loc of supportedLocales) {
      languages[loc] = `${canonicalBase}/${loc}/${tenantId}/blog`
    }
  }

  const pageTitle = config?.siteName
    ? `${msg.title} — ${config.siteName}`
    : msg.title

  return {
    title: pageTitle,
    description: msg.subtitle,
    alternates: {
      canonical: isProduction() ? canonical : undefined,
      languages: !isDev() && Object.keys(languages).length > 0 ? languages : undefined,
    },
    openGraph: {
      title: pageTitle,
      description: msg.subtitle,
      url: canonical,
      siteName: config?.siteName ?? tenantId,
      type: 'website',
    },
  }
}

// ─── Featured post card ───────────────────────────────────────────────────────
// Editorial-style card for the most recent post.
// Intentionally larger and more prominent than the grid cards.

function FeaturedPostCard({
  post,
  href,
  readArticleLabel,
  duration,
  ease,
}: {
  post: Post
  href: string
  readArticleLabel: string
  duration: number
  ease: string | number[]
}) {
  const coverSrc = imageUrl(post.coverImage, 1600)

  const publishedDate = post.publishedAt
    ? new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(post.publishedAt))
    : null

  return (
    <SlideUp duration={duration} ease={ease} delay={0.15}>
      <a
        href={href}
        className="group block overflow-hidden rounded-2xl transition-shadow hover:shadow-xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid',
          borderColor: 'var(--color-border)',
          textDecoration: 'none',
        }}
      >
        {/* Cover image — 16/9, full width */}
        {coverSrc && (
          <div className="overflow-hidden" style={{ aspectRatio: '16/9', maxHeight: '480px' }}>
            <img
              src={coverSrc}
              alt={post.coverImage?.alt ?? post.title ?? ''}
              className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]"
              loading="eager"
            />
          </div>
        )}

        {/* Content */}
        <div className="p-7 md:p-10">
          {/* Categories */}
          {post.categories && post.categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {post.categories.map((cat) => (
                <span
                  key={cat._id}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-widest"
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

          {/* Title */}
          <h2
            className="text-[clamp(22px,4vw,36px)] font-bold leading-[1.15] tracking-tight mb-4"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
          >
            {post.title}
          </h2>

          {/* Excerpt */}
          {post.excerpt && (
            <p
              className="text-base leading-relaxed mb-6 max-w-3xl line-clamp-3"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {post.excerpt}
            </p>
          )}

          {/* Footer row */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Author + date + read time */}
            <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {post.author?.avatar && (
                <img
                  src={imageUrl(post.author.avatar, 40) ?? undefined}
                  alt={post.author.name ?? ''}
                  className="w-8 h-8 rounded-full object-cover shrink-0"
                />
              )}
              <div>
                {post.author?.name && (
                  <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {post.author.name}
                  </span>
                )}
                {(publishedDate || post.readingTimeMinutes) && (
                  <span>
                    {post.author?.name && ' · '}
                    {publishedDate}
                    {post.readingTimeMinutes && ` · ${post.readingTimeMinutes} min`}
                  </span>
                )}
              </div>
            </div>

            {/* Read CTA */}
            <span
              className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity group-hover:opacity-75"
              style={{ color: 'var(--color-primary)' }}
            >
              {readArticleLabel}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </a>
    </SlideUp>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NewsListingPage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // Fetch all posts + design system in parallel.
  // limit=1000 / offset=0 effectively fetches all posts in V1.
  // When pagination is needed, pass limit/offset from searchParams.
  const [allPosts, designSystem] = await Promise.all([
    fetchForTenant<Post[]>(postsQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
      offset: 0,
      limit: 1000,
    }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
  ])

  const posts = allPosts ?? []
  const msg = getNewsPageMessages(locale)

  // Motion tokens
  const m = designSystem?.motion
  const durationSlower = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.6
  const durationSlow   = m?.durationSlow   !== undefined ? m.durationSlow   / 1000 : 0.35
  const easeReveal: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // Split posts: first becomes the featured card, rest go into the grid.
  const [featuredPost, ...gridPosts] = posts

  const blogBase = `/${locale}/${tenantId}/blog`

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
      <div className="mx-auto max-w-[900px] px-5 pb-24 pt-12 md:px-10">

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <SlideUp duration={durationSlower} ease={easeReveal}>
          <p
            className="mb-4 text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {msg.eyebrow}
          </p>
          <h1
            className="text-[clamp(40px,7vw,64px)] font-bold leading-[1.05] tracking-tight"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
          >
            {msg.title}
          </h1>
        </SlideUp>

        <SlideUp delay={0.1} duration={durationSlow} ease={easeReveal}>
          <p
            className="mt-4 max-w-xl text-base leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {msg.subtitle}
          </p>
        </SlideUp>

        {/* ── Article count ─────────────────────────────────────────── */}
        {posts.length > 0 && (
          <SlideUp delay={0.15} duration={durationSlow} ease={easeReveal}>
            <p
              className="mt-8 text-sm font-medium"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {msg.countLabel(posts.length)}
            </p>
          </SlideUp>
        )}

        {/* ── Empty state ───────────────────────────────────────────── */}
        {posts.length === 0 && (
          <FadeIn delay={0.2} duration={durationSlow} ease={easeReveal}>
            <div
              className="mt-16 rounded-2xl px-8 py-14 text-center"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <p
                className="text-lg font-semibold mb-2"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {msg.emptyHeading}
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {msg.emptyBody}
              </p>
            </div>
          </FadeIn>
        )}

        {/* ── Featured article ──────────────────────────────────────── */}
        {featuredPost && (
          <div className="mt-10">
            <FeaturedPostCard
              post={featuredPost}
              href={`${blogBase}/${featuredPost.slug.current}?from=blog`}
              readArticleLabel={msg.readArticle}
              duration={durationSlow}
              ease={easeReveal}
            />
          </div>
        )}

        {/* ── Remaining articles grid ───────────────────────────────── */}
        {gridPosts.length > 0 && (
          <div className="mt-16">
            {/* Section label */}
            <SlideUp delay={0.1} duration={durationSlow} ease={easeReveal}>
              <p
                className="mb-8 text-xs font-semibold uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {msg.latestArticles}
              </p>
            </SlideUp>

            {/* Grid — 3-col desktop, 2-col tablet, 1-col mobile */}
            <div
              className={`grid gap-6 ${
                gridPosts.length === 1
                  ? 'grid-cols-1 max-w-sm'
                  : gridPosts.length === 2
                  ? 'grid-cols-1 sm:grid-cols-2'
                  : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              }`}
            >
              {gridPosts.map((post, i) => (
                <PostCard
                  key={post._id}
                  post={post}
                  href={`${blogBase}/${post.slug.current}?from=blog`}
                  delay={i * 0.07}
                  duration={durationSlow}
                  ease={easeReveal}
                />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
