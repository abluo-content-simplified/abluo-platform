import { PostCallToAction } from '@/components/blog/PostCallToAction'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { tenantClient, fetchDesignSystemById } from '@/lib/sanity/client'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { localeConfigQuery, designSystemQuery, projectModuleConfigQuery, relatedPostsQuery } from '@/lib/sanity/queries'
import { postDraftPreviewQuery } from '@/lib/sanity/post-preview-query'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveCategoriesFor, categoryKeysOf, charsPerMinute } from '@/lib/modules/categories'
import type { Post, LocaleConfig, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { PostArticle } from '@/components/blog/PostArticle'
import { asUrlProjectSegment, unbrand } from '@/lib/tenancy/ids'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { siteBasePath } from '@/lib/sanity/href'
import { authorizeDraftPreview } from '@/lib/preview/authorize'

/**
 * PRIVATE draft preview of a blog post (ADR-025 · preview).
 *
 * The live post page's article (`PostArticle`), inside the same website
 * layout (design system CSS, fonts, header, footer), rendered from the DRAFT.
 * Never public: without a valid signed token for exactly this draft and this
 * project (minted by the client dashboard, 15 minutes) the route 404s — see
 * `authorizeDraftPreview`. Never cached, never indexed (`noindex` here plus
 * `X-Robots-Tag` / `Cache-Control: no-store` from the proxy), and not in the
 * sitemap (which lists published documents only).
 *
 * `?theme=light|dark` forces the palette for this page only: the root boot
 * script reads it on preview paths and does not touch the visitor's saved
 * preference (`abluo-theme`).
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ tenant: string; locale: string; id: string }>
  searchParams?: Promise<{ t?: string | string[]; theme?: string }>
}

export const metadata: Metadata = {
  title: 'Preview',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
}

export default async function DraftPostPreviewPage({ params, searchParams }: PageProps) {
  const { tenant: rawTenantId, locale, id } = await params
  const tenantId = asUrlProjectSegment(rawTenantId)
  const search = (await searchParams) ?? {}
  const h = await headers()

  const claims = await authorizeDraftPreview({
    token: Array.isArray(search.t) ? undefined : search.t,
    draftId: id,
    urlProject: unbrand(tenantId),
    host: h.get('x-forwarded-host') ?? h.get('host'),
    getDraft: (documentId) => sanityWriteClient.getDocument(documentId),
  })
  if (!claims) notFound()

  const { fetchForTenant } = tenantClient(tenantId)
  const siteBase = siteBasePath(locale, tenantId, await isHostScopedRequest(tenantId))

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const moduleConfig = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale })
  const cpm = charsPerMinute(moduleConfig, 'blog')
  const enabledModuleIds = getEnabledModuleIds(moduleConfig)
  const showGallery = enabledModuleIds === null || enabledModuleIds.includes('gallery')

  const [post, designSystem] = await Promise.all([
    // The live page's projection over the draft itself (perspective "raw").
    sanityWriteClient.fetch<Post | null>(
      postDraftPreviewQuery,
      { draftId: `drafts.${claims.draftId}`, projectSlug: claims.projectSlug, locale, defaultLocale, charsPerMinute: cpm },
      { perspective: 'raw' }
    ),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
  ])
  if (!post) notFound()

  // Related posts exactly as the live page picks them (published posts only).
  const relatedPosts = (
    (await fetchForTenant<Post[]>(relatedPostsQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
      excludeId: claims.draftId,
      categoryKeys: categoryKeysOf(post),
      charsPerMinute: cpm,
    })) ?? []
  ).map((related) => ({
    ...related,
    categories: resolveCategoriesFor(related, moduleConfig, 'blog', locale, defaultLocale),
  }))
  post.categories = resolveCategoriesFor(post, moduleConfig, 'blog', locale, defaultLocale)

  return (
    <SlugMapProvider slugMap={{}}>
      <PostArticle
        callToAction={
          <PostCallToAction tenantSlug={tenantId} locale={locale} defaultLocale={defaultLocale} cta={post.cta} />
        }
        post={post}
        relatedPosts={relatedPosts}
        designSystem={designSystem}
        locale={locale}
        siteBase={siteBase}
        // The live page's default (no `?from=`).
        backLabel="Back to Home"
        backUrl={siteBase}
        showGallery={showGallery}
      />
    </SlugMapProvider>
  )
}
