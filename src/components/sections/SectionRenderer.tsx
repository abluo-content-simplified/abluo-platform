// ─── Shared SectionRenderer ─────────────────────────────────────────────────
// ADR-016 Phase 0 — single shared SectionRenderer (closes tech-debt item I5).
//
// Prior to this extraction, this exact renderer (dispatch + platform switch)
// and the blogListingSection hydration helper were duplicated verbatim in:
//   - src/app/[locale]/(website)/[tenant]/page.tsx
//   - src/app/[locale]/(website)/[tenant]/[slug]/page.tsx
//
// Both routes now import from this single module. Adding a new platform
// section type requires editing exactly one file (this one) instead of two.
// Module-owned sections continue to require zero changes here — they are
// derived from SECTION_MAP (src/lib/modules/sections.ts).

import type { tenantClient } from '@/lib/sanity/client'
import { HeroSection } from '@/components/sections/HeroSection'
import { HeroLiveCaptureSection } from '@/components/sections/HeroLiveCaptureSection'
import { HeroLensSection } from '@/components/sections/HeroLensSection'
import { MediaContentSection } from '@/components/sections/MediaContentSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { TeamSection } from '@/components/sections/TeamSection'
import { TextSection } from '@/components/sections/TextSection'
import { FAQSection } from '@/components/sections/FAQSection'
import { ContactSection } from '@/components/sections/ContactSection'
import { FormSection } from '@/components/sections/FormSection'
import { FormOverlayButtonSection } from '@/components/sections/FormOverlayButtonSection'
import { StatementSection } from '@/components/sections/StatementSection'
import { MetricsSection } from '@/components/sections/MetricsSection'
import { PhotoGallerySection } from '@/components/sections/PhotoGallerySection'
import { VideoSection } from '@/components/sections/VideoSection'
import { StepsSection } from '@/components/sections/StepsSection'
import { FeatureGridSection } from '@/components/sections/FeatureGridSection'
import { MediaFeatureSection } from '@/components/sections/MediaFeatureSection'
import { CategoryListSection } from '@/components/sections/CategoryListSection'
import { CtaBannerSection } from '@/components/sections/CtaBannerSection'
import { SECTION_MAP, isSectionTypeAvailable } from '@/lib/modules/sections'
import type { ProjectModuleConfig } from '@/lib/modules/config'
import { resolveCategoriesFor, categoryKeysOf, charsPerMinute, DEFAULT_CHARS_PER_MINUTE } from '@/lib/modules/categories'
import type {
  WebsiteSiteConfig,
  PageSection,
  BlogListingSection as BlogListingSectionType,
  NewsListingSection as NewsListingSectionType,
  EventsListingSection as EventsListingSectionType,
  LiveLatestSection as LiveLatestSectionType,
  FormSection as FormSectionType,
  FormOverlayButtonSection as FormOverlayButtonSectionType,
  HeroLiveCaptureSection as HeroLiveCaptureSectionType,
  HeroLensSection as HeroLensSectionType,
  SupportedLocale,
  DesignSystem,
  Post,
  NewsArticle,
  Event,
} from '@/lib/sanity/types'
import { computeSectionSurface } from '@/lib/sanity/surfaces'
import {
  blogListingPostsNewestQuery,
  blogListingPostsOldestQuery,
  blogListingManualPostsQuery,
  newsListingArticlesNewestQuery,
  newsListingArticlesOldestQuery,
  newsListingManualArticlesQuery,
  eventsListingEventsNewestQuery,
  eventsListingEventsOldestQuery,
  eventsListingManualEventsQuery,
  currentLiveEventQuery,
} from '@/lib/sanity/queries'

// ─── Blog listing post fetcher ────────────────────────────────────────────────

/**
 * Fetch posts for a single blogListingSection based on its filter + sort config.
 * Returns one extra post beyond maxItems so the caller can detect "has more".
 */
async function fetchBlogListingPosts(
  section: BlogListingSectionType,
  fetchForTenant: ReturnType<typeof tenantClient>['fetchForTenant'],
  locale: SupportedLocale,
  defaultLocale: SupportedLocale,
  moduleConfig?: ProjectModuleConfig,
): Promise<Post[]> {
  const cpm = charsPerMinute(moduleConfig, 'blog')
  const {
    filterMode = 'latest',
    sortOrder = 'newest',
    maxItems = 3,
    categoryKey,
    eventId,
    postIds,
  } = section

  // Manual selection: fetch by explicit post IDs then sort/reorder in JS
  if (filterMode === 'manual' && postIds?.length) {
    const posts = await fetchForTenant<Post[]>(blogListingManualPostsQuery, {
      locale,
      defaultLocale,
      charsPerMinute: cpm,
      postIds,
    })
    if (sortOrder === 'manual') {
      // Preserve the editor-defined array order
      const indexMap: Record<string, number> = Object.fromEntries(
        postIds.map((id, i) => [id, i])
      )
      return [...posts].sort((a, b) => (indexMap[a._id] ?? 999) - (indexMap[b._id] ?? 999))
    }
    if (sortOrder === 'oldest') {
      return posts.sort((a, b) =>
        (a.publishedAt ?? '').localeCompare(b.publishedAt ?? '')
      )
    }
    return posts.sort((a, b) =>
      (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
    )
  }

  // Dynamic filter (latest / featured / byCategory / byEvent) — let GROQ sort
  const query = sortOrder === 'oldest' ? blogListingPostsOldestQuery : blogListingPostsNewestQuery
  return fetchForTenant<Post[]>(query, {
    locale,
    defaultLocale,
    charsPerMinute: cpm,
    filterMode,
    categoryKey: categoryKey ?? null,
    eventId: eventId ?? null,
    // Fetch one extra to detect "has more" for the View All button
    maxItems: maxItems + 1,
  })
}

/**
 * Fetch events for a single eventsListingSection based on its filter/sort/
 * time-window config. Mirrors fetchBlogListingPosts exactly — see that
 * function's comment for the manual-selection vs dynamic-filter split.
 * Returns one extra event beyond maxItems so the caller can detect "has more".
 */
async function fetchEventsListingEvents(
  section: EventsListingSectionType,
  fetchForTenant: ReturnType<typeof tenantClient>['fetchForTenant'],
  locale: SupportedLocale,
  defaultLocale: SupportedLocale,
  moduleConfig?: ProjectModuleConfig,
): Promise<Event[]> {
  const {
    filterMode = 'latest',
    sortOrder = 'newest',
    timeFilter = 'upcoming',
    maxItems = 3,
    categoryKey,
    eventIds,
  } = section

  // Manual selection: fetch by explicit event IDs then sort/reorder in JS
  if (filterMode === 'manual' && eventIds?.length) {
    const events = await fetchForTenant<Event[]>(eventsListingManualEventsQuery, {
      locale,
      defaultLocale,
      eventIds,
    })
    if (sortOrder === 'manual') {
      // Preserve the editor-defined array order
      const indexMap: Record<string, number> = Object.fromEntries(
        eventIds.map((id, i) => [id, i])
      )
      return [...events].sort((a, b) => (indexMap[a._id] ?? 999) - (indexMap[b._id] ?? 999))
    }
    if (sortOrder === 'oldest') {
      return events.sort((a, b) =>
        (a.startDate ?? '').localeCompare(b.startDate ?? '')
      )
    }
    return events.sort((a, b) =>
      (b.startDate ?? '').localeCompare(a.startDate ?? '')
    )
  }

  // Dynamic filter (latest / featured / byCategory) — let GROQ sort
  const query = sortOrder === 'oldest' ? eventsListingEventsOldestQuery : eventsListingEventsNewestQuery
  return fetchForTenant<Event[]>(query, {
    locale,
    defaultLocale,
    filterMode,
    timeFilter,
    categoryKey: categoryKey ?? null,
    // Fetch one extra to detect "has more" for the View All button
    maxItems: maxItems + 1,
  })
}

// ─── News listing fetcher (ADR-020) ───────────────────────────────────────────

/**
 * Fetch news items for a single newsListingSection based on its filter + sort
 * config. Returns one extra beyond maxItems so the caller can detect "has more"
 * for the View All button — same contract as the blog fetcher.
 *
 * Mirrors fetchBlogListingPosts, minus the 'byEvent' branch: News has no Events
 * integration, so there is no eventId to pass.
 */
async function fetchNewsListingArticles(
  section: NewsListingSectionType,
  fetchForTenant: ReturnType<typeof tenantClient>['fetchForTenant'],
  locale: SupportedLocale,
  defaultLocale: SupportedLocale,
  moduleConfig?: ProjectModuleConfig,
): Promise<NewsArticle[]> {
  const cpm = charsPerMinute(moduleConfig, 'news')
  const {
    filterMode = 'latest',
    sortOrder = 'newest',
    maxItems = 3,
    categoryKey,
    articleIds,
  } = section

  // Manual selection: fetch by explicit IDs, then order in JS. GROQ does not
  // preserve the order of an `in` list, so editor-defined order must be
  // reapplied here rather than relied upon from the query.
  if (filterMode === 'manual' && articleIds?.length) {
    const articles = await fetchForTenant<NewsArticle[]>(newsListingManualArticlesQuery, {
      locale,
      defaultLocale,
      charsPerMinute: cpm,
      articleIds,
    })
    if (sortOrder === 'manual') {
      const indexMap: Record<string, number> = Object.fromEntries(
        articleIds.map((id, i) => [id, i])
      )
      return [...articles].sort((a, b) => (indexMap[a._id] ?? 999) - (indexMap[b._id] ?? 999))
    }
    if (sortOrder === 'oldest') {
      return articles.sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
    }
    return articles.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
  }

  // Dynamic filter (latest / featured / byCategory) — let GROQ sort.
  const query = sortOrder === 'oldest' ? newsListingArticlesOldestQuery : newsListingArticlesNewestQuery
  return fetchForTenant<NewsArticle[]>(query, {
    locale,
    defaultLocale,
    charsPerMinute: cpm,
    filterMode,
    categoryKey: categoryKey ?? null,
    // One extra, to detect "has more" for the View All button.
    maxItems: maxItems + 1,
  })
}

/**
 * Hydrate any blogListingSection, eventsListingSection, or liveLatestSection
 * sections in `sections` with data fetched server-side, mutating each
 * section's `.posts` / `.events` / `.event` in place. Shared by all five
 * routes so there is exactly one hydration path (previously duplicated).
 *
 * ADR-016 Phase D — a section whose owning module is not installed for the
 * tenant (per `ctx.enabledModuleIds`) is skipped entirely: no data fetch, no
 * mutation. It will also render null in SectionRenderer below, so hydrating
 * it would be wasted work. `enabledModuleIds` is optional and defaults to
 * "unresolved" (fail-open — see isSectionTypeAvailable) so callers that have
 * not yet been updated to pass it keep today's behaviour.
 */
export async function hydrateSections(
  sections: PageSection[] | undefined,
  ctx: {
    fetchForTenant: ReturnType<typeof tenantClient>['fetchForTenant']
    locale: SupportedLocale
    defaultLocale: SupportedLocale
    enabledModuleIds?: string[] | null
    /**
     * ADR-020 Amendment B — needed to resolve category keys into labels and to
     * apply the website's configured reading speed. Optional: without it the
     * defaults apply and categories render empty rather than breaking.
     */
    moduleConfig?: ProjectModuleConfig
  }
): Promise<void> {
  if (!sections) return
  await Promise.all(
    sections.map(async (section) => {
      if (!isSectionTypeAvailable(section._type, ctx.enabledModuleIds)) return
      if (section._type === 'blogListingSection') {
        const bls = section as BlogListingSectionType
        const posts = await fetchBlogListingPosts(bls, ctx.fetchForTenant, ctx.locale, ctx.defaultLocale, ctx.moduleConfig)
        // Slice to maxItems — we fetched one extra to detect overflow for View All
        // ADR-020 Amendment B — turn stored keys into labels + colours once,
        // server-side, so every card renders from the same resolution.
        bls.posts = posts.slice(0, bls.maxItems ?? 3).map((post) => ({
          ...post,
          categories: resolveCategoriesFor(post, ctx.moduleConfig, 'blog', ctx.locale, ctx.defaultLocale),
        }))
        return
      }
      if (section._type === 'newsListingSection') {
        const nls = section as NewsListingSectionType
        const articles = await fetchNewsListingArticles(nls, ctx.fetchForTenant, ctx.locale, ctx.defaultLocale, ctx.moduleConfig)
        // Slice to maxItems — one extra was fetched to detect overflow for View All
        nls.articles = articles.slice(0, nls.maxItems ?? 3).map((article) => ({
          ...article,
          categories: resolveCategoriesFor(article, ctx.moduleConfig, 'news', ctx.locale, ctx.defaultLocale),
        }))
        return
      }
      if (section._type === 'eventsListingSection') {
        const els = section as EventsListingSectionType
        const events = await fetchEventsListingEvents(els, ctx.fetchForTenant, ctx.locale, ctx.defaultLocale, ctx.moduleConfig)
        // Slice to maxItems — we fetched one extra to detect overflow for View All
        els.events = events.slice(0, els.maxItems ?? 3)
        return
      }
      if (section._type === 'liveLatestSection') {
        const lls = section as LiveLatestSectionType
        lls.event = await ctx.fetchForTenant<Event | null>(currentLiveEventQuery, {
          locale: ctx.locale,
          defaultLocale: ctx.defaultLocale,
        })
        return
      }
    })
  )
}

// ─── Section renderer ─────────────────────────────────────────────────────────

export interface SectionRendererProps {
  section: PageSection
  siteConfig: WebsiteSiteConfig | null
  designSystem: DesignSystem | null
  backgroundPattern: string | undefined
  sectionIndex: number
  locale: string
  tenantSlug: string
  fromParam?: string
  /**
   * ADR-016 Phase D — the tenant's installed module IDs, used to gate
   * module-owned sections at render time. Optional and defaults to
   * "unresolved" (fail-open — see isSectionTypeAvailable in
   * src/lib/modules/sections.ts) so callers not yet updated keep rendering
   * everything, matching pre-Phase-D behaviour.
   */
  enabledModuleIds?: string[] | null
  /**
   * ADR-020 — module-owned per-website configuration, as returned by
   * projectModuleConfigQuery. Sections that render a module-configured surface
   * (today: contactSection's WhatsApp button) read it through the resolvers in
   * src/lib/modules/config.ts.
   *
   * Optional, and every consumer falls back to the deprecated siteConfig
   * fields, so a caller that has not been updated still renders correctly.
   */
  moduleConfig?: ProjectModuleConfig
}

export function SectionRenderer({
  section,
  siteConfig,
  designSystem,
  backgroundPattern,
  sectionIndex,
  locale,
  tenantSlug,
  fromParam,
  enabledModuleIds,
  moduleConfig,
}: SectionRendererProps) {
  const surface = computeSectionSurface(section.background, backgroundPattern as any, sectionIndex)

  // ── Module-installation gating (ADR-016 Phase D) ─────────────────────────
  // A module-owned section whose owning module is not installed for this
  // tenant renders nothing — silently, no wrapper, no error. Platform
  // sections (never in any manifest's sectionTypes) are never gated; see
  // isSectionTypeAvailable for the full contract, including the safe
  // "unresolved → available" default.
  if (!isSectionTypeAvailable(section._type, enabledModuleIds)) {
    return null
  }

  // ── Module-owned sections ────────────────────────────────────────────────
  // Derived from MODULE_REGISTRY via SECTION_MAP. New module sections are
  // registered in their module's sections.tsx file; no changes here required.
  const ModuleSection = SECTION_MAP[section._type]
  if (ModuleSection) {
    return <>{ModuleSection({ section, surface, designSystem, siteConfig, moduleConfig, locale, tenantSlug, fromParam })}</>
  }

  // ── Platform-owned sections ──────────────────────────────────────────────
  // These sections are platform assets available to every tenant regardless
  // of which modules are installed. They are registered here explicitly and
  // must not be moved to module files (Sections vs Modules principle, ADR-011).
  switch (section._type) {
    case 'heroSection':
      return <HeroSection section={section} surface={surface} designSystem={designSystem} />
    case 'heroLiveCaptureSection':
      return <HeroLiveCaptureSection section={section as HeroLiveCaptureSectionType} surface={surface} designSystem={designSystem} />
    case 'heroLensSection':
      return <HeroLensSection section={section as HeroLensSectionType} surface={surface} designSystem={designSystem} />
    case 'contentSection':
      return <MediaContentSection section={section} surface={surface} designSystem={designSystem} />
    case 'statementSection':
      return <StatementSection section={section} surface={surface} designSystem={designSystem} />
    case 'treatmentsSection':
      return <TreatmentsSection section={section} surface={surface} designSystem={designSystem} />
    case 'teamSection':
      return <TeamSection section={section} surface={surface} designSystem={designSystem} />
    case 'textSection':
      return <TextSection section={section} surface={surface} designSystem={designSystem} />
    case 'faqSection':
      return <FAQSection section={section} surface={surface} designSystem={designSystem} />
    case 'contactSection':
      return <ContactSection section={section} surface={surface} designSystem={designSystem} siteConfig={siteConfig} moduleConfig={moduleConfig} locale={locale} tenantSlug={tenantSlug} />
    case 'formSection':
      return <FormSection section={section as FormSectionType} surface={surface} designSystem={designSystem} locale={locale} tenantSlug={tenantSlug} />
    case 'formOverlayButtonSection':
      return <FormOverlayButtonSection section={section as FormOverlayButtonSectionType} surface={surface} designSystem={designSystem} locale={locale} tenantSlug={tenantSlug} />
    case 'metricsSection':
      return <MetricsSection section={section} surface={surface} designSystem={designSystem} />
    case 'photoGallerySection':
      return <PhotoGallerySection section={section} surface={surface} designSystem={designSystem} />
    case 'videoSection':
      return <VideoSection section={section} surface={surface} designSystem={designSystem} locale={locale} />
    case 'stepsSection':
      return <StepsSection section={section} surface={surface} designSystem={designSystem} />
    case 'featureGridSection':
      return <FeatureGridSection section={section} surface={surface} designSystem={designSystem} />
    case 'mediaFeatureSection':
      return <MediaFeatureSection section={section} surface={surface} designSystem={designSystem} />
    case 'categoryListSection':
      return <CategoryListSection section={section} surface={surface} designSystem={designSystem} />
    case 'ctaBannerSection':
      return <CtaBannerSection section={section} surface={surface} designSystem={designSystem} />
    default:
      return null
  }
}
