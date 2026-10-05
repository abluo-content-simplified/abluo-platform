import { PostCallToAction } from '@/components/blog/PostCallToAction'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
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
import { resolveCategoriesFor, categoryKeysOf, charsPerMinute, DEFAULT_CHARS_PER_MINUTE } from '@/lib/modules/categories'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Post, LocaleConfig, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import { ogImageUrl } from '@/lib/sanity/image'
import { PostArticle } from '@/components/blog/PostArticle'
import { SlugMapProvider, type SlugMap } from '@/components/SlugMapContext'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { siteBasePath } from '@/lib/sanity/href'
import { canonicalOrigin, canonicalUrl } from '@/lib/seo/canonical'
import { ArticleJsonLd } from '@/components/JsonLd'
import { getEnabledModuleIds } from '@/lib/modules/config'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string; slug: string }>
  searchParams?: Promise<{ from?: string }>
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: rawTenantId, locale, slug } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const supportedLocales: SupportedLocale[] = localeConfig?.supportedLocales ?? [defaultLocale]

  const [post, customDomain] = await Promise.all([
    fetchForTenant<Post>(postBySlugQuery, { slug, locale: locale as SupportedLocale, defaultLocale, charsPerMinute: DEFAULT_CHARS_PER_MINUTE }),
    fetchForTenant<string | null>(projectDomainQuery, {}),
  ])

  const origin = canonicalOrigin(customDomain)
  const currentSlug = post?.slugMap?.[locale as SupportedLocale]?.current ?? slug

  const alternates: Record<string, string> = {}
  if (origin && post?.slugMap) {
    for (const loc of supportedLocales) {
      const locSlug = post.slugMap[loc as SupportedLocale]?.current
      if (locSlug) {
        alternates[loc] = canonicalUrl(origin, loc, 'blog', locSlug)!
      }
    }
  }

  return {
    title: post?.seoTitle ?? post?.title ?? 'Article',
    description: post?.seoDescription ?? post?.excerpt ?? 'Article',
    alternates: {
      canonical: isProduction() && origin
        ? canonicalUrl(origin, locale, 'blog', currentSlug)
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

function getBackContext(from: string | undefined, siteBase: string) {
  if (!from || from === 'home') {
    return { label: 'Back to Home', url: `${siteBase}` }
  }
  if (from === 'blog') {
    return { label: 'Back to Blog', url: `${siteBase}/blog` }
  }
  // Any other value is treated as a page slug: "investors" → "Back to Investors"
  const label = from
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return { label: `Back to ${label}`, url: `${siteBase}/${from}` }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BlogDetailPage({ params, searchParams }: PageProps) {
  const { tenant: rawTenantId, locale, slug } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const resolvedSearch = await searchParams
  const from = resolvedSearch?.from
  const { fetchForTenant } = tenantClient(tenantId)
  const siteBase = siteBasePath(locale, tenantId, await isHostScopedRequest(tenantId))

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ADR-020 Amendment B — needed to resolve category keys into labels and to
  // apply the website's configured reading speed.
  const moduleConfig = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, {
    locale,
    defaultLocale,
  })
  const cpm = charsPerMinute(moduleConfig, 'blog')
  const enabledModuleIds = getEnabledModuleIds(moduleConfig)
  const showGallery = enabledModuleIds === null || enabledModuleIds.includes('gallery')

  const [post, designSystem, customDomain] = await Promise.all([
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
    fetchForTenant<string | null>(projectDomainQuery, {}),
  ])

  // Primary lookup missed — check redirect table.
  if (!post) {
    const redirectResult = await fetchForTenant<{ currentSlug: string }>(
      postByOldSlugQuery,
      { slug, locale: locale as SupportedLocale }
    )
    if (redirectResult?.currentSlug) {
      permanentRedirect(`${siteBase}/blog/${redirectResult.currentSlug}`)
    }
    notFound()
  }

  // Related posts — prioritise shared categories, exclude current post.
  const categoryKeys = categoryKeysOf(post)
  const relatedPosts = (await fetchForTenant<Post[]>(relatedPostsQuery, {
    locale: locale as SupportedLocale,
    defaultLocale,
    excludeId: post._id,
    categoryKeys,
    charsPerMinute: cpm,
  })).map((related) => ({
    ...related,
    categories: resolveCategoriesFor(related, moduleConfig, 'blog', locale, defaultLocale),
  }))

  // Resolve this post's own categories for the header badges.
  post.categories = resolveCategoriesFor(post, moduleConfig, 'blog', locale, defaultLocale)

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

  const { label: backLabel, url: backUrl } = getBackContext(from, siteBase)


  return (
    <SlugMapProvider slugMap={slugMap}>
      <ArticleJsonLd
        origin={canonicalOrigin(customDomain)}
        locale={locale}
        pathSegments={['blog', post.slugMap?.[locale as SupportedLocale]?.current ?? slug]}
        headline={post.title}
        description={post.excerpt}
        imageUrl={post.coverImage?.asset ? ogImageUrl(post.coverImage) : null}
        datePublished={post.publishedAt}
        authorName={post.author?.name}
      />
      <PostArticle
        callToAction={
          <PostCallToAction tenantSlug={tenantId} locale={locale} defaultLocale={defaultLocale} cta={post.cta} />
        }
        post={post}
        relatedPosts={relatedPosts}
        designSystem={designSystem}
        locale={locale}
        siteBase={siteBase}
        backLabel={backLabel}
        backUrl={backUrl}
        showGallery={showGallery}
      />
    </SlugMapProvider>
  )
}
