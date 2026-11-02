// ── Readiness facts from the editor's client state (C6 §6.6; pure, browser-safe) ──
//
// `itemReadinessInputFromState` is the CLIENT facts builder (state → input).
// The server/Studio twin (`loadItemFacts`, C6 §6.7) arrives with the gate
// switch-over (R2); both must produce identical inputs for the same document
// (fixture R-30).
//
// R1: facts that only the server can know (unreviewed choices of attached
// lists, never-published dependencies, slug conflicts, placements) are EMPTY
// here, exactly as the editor's checks never knew them before — so the
// adapter's output is unchanged (G-03).

import { declarationPatch, offerFormIssues, type ItemState } from '../dashboard-form'
import type { ItemIssueContext, ItemIssueState } from '../item-issues'
import type { FormatReadinessFacts, ItemReadinessInput } from './types'

/** The implicit default format's key (C3: an item without formats has exactly one). */
export const IMPLICIT_FORMAT_KEY = 'default'

export type ClientFactsState = ItemIssueState & Partial<Pick<ItemState, 'description' | 'imageIds'>> & { id?: string }

export function itemReadinessInputFromState(s: ClientFactsState, ctx: ItemIssueContext): ItemReadinessInput {
  // R1: legacy offers are the one implicit format; their form issues are its price issues.
  const priceIssues = offerFormIssues(s.offers, ctx.channels).map((i) => ({ code: i.kind, ...('key' in i && typeof i.key === 'string' && { key: i.key }) }))
  const implicit: FormatReadinessFacts = { key: IMPLICIT_FORMAT_KEY, priceIssues }
  const formats = [implicit]
  return {
    id: s.id ?? '',
    profile: s.itemProfile ?? null,
    name: s.name,
    description: s.description ?? {},
    siteLocales: ctx.locales,
    defaultLocale: ctx.defaultLocale,
    photoCount: s.imageIds?.length ?? 0,
    categories: { primary: null, additional: [] },
    formats: () => formats,
    placements: null,
    allergen: { declaration: declarationPatch(s.allergenDeclaration) },
    options: s.options,
    optionFacts: { counts: ctx.optionCounts, unreviewedChoices: [] },
    dependencies: { neverPublished: [], missing: [] },
    page: { hasPage: s.hasPage, slug: s.slug, conflicts: [] },
    bookIsbn: s.bookDetails?.isbn ?? null,
    overrides: [],
  }
}
