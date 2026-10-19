/**
 * The FAQ items a page renders, for its one FAQPage (ADR-037 D7). Pure.
 *
 * Every FAQ section that renders contributes — in page order — and a post (or,
 * later, an event) adds its own placement after its sections. A page whose
 * FAQ sections are not available (module not installed) contributes nothing,
 * exactly as nothing renders.
 */
import type { FAQSection, PageSection } from '@/lib/sanity/types'
import { placementFaqGroups, type FaqGroup } from './items'
import { faqJsonLdItems, type FaqJsonLdItem, type FaqLinkContext } from './jsonld'

/** The groups an FAQ section renders: its sets, else its legacy inline questions. */
export function sectionFaqGroups(section: FAQSection): FaqGroup[] {
  return placementFaqGroups({ faqSets: section.faqSets, faqSetCount: section.faqSetCount, legacyItems: section.items })
}

export function collectSectionFaqItems(
  sections: PageSection[] | null | undefined,
  opts: { available: boolean; links: FaqLinkContext },
): FaqJsonLdItem[] {
  if (!opts.available || !Array.isArray(sections)) return []
  return sections
    .filter((s): s is FAQSection => s?._type === 'faqSection')
    .flatMap((s) => faqJsonLdItems(sectionFaqGroups(s), opts.links))
}

/**
 * Link context for FAQ JSON-LD on a website page. With a canonical origin,
 * site paths use the canonical shape (`/{locale}/…`, no project segment) and
 * become absolute; without one, they follow the request's own site base.
 */
export function faqJsonLdLinks(opts: { locale: string; siteBase: string; origin: string | null; projectSlug?: string | null }): FaqLinkContext {
  return opts.origin
    ? { siteBase: `/${opts.locale}`, origin: opts.origin, projectSlug: opts.projectSlug ?? null }
    : { siteBase: opts.siteBase, origin: null, projectSlug: opts.projectSlug ?? null }
}
