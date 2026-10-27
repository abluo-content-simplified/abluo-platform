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

import { withSchedule, withSchedules } from '@/lib/scheduling/read.server'
import { hydrateDownloadSections, type DownloadHydration } from '@/lib/access/download-section.server'
import type { tenantClient } from '@/lib/sanity/client'
import { HeroSection } from '@/components/sections/HeroSection'
import { HeroLiveCaptureSection } from '@/components/sections/HeroLiveCaptureSection'
import { HeroLensSection } from '@/components/sections/HeroLensSection'
import { MediaContentSection } from '@/components/sections/MediaContentSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { TeamSection } from '@/components/sections/TeamSection'
import { TextSection } from '@/components/sections/TextSection'
import { ContactSection } from '@/components/sections/ContactSection'
import { FormSection } from '@/components/sections/FormSection'
import { FormOverlayButtonSection } from '@/components/sections/FormOverlayButtonSection'
import { StatementSection } from '@/components/sections/StatementSection'
import { MetricsSection } from '@/components/sections/MetricsSection'
import { VideoSection } from '@/components/sections/VideoSection'
import { StepsSection } from '@/components/sections/StepsSection'
import { FeatureGridSection } from '@/components/sections/FeatureGridSection'
import { VentureListSection } from '@/components/sections/VentureListSection'
import { ClientsFlowSection } from '@/components/sections/ClientsFlowSection'
import { CareerTimelineSection } from '@/components/sections/CareerTimelineSection'
import { MediaFeatureSection } from '@/components/sections/MediaFeatureSection'
import { CategoryListSection } from '@/components/sections/CategoryListSection'
import { CtaBannerSection } from '@/components/sections/CtaBannerSection'
import { LocationsSection } from '@/components/sections/LocationsSection'
import { SECTION_MAP, isSectionTypeAvailable } from '@/lib/modules/sections'
import type { ProjectModuleConfig } from '@/lib/modules/config'
import { withEventPlaceName, withEventPlaceNames, type EventSiteContext } from '@/lib/modules/events/structured'
import { EVENT_VOCABULARY_PUBLIC_QUERY, resolveEventCategories, type RawEventVocabulary } from '@/lib/modules/events/categories'
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
  VentureListSection as VentureListSectionType,
  ClientsFlowSection as ClientsFlowSectionType,
  CareerTimelineSection as CareerTimelineSectionType,
  SupportedLocale,
  DesignSystem,
  Post,
  NewsArticle,
  Event,
} from '@/lib/sanity/types'
import { computeSectionSurface } from '@/lib/sanity/surfaces'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'
import { hasPageGradient } from '@/lib/sanity/gradients'
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
  eventSiteContextQuery,
} from '@/lib/sanity/queries'
import type { CatalogueListingSection as CatalogueListingSectionType } from '@/lib/sanity/types'
import type { CatalogueConfigDTO } from '@/lib/modules/catalogue/dto'
import { hydrateCatalogueListing, loadCatalogueConfig } from '@/lib/modules/catalogue/website'
import { visitorCountry } from '@/lib/affiliate/visitor-country'

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
    /** ADR-038 C3 — the Sanity projectSlug, to lay Supabase schedules over event dates. Without it events keep their Sanity dates. */
    projectSlug?: string
    locale: SupportedLocale
    defaultLocale: SupportedLocale
    enabledModuleIds?: string[] | null
    /**
     * ADR-020 Amendment B — needed to resolve category keys into labels and to
     * apply the website's configured reading speed. Optional: without it the
     * defaults apply and categories render empty rather than breaking.
     */
    moduleConfig?: ProjectModuleConfig
    /**
     * ADR-040 §15 — what a Download section needs: the page, its protection
     * and the visitor's groups (from the page gate). Without it Download
     * sections stay empty and render nothing.
     */
    downloads?: Omit<DownloadHydration, 'enabledModuleIds'>
  }
): Promise<void> {
  if (!sections) return
  if (ctx.downloads) await hydrateDownloadSections(sections, { ...ctx.downloads, enabledModuleIds: ctx.enabledModuleIds ?? null })
  // Catalogue config is read once per page, and only when a catalogue section
  // is actually present — most pages never pay for it.
  let catalogueConfig: Promise<CatalogueConfigDTO | null> | undefined
  const getCatalogueConfig = () =>
    (catalogueConfig ??= loadCatalogueConfig(ctx.fetchForTenant, { locale: ctx.locale, defaultLocale: ctx.defaultLocale }))
  // ADR-031 — the website's own locations, read once per page and only when an
  // events section is present, so event cards show the picked place's name. A
  // failed read leaves the free-text location, as before.
  let siteLocations: Promise<EventSiteContext['locations']> | undefined
  const getSiteLocations = () =>
    (siteLocations ??= ctx
      .fetchForTenant<EventSiteContext | null>(eventSiteContextQuery, { locale: ctx.locale, defaultLocale: ctx.defaultLocale })
      .then((site) => site?.locations ?? null)
      .catch(() => null))
  await Promise.all(
    sections.map(async (section) => {
      if (!isSectionTypeAvailable(section._type, ctx.enabledModuleIds)) return
      if (section._type === 'catalogueListingSection') {
        // ADR-033 spec §10.5 — an error omits the section, never the page:
        // `catalogue` stays undefined and the component renders nothing. A
        // project without an enabled catalogue installation gets no data and
        // renders nothing either (AC 3), even if gating failed open.
        const cls = section as CatalogueListingSectionType
        try {
          const config = await getCatalogueConfig()
          if (!config) return
          cls.catalogue = await hydrateCatalogueListing(ctx.fetchForTenant, cls.collectionId, {
            locale: ctx.locale,
            defaultLocale: ctx.defaultLocale,
            config,
            now: new Date(),
          }, { visitorCountry }, cls.source)
        } catch (err) {
          console.error('[catalogue] listing section hydration failed; section omitted', err)
          cls.catalogue = undefined
        }
        return
      }
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
        const fetched = await fetchEventsListingEvents(els, ctx.fetchForTenant, ctx.locale, ctx.defaultLocale, ctx.moduleConfig)
        const scheduled = ctx.projectSlug ? await withSchedules(ctx.projectSlug, fetched) : fetched
        const events = withEventPlaceNames(scheduled ?? [], await getSiteLocations())
        // Slice to maxItems — we fetched one extra to detect overflow for View All
        // ADR-033 Amendment J (dual-read) — category labels/colours from the term
        // records, else the module's old config list. A failed read shows no chips.
        const vocabulary = await ctx
          .fetchForTenant<RawEventVocabulary>(EVENT_VOCABULARY_PUBLIC_QUERY, { locale: ctx.locale, defaultLocale: ctx.defaultLocale })
          .catch(() => null)
        els.events = events.slice(0, els.maxItems ?? 3).map((event) => ({
          ...event,
          categories: resolveEventCategories(event.categoryKeys, vocabulary),
        }))
        return
      }
      if (section._type === 'liveLatestSection') {
        const lls = section as LiveLatestSectionType
        const live = await ctx.fetchForTenant<Event | null>(currentLiveEventQuery, {
          locale: ctx.locale,
          defaultLocale: ctx.defaultLocale,
        })
        const scheduled = ctx.projectSlug ? await withSchedule(ctx.projectSlug, live) : live
        lls.event = scheduled ? withEventPlaceName(scheduled, await getSiteLocations()) : scheduled
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
  /** The `[tenant]` URL segment — not a tenant slug. See `@/lib/tenancy/ids`. */
  tenantSlug: UrlProjectSegment
  fromParam?: string
  /**
   * True when the site is served on its own host: module listings then link
   * without the project segment (siteBasePath in @/lib/sanity/href). Routes
   * read it with isHostScopedRequest().
   */
  hostScoped?: boolean
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
  hostScoped,
  enabledModuleIds,
  moduleConfig,
}: SectionRendererProps) {
  const surface = computeSectionSurface(
    section.background,
    backgroundPattern as any,
    sectionIndex,
    hasPageGradient(designSystem) ? 'transparent' : 'surface1',
  )

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
    return <>{ModuleSection({ section, surface, designSystem, siteConfig, moduleConfig, locale, tenantSlug, fromParam, hostScoped })}</>
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
      return <TeamSection section={section} surface={surface} designSystem={designSystem} locale={locale} />
    case 'textSection':
      return <TextSection section={section} surface={surface} designSystem={designSystem} />
    // faqSection is owned by the FAQ module (ADR-037) — rendered through SECTION_MAP above.
    case 'contactSection':
      return <ContactSection section={section} surface={surface} designSystem={designSystem} siteConfig={siteConfig} moduleConfig={moduleConfig} locale={locale} tenantSlug={tenantSlug} />
    case 'formSection':
      return <FormSection section={section as FormSectionType} surface={surface} designSystem={designSystem} locale={locale} tenantSlug={tenantSlug} />
    case 'formOverlayButtonSection':
      return <FormOverlayButtonSection section={section as FormOverlayButtonSectionType} surface={surface} designSystem={designSystem} locale={locale} tenantSlug={tenantSlug} />
    case 'metricsSection':
      return <MetricsSection section={section} surface={surface} designSystem={designSystem} />
    case 'videoSection':
      return <VideoSection section={section} surface={surface} designSystem={designSystem} locale={locale} />
    case 'stepsSection':
      return <StepsSection section={section} surface={surface} designSystem={designSystem} />
    case 'featureGridSection':
      return <FeatureGridSection section={section} surface={surface} designSystem={designSystem} />
    case 'ventureListSection':
      return <VentureListSection section={section as VentureListSectionType} surface={surface} designSystem={designSystem} />
    case 'clientsFlowSection':
      return <ClientsFlowSection section={section as ClientsFlowSectionType} surface={surface} designSystem={designSystem} />
    case 'careerTimelineSection':
      return <CareerTimelineSection section={section as CareerTimelineSectionType} surface={surface} designSystem={designSystem} />
    case 'mediaFeatureSection':
      return <MediaFeatureSection section={section} surface={surface} designSystem={designSystem} />
    case 'categoryListSection':
      return <CategoryListSection section={section} surface={surface} designSystem={designSystem} />
    case 'ctaBannerSection':
      return <CtaBannerSection section={section} surface={surface} designSystem={designSystem} />
    case 'locationsSection':
      // Presentation of siteConfig.locations — siteConfig is fetched by both
      // routes and passed here, so no hydration step is needed.
      return <LocationsSection section={section} surface={surface} designSystem={designSystem} siteConfig={siteConfig} locale={locale} />
    default:
      return null
  }
}
