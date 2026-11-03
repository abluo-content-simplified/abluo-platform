// ── Readiness facts from the editor's client state (C6 §6.6; pure, browser-safe) ──
//
// `itemReadinessInputFromState` is the CLIENT facts builder (state → input).
// The server/Studio twin (`loadItemFacts`, C6 §6.7) arrives with the gate
// switch-over (R2); both must produce identical inputs for the same document
// (fixture R-30).
//
// Facts that only the server can know (unreviewed choices of attached lists,
// never-published dependencies, slug conflicts, placements) are EMPTY here,
// exactly as the editor's checks never knew them before (G-03).
//
// R2: categories and formats come from the item model through the ONE shared
// builder (`modelFacts`, facts-model.ts) — the publish gate's facts builder uses
// the same function, so editor and gate judge the same thing (R-30). The
// model-dependent rules run only when the project's markers say so
// (`activationMarkers`, C10-6 step 7).

import { declarationPatch, type ItemState } from '../dashboard-form'
import type { ItemIssueContext, ItemIssueState } from '../item-issues'
import { asFormatKey, asChannelKey } from '../commerce/commerce-types'
import { writerChannels, writerTree } from '../item-writer'
import { activationMarkers, modelFacts } from './facts-model'
import type { ItemReadinessInput } from './types'

/** The implicit default format's key (C3: an item without formats has exactly one). */
export const IMPLICIT_FORMAT_KEY = asFormatKey('default')

export type ClientFactsState = ItemIssueState & Partial<Pick<ItemState, 'description' | 'imageIds'>> & { id?: string }

export function itemReadinessInputFromState(s: ClientFactsState, ctx: ItemIssueContext): ItemReadinessInput {
  const channels = ctx.channelSet ?? writerChannels(undefined, ctx.channels)
  const assignment = s.assignment ?? { primary: null, additional: [] }
  const model = modelFacts({
    formats: s.formats,
    itemRules: new Map(Object.entries(s.itemRules).map(([k, r]) => [asChannelKey(k), r])),
    assignment,
    tree: writerTree(ctx.tree, []),
    channels,
    timeZone: ctx.timeZone ?? null,
  })
  return {
    id: s.id ?? '',
    profile: s.itemProfile ?? null,
    name: s.name,
    description: s.description ?? {},
    siteLocales: ctx.locales,
    defaultLocale: ctx.defaultLocale,
    photoCount: s.imageIds?.length ?? 0,
    ...model,
    placements: null,
    allergen: { declaration: declarationPatch(s.allergenDeclaration) },
    options: s.options,
    optionFacts: { counts: ctx.optionCounts, unreviewedChoices: [] },
    dependencies: { neverPublished: [], missing: [] },
    page: { hasPage: s.hasPage, slug: s.slug, conflicts: [] },
    bookIsbn: s.bookDetails?.isbn ?? null,
    overrides: [],
    migrations: activationMarkers(ctx.migrations),
  }
}
