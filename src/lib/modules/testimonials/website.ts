// ── Testimonials module — website helpers (ADR-048 D1, D5) ────────────────────
//
// Pure except hydrateTestimonialsSection, which only calls the injected
// fetcher. The website's ONE hydration path (hydrateSections in
// SectionRenderer.tsx) calls hydrateTestimonialsSection for a
// `testimonialsSection`, so a page route and a slug route behave the same.

import type { TestimonialsSection } from '@/lib/sanity/types'
import { getModuleConfig, type ProjectModuleConfig } from '@/lib/modules/config'
import {
  DEFAULT_TESTIMONIAL_LIMIT,
  DEFAULT_TESTIMONIAL_SELECTION,
  MAX_TESTIMONIAL_LIMIT,
  TESTIMONIALS_MODULE_ID,
  TESTIMONIAL_SELECTIONS,
  TESTIMONIAL_SHOW_PHOTOS_KEY,
  type TestimonialSelection,
} from './model'
import { normalizeTestimonial, type TestimonialPublic, type TestimonialRaw } from './projection'
import {
  TESTIMONIALS_BY_IDS_QUERY,
  TESTIMONIALS_BY_TAG_QUERY,
  TESTIMONIALS_FEATURED_QUERY,
  TESTIMONIALS_LATEST_QUERY,
} from './queries'

type Fetch = <T>(query: string, params?: Record<string, unknown>) => Promise<T>

/**
 * Module gating, same contract as isSectionTypeAvailable: an unresolved module
 * list (null) fails open; a resolved list must contain `testimonials`.
 */
export function isTestimonialsModuleOn(enabledModuleIds: readonly string[] | null | undefined): boolean {
  return enabledModuleIds == null || enabledModuleIds.includes(TESTIMONIALS_MODULE_ID)
}

/** A usable selection mode (unknown / missing → featured). */
export function testimonialSelectionOf(section: Pick<TestimonialsSection, 'selectionMode'>): TestimonialSelection {
  return (TESTIMONIAL_SELECTIONS as readonly unknown[]).includes(section.selectionMode) ? (section.selectionMode as TestimonialSelection) : DEFAULT_TESTIMONIAL_SELECTION
}

/** 1..MAX; anything else is the default. */
export function testimonialLimitOf(section: Pick<TestimonialsSection, 'limit'>): number {
  const n = section.limit
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_TESTIMONIAL_LIMIT) : DEFAULT_TESTIMONIAL_LIMIT
}

/** The picked Sanity ids (unique, in the editor's order). */
export function testimonialPickedIds(section: Pick<TestimonialsSection, 'testimonialIds'>): string[] {
  return [...new Set((section.testimonialIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

/** Rows in the order of `ids`; ids that are no longer public simply drop out. */
export function orderPicked<T extends { _id?: string }>(rows: readonly T[] | null | undefined, ids: readonly string[]): T[] {
  const byId = new Map((rows ?? []).filter((r): r is T & { _id: string } => typeof r?._id === 'string').map((r) => [r._id, r]))
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}

export interface HydrateTestimonialsContext {
  /** The page language. */
  locale: string
  defaultLocale: string
  fetchForTenant: Fetch
  /** The website's module settings; `showPhotos` decides whether a photo is shown (default off). */
  moduleConfig?: ProjectModuleConfig
}

/** The module setting `showPhotos` (off unless explicitly on). */
export function testimonialsShowPhotos(moduleConfig: ProjectModuleConfig): boolean {
  return getModuleConfig(moduleConfig, TESTIMONIALS_MODULE_ID)?.[TESTIMONIAL_SHOW_PHOTOS_KEY] === true
}

/**
 * Fills `section.testimonialItems` with the testimonials to show — only
 * published ones with permission to publish (TESTIMONIAL_PUBLIC), each in one
 * coherent language — and returns them. The selection:
 *   featured  testimonials marked Featured, newest first, up to `limit`
 *   latest    the newest, up to `limit`
 *   tag       those carrying `tagKey`, newest first, up to `limit`
 *   selected  the picked ones, in the editor's order (no limit)
 * A failure leaves `testimonialItems` undefined (the section renders nothing);
 * callers log it, never fail the page.
 */
export async function hydrateTestimonialsSection(section: TestimonialsSection, ctx: HydrateTestimonialsContext): Promise<TestimonialPublic[]> {
  const params = { locale: ctx.locale, defaultLocale: ctx.defaultLocale }
  const mode = testimonialSelectionOf(section)
  const limit = testimonialLimitOf(section)
  let rows: Array<TestimonialRaw & { _id?: string }> = []
  if (mode === 'selected') {
    const ids = testimonialPickedIds(section)
    rows = ids.length ? orderPicked(await ctx.fetchForTenant<Array<TestimonialRaw & { _id?: string }>>(TESTIMONIALS_BY_IDS_QUERY, { ...params, ids }), ids) : []
  } else if (mode === 'tag') {
    const tagKey = typeof section.tagKey === 'string' ? section.tagKey.trim() : ''
    rows = tagKey ? await ctx.fetchForTenant<TestimonialRaw[]>(TESTIMONIALS_BY_TAG_QUERY, { ...params, tagKey, limit }) : []
  } else if (mode === 'latest') {
    rows = await ctx.fetchForTenant<TestimonialRaw[]>(TESTIMONIALS_LATEST_QUERY, { ...params, limit })
  } else {
    rows = await ctx.fetchForTenant<TestimonialRaw[]>(TESTIMONIALS_FEATURED_QUERY, { ...params, limit })
  }
  const showPhotos = testimonialsShowPhotos(ctx.moduleConfig)
  const items = (rows ?? []).flatMap((r) => {
    const t = normalizeTestimonial(r, ctx.locale)
    if (!t) return []
    // One switch: photos are shown only when the module setting is on.
    return [showPhotos ? t : { ...t, photo: null }]
  })
  section.testimonialItems = items
  return items
}
