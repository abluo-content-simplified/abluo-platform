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
import { StatementSection } from '@/components/sections/StatementSection'
import { MetricsSection } from '@/components/sections/MetricsSection'
import { PhotoGallerySection } from '@/components/sections/PhotoGallerySection'
import { SECTION_MAP } from '@/lib/modules/sections'
import type {
  WebsiteSiteConfig,
  PageSection,
  BlogListingSection as BlogListingSectionType,
  FormSection as FormSectionType,
  HeroLiveCaptureSection as HeroLiveCaptureSectionType,
  HeroLensSection as HeroLensSectionType,
  SupportedLocale,
  DesignSystem,
  Post,
} from '@/lib/sanity/types'
import { computeSectionSurface } from '@/lib/sanity/surfaces'
import {
  blogListingPostsNewestQuery,
  blogListingPostsOldestQuery,
  blogListingManualPostsQuery,
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
): Promise<Post[]> {
  const {
    filterMode = 'latest',
    sortOrder = 'newest',
    maxItems = 3,
    categoryId,
    eventId,
    postIds,
  } = section

  // Manual selection: fetch by explicit post IDs then sort/reorder in JS
  if (filterMode === 'manual' && postIds?.length) {
    const posts = await fetchForTenant<Post[]>(blogListingManualPostsQuery, {
      locale,
      defaultLocale,
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
    filterMode,
    categoryId: categoryId ?? null,
    eventId: eventId ?? null,
    // Fetch one extra to detect "has more" for the View All button
    maxItems: maxItems + 1,
  })
}

/**
 * Hydrate any blogListingSection sections in `sections` with posts fetched
 * server-side, mutating each section's `.posts` in place. Shared by both
 * routes so there is exactly one hydration path (previously duplicated).
 */
export async function hydrateSections(
  sections: PageSection[] | undefined,
  ctx: {
    fetchForTenant: ReturnType<typeof tenantClient>['fetchForTenant']
    locale: SupportedLocale
    defaultLocale: SupportedLocale
  }
): Promise<void> {
  if (!sections) return
  await Promise.all(
    sections.map(async (section) => {
      if (section._type !== 'blogListingSection') return
      const bls = section as BlogListingSectionType
      const posts = await fetchBlogListingPosts(bls, ctx.fetchForTenant, ctx.locale, ctx.defaultLocale)
      // Slice to maxItems — we fetched one extra to detect overflow for View All
      bls.posts = posts.slice(0, bls.maxItems ?? 3)
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
}: SectionRendererProps) {
  const surface = computeSectionSurface(section.background, backgroundPattern as any, sectionIndex)

  // ── Module-owned sections ────────────────────────────────────────────────
  // Derived from MODULE_REGISTRY via SECTION_MAP. New module sections are
  // registered in their module's sections.tsx file; no changes here required.
  const ModuleSection = SECTION_MAP[section._type]
  if (ModuleSection) {
    return <>{ModuleSection({ section, surface, designSystem, siteConfig, locale, tenantSlug, fromParam })}</>
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
      return <ContactSection section={section} surface={surface} designSystem={designSystem} siteConfig={siteConfig} locale={locale} />
    case 'formSection':
      return <FormSection section={section as FormSectionType} surface={surface} designSystem={designSystem} locale={locale} tenantSlug={tenantSlug} />
    case 'metricsSection':
      return <MetricsSection section={section} surface={surface} designSystem={designSystem} />
    case 'photoGallerySection':
      return <PhotoGallerySection section={section} surface={surface} designSystem={designSystem} />
    default:
      return null
  }
}
