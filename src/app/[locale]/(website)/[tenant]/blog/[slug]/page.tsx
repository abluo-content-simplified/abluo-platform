import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { isProduction, isDev } from '@/lib/deployment'
import { tenantClient } from '@/lib/sanity/client'
import {
  postBySlugQuery,
  postByOldSlugQuery,
  relatedPostsQuery,
  localeConfigQuery,
  designSystemQuery,
  projectDomainQuery,
  projectModuleConfigQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveCategories, charsPerMinute, DEFAULT_CHARS_PER_MINUTE } from '@/lib/modules/categories'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { resolveEmbedUrl } from '@/lib/embed'
import type { Post, LocaleConfig, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import { imageUrl, imageSrcSet, ogImageUrl } from '@/lib/sanity/image'
import { SlideUp } from '@/components/animation'
import { SlugMapProvider, type SlugMap } from '@/components/SlugMapContext'
import { BackButton } from '@/components/events/BackButton'
import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import { PostCard } from '@/components/blog/PostCard'

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

  const [post, customDomain] = await Promise.all([
    fetchForTenant<Post>(postBySlugQuery, { slug, locale: locale as SupportedLocale, defaultLocale, charsPerMinute: DEFAULT_CHARS_PER_MINUTE }),
    fetchForTenant<string | null>(projectDomainQuery, {}),
  ])

  const canonicalBase = customDomain ? `https://${customDomain}` : null
  const currentSlug = post?.slugMap?.[locale as SupportedLocale]?.current ?? slug

  const alternates: Record<string, string> = {}
  if (canonicalBase && post?.slugMap) {
    for (const loc of supportedLocales) {
      const locSlug = post.slugMap[loc as SupportedLocale]?.current
      if (locSlug) {
        alternates[loc] = `${canonicalBase}/${loc}/${tenantId}/blog/${locSlug}`
      }
    }
  }

  return {
    title: post?.seoTitle ?? post?.title ?? 'Article',
    description: post?.seoDescription ?? post?.excerpt ?? 'Article',
    alternates: {
      canonical: isProduction() && canonicalBase
        ? `${canonicalBase}/${locale}/${tenantId}/blog/${currentSlug}`
        : undefined,
      languages: !isDev() && Object.keys(alternates).length > 0 ? alternates : undefined,
    },
    openGraph: {
      title: post?.seoTitle ?? post?.title,
      description: post?.seoDescription ?? post?.excerpt ?? undefined,
      images: post?.coverImage?.asset
        ? (() => {
            const url = ogImageUrl(post.seoImage ?? post.coverImage)
            return url ? [{ url, width: 1200, height: 630 }] : undefined
          })()
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: post?.seoTitle ?? post?.title,
      description: post?.seoDescription ?? post?.excerpt ?? undefined,
      images: post?.coverImage?.asset ? [ogImageUrl(post.seoImage ?? post.coverImage)].filter(Boolean) as string[] : undefined,
    },
  }
}

// ─── Static Params ────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  return []
}
// ─── PortableText components ──────────────────────────────────────────────────
// Shared with the News module detail route — see
// src/components/portable-text/article-components.tsx for why this moved out.


// ─── Page ─────────────────────────────────────────────────────────────────────

// ─── Back-button context helper ──────────────────────────────────────────────

function getBackContext(from: string | undefined, locale: string, tenantId: string) {
  if (!from || from === 'home') {
    return { label: 'Back to Home', url: `/${locale}/${tenantId}` }
  }
  if (from === 'blog') {
    return { label: 'Back to Blog', url: `/${locale}/${tenantId}/blog` }
  }
  // Any other value is treated as a page slug: "investors" → "Back to Investors"
  const label = from
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return { label: `Back to ${label}`, url: `/${locale}/${tenantId}/${from}` }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BlogDetailPage({ params, searchParams }: PageProps) {
  const { tenant: tenantId, locale, slug } = await params
  const resolvedSearch = await searchParams
  const from = resolvedSearch?.from
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ADR-020 Amendment B — needed to resolve category keys into labels and to
  // apply the website's configured reading speed.
  const moduleConfig = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, {
    locale,
    defaultLocale,
  })
  const cpm = charsPerMinute(moduleConfig, 'blog')

  const [post, designSystem] = await Promise.all([
    fetchForTenant<Post>(postBySlugQuery, {
      slug,
      locale: locale as SupportedLocale,
      defaultLocale,
      charsPerMinute: cpm,
    }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
  ])

  // Primary lookup missed — check redirect table.
  if (!post) {
    const redirectResult = await fetchForTenant<{ currentSlug: string }>(
      postByOldSlugQuery,
      { slug, locale: locale as SupportedLocale }
    )
    if (redirectResult?.currentSlug) {
      redirect(`/${locale}/${tenantId}/blog/${redirectResult.currentSlug}`)
    }
    notFound()
  }

  // Related posts — prioritise shared categories, exclude current post.
  const categoryKeys = post.categoryKeys ?? []
  const relatedPosts = (await fetchForTenant<Post[]>(relatedPostsQuery, {
    locale: locale as SupportedLocale,
    defaultLocale,
    excludeId: post._id,
    categoryKeys,
    charsPerMinute: cpm,
  })).map((related) => ({
    ...related,
    categories: resolveCategories(related.categoryKeys, moduleConfig, 'blog', locale, defaultLocale),
  }))

  // Resolve this post's own categories for the header badges.
  post.categories = resolveCategories(post.categoryKeys, moduleConfig, 'blog', locale, defaultLocale)

  // Build slug map for the language switcher.
  // IMPORTANT: prefix with 'blog/' so LanguageSwitcher generates
  // /${tenantId}/blog/${slug} rather than /${tenantId}/${slug},
  // which would hit the [slug] (page) route and 404.
  const slugMap: SlugMap = {}
  if (post.slugMap) {
    for (const [loc, slugObj] of Object.entries(post.slugMap)) {
      if (slugObj?.current) {
        slugMap[loc as SupportedLocale] = `blog/${slugObj.current}`
      }
    }
  }

  const { label: backLabel, url: backUrl } = getBackContext(from, locale, tenantId)

  const coverSrc = imageUrl(post.coverImage, 1600)
  const coverSrcSet = imageSrcSet(post.coverImage, [800, 1200, 1600, 2400])

  const publishedDate = post.publishedAt
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(post.publishedAt)
      )
    : null

  const authorAvatarSrc = post.author?.avatar ? imageUrl(post.author.avatar, 80) : undefined
  const featuredVideoSrc = resolveEmbedUrl(post.featuredVideo?.youtubeUrl)

  return (
    <SlugMapProvider slugMap={slugMap}>
      <div style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="mx-auto max-w-[780px] px-5 py-12 md:px-8">

          {/* ── Back button ───────────────────────────────────────── */}
          <SlideUp duration={0.5}>
            <BackButton
              fallbackUrl={backUrl}
              label={backLabel}
            />
          </SlideUp>

          {/* ── Categories ────────────────────────────────────────── */}
          {post.categories && post.categories.length > 0 && (
            <SlideUp delay={0.05} duration={0.5}>
              <div className="flex flex-wrap gap-2 mb-5">
                {post.categories.map((cat) => (
                  <span
                    key={cat.key}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-widest"
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
            </SlideUp>
          )}

          {/* ── Title ────────────────────────────────────────────── */}
          <SlideUp delay={0.08} duration={0.6}>
            <h1
              className="text-[clamp(30px,6vw,50px)] font-bold leading-[1.1] tracking-tight mb-6"
              style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
            >
              {post.title}
            </h1>
          </SlideUp>

          {/* ── Author + date + reading time ──────────────────────── */}
          <SlideUp delay={0.12} duration={0.5}>
            <div
              className="flex items-center gap-3 mb-10 pb-8"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              {authorAvatarSrc && (
                <img
                  src={authorAvatarSrc}
                  alt={post.author?.name ?? ''}
                  className="w-10 h-10 rounded-full object-cover shrink-0"
                />
              )}
              <div>
                {post.author?.name && (
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {post.author.name}
                    {post.author.role && (
                      <span className="font-normal ml-1" style={{ color: 'var(--color-text-muted)' }}>
                        · {post.author.role}
                      </span>
                    )}
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {publishedDate}
                  {post.readingTimeMinutes && ` · ${post.readingTimeMinutes} min read`}
                </p>
              </div>
            </div>
          </SlideUp>

          {/* ── Cover image ───────────────────────────────────────── */}
          {coverSrc && (
            <SlideUp delay={0.15} duration={0.6}>
              <figure className="mb-10">
                {/* Fixed 16:9 container — image always fills with object-cover, no gaps */}
                <div className="overflow-hidden rounded-xl" style={{ aspectRatio: '16 / 9' }}>
                  <img
                    src={coverSrc}
                    srcSet={coverSrcSet}
                    alt={post.coverImage?.alt ?? post.title ?? ''}
                    className="block h-full w-full object-cover"
                    loading="eager"
                  />
                </div>
                {post.coverImage?.caption && (
                  <figcaption className="mt-2 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                    {post.coverImage.caption}
                  </figcaption>
                )}
              </figure>
            </SlideUp>
          )}

          {/* ── Excerpt / lead ────────────────────────────────────── */}
          {post.excerpt && (
            <SlideUp delay={0.18} duration={0.5}>
              <p
                className="text-lg font-medium leading-relaxed mb-8"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {post.excerpt}
              </p>
            </SlideUp>
          )}

          {/* ── Body ──────────────────────────────────────────────── */}
          {post.body && (
            <SlideUp delay={0.2} duration={0.5}>
              <div className="mb-12">
                <PortableText
                  value={post.body as any}
                  components={articlePortableTextComponents}
                />
              </div>
            </SlideUp>
          )}

          {/* ── Featured video ────────────────────────────────────── */}
          {featuredVideoSrc && (
            <SlideUp delay={0.25} duration={0.5}>
              <div className="mb-12">
                <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
                  <iframe
                    src={featuredVideoSrc}
                    title={post.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            </SlideUp>
          )}

          {/* ── Related event ─────────────────────────────────────── */}
          {post.relatedEvent && (
            <SlideUp delay={0.28} duration={0.5}>
              <div
                className="mb-12 p-6 rounded-xl flex items-center gap-4"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-primary)' }}>
                    Related Event
                  </p>
                  <p className="text-base font-semibold truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
                    {post.relatedEvent.title}
                  </p>
                  {post.relatedEvent.startDate && (
                    <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
                        new Date(post.relatedEvent.startDate)
                      )}
                    </p>
                  )}
                </div>
                <a
                  href={`/${locale}/${tenantId}/events/${post.relatedEvent.slug.current}`}
                  className="shrink-0 text-sm font-medium px-4 py-2 rounded-lg transition-opacity hover:opacity-75"
                  style={{ backgroundColor: 'color-mix(in oklch, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' }}
                >
                  View Event →
                </a>
              </div>
            </SlideUp>
          )}

          {/* ── Related posts ─────────────────────────────────────── */}
          {relatedPosts && relatedPosts.length > 0 && (
            <SlideUp delay={0.3} duration={0.5}>
              <div
                className="mt-16 pt-10"
                style={{ borderTop: '1px solid var(--color-border)' }}
              >
                <h2
                  className="text-2xl font-semibold mb-8"
                  style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                >
                  Related Articles
                </h2>
                <div
                  className={`grid gap-6 ${
                    relatedPosts.length === 1
                      ? 'grid-cols-1 max-w-sm'
                      : relatedPosts.length === 2
                      ? 'grid-cols-1 sm:grid-cols-2'
                      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                  }`}
                >
                  {relatedPosts.map((related, i) => (
                    <PostCard
                      key={related._id}
                      post={related}
                      href={`/${locale}/${tenantId}/blog/${related.slug.current}`}
                      delay={i * 0.07}
                    />
                  ))}
                </div>
              </div>
            </SlideUp>
          )}

          {/* ── Bottom navigation ─────────────────────────────────── */}
          <SlideUp delay={0.35} duration={0.5}>
            <div
              className="mt-16 pt-8 flex items-center justify-between gap-4 flex-wrap"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <a
                href={backUrl}
                className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-75"
                style={{ color: 'var(--color-primary)' }}
              >
                ← {backLabel}
              </a>
              <a
                href={`/${locale}/${tenantId}/blog`}
                className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-75"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                View All Posts →
              </a>
            </div>
          </SlideUp>

        </div>
      </div>
    </SlugMapProvider>
  )
}
