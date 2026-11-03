// ── Readiness gaps for list rows and the editor badges (C6 §6.6, §6.10; pure) ─
//
// C6 §6.6 supersedes `itemGaps`: the list's "missing" badges are derived from
// the readiness engine — noPhoto ← photoMissing, noPrice ← priceMissing (website
// context), allergensNotReviewed ← allergenReview, noCategory ← categoryMissing
// (+ noPrimaryCategory ← primaryCategoryMissing, §6.10). So a badge and the
// publish gate can never disagree.
//
// Activation (C10-6 step 7): in a project whose taxonomy + commerce markers are
// not both set, the engine's category and price rules are off; the badges then
// stay exactly what they were (`itemGaps`, the legacy counts), never fewer.

import { itemGaps, type ItemGap } from '../dashboard-form'
import { WEBSITE, evaluateItem } from './engine'
import { modelRulesActive } from './facts-model'
import type { CatalogueMigrationState } from '../schema-commerce'
import type { ItemReadinessInput, ReadinessCode, ReadinessResult } from './types'

/** Badge → the finding codes that raise it. The ONLY place this mapping exists. */
export const GAP_CODES: Readonly<Record<ItemGap, readonly ReadinessCode[]>> = Object.freeze({
  noPhoto: ['photoMissing'],
  noPrice: ['priceMissing'],
  allergensNotReviewed: ['allergenReview'],
  noCategory: ['categoryMissing'],
  noPrimaryCategory: ['primaryCategoryMissing'],
  profileMismatch: ['profileMismatch'],
})

const GAP_ORDER: readonly ItemGap[] = ['noPhoto', 'noPrice', 'allergensNotReviewed', 'noCategory', 'noPrimaryCategory', 'profileMismatch']

/** The badges of one readiness result (required ∪ recommended; an overridden finding raises none). */
export function gapsFromResult(r: Pick<ReadinessResult, 'required' | 'recommended'>): ItemGap[] {
  const codes = new Set([...r.required, ...r.recommended].map((f) => f.code))
  return GAP_ORDER.filter((g) => GAP_CODES[g].some((c) => codes.has(c)))
}

/**
 * The badges for one item: the engine (website context) in a migrated project; the legacy
 * `itemGaps` counts elsewhere (R1 behaviour, unchanged).
 */
export function readinessGaps(
  migrations: CatalogueMigrationState | null | undefined,
  engineInput: () => ItemReadinessInput,
  legacy: Parameters<typeof itemGaps>[0],
): ItemGap[] {
  if (!modelRulesActive(migrations)) {
    // D-22: the profile rule is active in every project (activation 'always'), so its badge is too.
    const gaps = itemGaps(legacy)
    return engineInput().profileFindings?.length ? [...gaps, 'profileMismatch'] : gaps
  }
  return gapsFromResult(evaluateItem(engineInput(), WEBSITE))
}
