import type { NewsListingSection as NewsListingSectionType, NewsArticle, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { imageUrl } from '@/lib/sanity/image'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'
import { SectionEmptyState } from '@/components/sections/shared/SectionEmptyState'
import { getNewsModuleMessages, formatNewsDate } from '@/lib/i18n/news-module-messages'

// ─── News Listing Section (ADR-020) ───────────────────────────────────────────
//
// Owned by the News module. Mirrors BlogListingSection's three layouts (grid /
// featured / magazine) and its empty-state semantics, so a website using both
// modules looks coherent.
//
// Two deliberate differences from BlogListingSection:
//   • No author/avatar in the card meta — a news item has no byline.
//   • Dates and the reading-time suffix are localized. BlogListingSection
//     formats dates with a hardcoded 'en' and hardcodes "min read", which
//     renders Italian and German sites with English strings; that is not
//     reproduced here (CLAUDE.md: no hardcoded user-facing strings).
//
// All motion comes from designSystem.motion; the choreography (stagger delays)
// is the component's own, per the platform's animation rule.

// ─── Category chips ───────────────────────────────────────────────────────────

function CategoryChips({ categories }: { categories?: NewsArticle['categories'] }) {
  if (!categories?.length) return null
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {categories.map((cat) => (
        <span
          key={cat._id}
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
  )
}

// ─── Article meta (date + reading time) ───────────────────────────────────────

function ArticleMeta({
  article,
  locale,
  size = 'sm',
}: {
  article: NewsArticle
  locale: string
  size?: 'sm' | 'base'
}) {
  const msg = getNewsModuleMessages(locale)
  const textSize = size === 'base' ? 'text-sm' : 'text-xs'

  return (
    <div
      className={`flex items-center gap-1.5 ${textSize}`}
      style={{ color: 'var(--color-text-muted)' }}
    >
      {article.publishedAt && (
        <time dateTime={article.publishedAt}>{formatNewsDate(article.publishedAt, locale)}</time>
      )}
      {article.publishedAt && article.readingTimeMinutes && <span aria-hidden="true">·</span>}
      {article.readingTimeMinutes && <span>{msg.readingTime(article.readingTimeMinutes)}</span>}
    </div>
  )
}

// ─── Card link helper ─────────────────────────────────────────────────────────

function articleHref(base: string, article: NewsArticle, fromParam?: string): string {
  const href = `${base}/${article.slug.current}`
  return fromParam ? `${href}?from=${encodeURIComponent(fromParam)}` : href
}

// ─── Card — Standard (Grid layout) ────────────────────────────────────────────

function ArticleCard({
  article,
  href,
  locale,
  priority = false,
}: {
  article: NewsArticle
  href: string
  locale: string
  priority?: boolean
}) {
  const coverSrc = imageUrl(article.coverImage, 800)

  return (
    <a
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-lg"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid',
        borderColor: 'var(--color-border)',
        textDecoration: 'none',
      }}
    >
      <div className="shrink-0 overflow-hidden" style={{ height: '200px' }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={article.coverImage?.alt ?? article.title ?? ''}
            className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
            loading={priority ? 'eager' : 'lazy'}
          />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: 'var(--color-border)' }} />
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <CategoryChips categories={article.categories} />
        <h3
          className="mb-2 line-clamp-2 text-base font-semibold leading-snug tracking-tight"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {article.title}
        </h3>
        {article.excerpt && (
          <p
            className="mb-4 line-clamp-3 flex-1 text-sm leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {article.excerpt}
          </p>
        )}
        <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <ArticleMeta article={article} locale={locale} />
        </div>
      </div>
    </a>
  )
}

// ─── Card — Large (Featured layout + Magazine main card) ──────────────────────

function ArticleCardLarge({
  article,
  href,
  locale,
}: {
  article: NewsArticle
  href: string
  locale: string
}) {
  const coverSrc = imageUrl(article.coverImage, 1200)

  return (
    <a
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-lg"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid',
        borderColor: 'var(--color-border)',
        textDecoration: 'none',
      }}
    >
      {/* 16:9 via padding-top — reliable inside flex containers */}
      <div className="relative shrink-0 overflow-hidden" style={{ paddingTop: '56.25%' }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={article.coverImage?.alt ?? article.title ?? ''}
            className={`absolute inset-0 h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
            loading="eager"
          />
        ) : (
          <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-border)' }} />
        )}
      </div>

      <div className="flex flex-1 flex-col p-6 md:p-8">
        <CategoryChips categories={article.categories} />
        <h3
          className="mb-3 line-clamp-3 text-2xl font-semibold leading-snug tracking-tight md:text-3xl"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {article.title}
        </h3>
        {article.excerpt && (
          <p
            className="mb-6 line-clamp-3 flex-1 text-base leading-relaxed"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {article.excerpt}
          </p>
        )}
        <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <ArticleMeta article={article} locale={locale} size="base" />
        </div>
      </div>
    </a>
  )
}

// ─── Card — Mini (Magazine right column) ──────────────────────────────────────

function ArticleCardMini({
  article,
  href,
  locale,
}: {
  article: NewsArticle
  href: string
  locale: string
}) {
  const coverSrc = imageUrl(article.coverImage, 240)

  return (
    <a
      href={href}
      className="group flex gap-4 rounded-xl p-3 transition-colors"
      style={{ textDecoration: 'none' }}
    >
      <div
        className="h-20 w-24 shrink-0 overflow-hidden rounded-lg"
        style={{ backgroundColor: 'var(--color-border)' }}
      >
        {coverSrc && (
          <img
            src={coverSrc}
            alt={article.coverImage?.alt ?? article.title ?? ''}
            className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
            loading="lazy"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h4
          className="mb-1 line-clamp-2 text-sm font-semibold leading-snug"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {article.title}
        </h4>
        <ArticleMeta article={article} locale={locale} />
      </div>
    </a>
  )
}

// ─── Layouts ──────────────────────────────────────────────────────────────────

interface LayoutProps {
  articles: NewsArticle[]
  base: string
  locale: string
  fromParam?: string
  duration: number
  ease: string | number[]
}

function GridLayout({ articles, base, locale, fromParam, duration, ease }: LayoutProps) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {articles.map((article, i) => (
        <SlideUp key={article._id} duration={duration} ease={ease} delay={0.05 * i}>
          <ArticleCard
            article={article}
            href={articleHref(base, article, fromParam)}
            locale={locale}
            priority={i === 0}
          />
        </SlideUp>
      ))}
    </div>
  )
}

function FeaturedLayout({ articles, base, locale, fromParam, duration, ease }: LayoutProps) {
  const [lead, ...rest] = articles
  if (!lead) return null

  return (
    <div className="flex flex-col gap-6">
      <SlideUp duration={duration} ease={ease} delay={0}>
        <ArticleCardLarge
          article={lead}
          href={articleHref(base, lead, fromParam)}
          locale={locale}
        />
      </SlideUp>
      {rest.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((article, i) => (
            <SlideUp key={article._id} duration={duration} ease={ease} delay={0.05 * (i + 1)}>
              <ArticleCard
                article={article}
                href={articleHref(base, article, fromParam)}
                locale={locale}
              />
            </SlideUp>
          ))}
        </div>
      )}
    </div>
  )
}

function MagazineLayout({ articles, base, locale, fromParam, duration, ease }: LayoutProps) {
  const [lead, ...rest] = articles
  if (!lead) return null

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <SlideUp duration={duration} ease={ease} delay={0}>
        <ArticleCardLarge
          article={lead}
          href={articleHref(base, lead, fromParam)}
          locale={locale}
        />
      </SlideUp>
      {rest.length > 0 && (
        <div className="flex flex-col gap-2">
          {rest.map((article, i) => (
            <SlideUp key={article._id} duration={duration} ease={ease} delay={0.05 * (i + 1)}>
              <ArticleCardMini
                article={article}
                href={articleHref(base, article, fromParam)}
                locale={locale}
              />
            </SlideUp>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  section: NewsListingSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
  tenantId: string
  /**
   * When set, appended as ?from=${fromParam} to every card link so the news
   * detail page can render an accurate back label.
   */
  fromParam?: string
}

export function NewsListingSection({
  section,
  surface,
  designSystem,
  locale,
  tenantId,
  fromParam,
}: Props) {
  const {
    eyebrow,
    title,
    subtitle,
    layout = 'grid',
    viewAllLabel,
    viewAllHref,
    emptyStateHeading,
    emptyStateBody,
  } = section

  const articles = section.articles ?? []
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const msg = getNewsModuleMessages(locale)

  // Detail-route base: /[locale]/[tenant]/news
  const newsBase = `/${locale}/${tenantId}/news`

  // Motion tokens — durationSlow for content sections (platform convention).
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // Empty-state semantics, identical to the other listing sections: no items
  // and no authored heading → render nothing at all, so an empty section never
  // leaves a blank band on the page. An authored heading opts into the block.
  if (articles.length === 0) {
    if (!emptyStateHeading) return null
    return (
      <SectionContainer style={surfaceStyles}>
        <SectionEmptyState
          heading={emptyStateHeading}
          body={emptyStateBody}
          duration={duration}
          ease={ease}
        />
      </SectionContainer>
    )
  }

  const layoutProps: LayoutProps = {
    articles,
    base: newsBase,
    locale,
    fromParam,
    duration,
    ease,
  }

  return (
    <SectionContainer style={surfaceStyles}>
      {(eyebrow || title || subtitle) && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-12">
          {eyebrow && (
            <p
              className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {eyebrow}
            </p>
          )}
          {title && (
            <h2
              className="text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
            >
              {title}
            </h2>
          )}
          {subtitle && (
            <p
              className="mt-3 max-w-2xl text-base leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {subtitle}
            </p>
          )}
        </SlideUp>
      )}

      <section aria-label={title || msg.newsListLabel}>
        {layout === 'featured' ? (
          <FeaturedLayout {...layoutProps} />
        ) : layout === 'magazine' ? (
          <MagazineLayout {...layoutProps} />
        ) : (
          <GridLayout {...layoutProps} />
        )}
      </section>

      {viewAllLabel && viewAllHref && (
        <SlideUp duration={duration} ease={ease} delay={0.25} className="mt-12 flex justify-center">
          <a
            href={viewAllHref}
            className="inline-flex items-center gap-2 rounded-lg border px-7 py-3 text-sm font-medium transition-opacity hover:opacity-75"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          >
            {viewAllLabel}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ opacity: 0.5 }}>
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </SlideUp>
      )}
    </SectionContainer>
  )
}
