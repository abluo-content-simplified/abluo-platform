// ── Readiness facts from the R2 item model (C6 §6.6/§6.7; pure, browser-safe) ──
//
// ONE builder of the model-dependent facts — categories (C1) and formats /
// availability / prices (C3–C5) — used by BOTH the client facts builder
// (`itemReadinessInputFromState`, the editor) and the server/Studio one
// (`itemReadinessInputFromDoc`, the publish gate). Same model in, same facts
// out (fixture R-30): the two only differ in how they obtain the model (form
// state vs stored document), never in how they judge it.
//
// Rule activation is decided here, per project, by the C10-6 markers (C6
// §6.13 item 2, C10-6 step 7): the model-dependent rules turn on only when
// BOTH `catalogueMigrations.taxonomy` and `.commerce` are set for the project
// (projects created after R2 are born with both). Until then `migrations` is
// empty and the engine runs exactly the R1 rules.

import { availableSometime, scheduleIssues, weekProfile } from '../commerce/availability-schedule'
import { CATEGORY_RULES, availabilityInputsOf, effectiveRule, type AvailabilityInputs } from '../commerce/channel-availability'
import type { ChannelSet } from '../commerce/channels'
import type { ChannelAvailabilityRule, ChannelKey, OfferingContext } from '../commerce/commerce-types'
import type { Format } from '../commerce/formats'
import { priceCoverage, priceIssues } from '../commerce/prices'
import { categoryAssignmentState, primaryPath } from '../taxonomy/tree'
import type { CategoryAssignment, CategoryTree } from '../taxonomy/types'
import type { CatalogueMigrationState } from '../schema-commerce'
import type { ItemProfile } from '../profiles'
import { incompatibleAssignments, type ApplicabilityTaxonomy, type OptionListUseFor, type ProfileFinding } from '../taxonomy/profile-applicability'
import { priceIssueFact, type FormatReadinessFacts, type ItemReadinessInput, type PriceIssueFact } from './types'

/** C10-6 step 7: the markers the engine sees — both data steps verified, or none at all. */
export function activationMarkers(m: CatalogueMigrationState | null | undefined): CatalogueMigrationState {
  return m?.taxonomy && m?.commerce ? m : {}
}

/** True when the model-dependent rules are on for this project. */
export const modelRulesActive = (m: CatalogueMigrationState | null | undefined): boolean => !!(m?.taxonomy && m?.commerce)

export type ItemModel = {
  formats: readonly Format[]
  itemRules: ReadonlyMap<ChannelKey, ChannelAvailabilityRule>
  assignment: CategoryAssignment
  tree: CategoryTree
  channels: ChannelSet
  /** The site zone; null = windowed prices cannot be resolved (`price.indeterminate`). */
  timeZone: string | null
  /** Shape problems of stored rows the model readers already dropped (`availability.conflictingRows` …), per item. */
  itemRuleIssues?: readonly string[]
  /** D-22 (C1.12): what the profile-applicability rule needs; absent = no `profileFindings` (rule silent). */
  applicability?: ApplicabilityFacts
}

/** D-22: the item's profile and tag/option assignments, the project's tag and option-list "Use for", and display names. */
export type ApplicabilityFacts = {
  profile: ItemProfile | null
  tags: readonly string[]
  optionListIds: readonly string[]
  taxonomyTags: ApplicabilityTaxonomy['tags']
  optionLists: OptionListUseFor
  /** Display name of a finding's term in the site's main language (fallback: its key). */
  nameOf: (f: ProfileFinding) => string
}

const contextKey = (oc: OfferingContext) => (oc.kind === 'general' ? 'general' : `channel:${oc.channel}`)

/** Per-format facts for one offering context (memoised per context by the caller). */
function formatFacts(model: ItemModel, inputs: AvailabilityInputs, oc: OfferingContext): FormatReadinessFacts[] {
  const item = { itemId: '', primaryCategory: model.assignment.primary, itemRules: model.itemRules, formats: model.formats }
  return model.formats.map((f) => {
    const e = effectiveRule(inputs, item, f.key, oc)
    const issues: PriceIssueFact[] = priceIssues(f, model.channels).map(priceIssueFact)
    // A stored overlap that bypassed the save path resolves to `ambiguous` at runtime (C4-6) — never a pick.
    if (issues.some((i) => i.code === 'price.overlap')) issues.push({ code: 'price.ambiguous' })
    if (model.timeZone === null && f.prices.some((p) => p.windows.length > 0)) issues.push({ code: 'price.indeterminate' })
    // Stored rules this format depends on that a save path would refuse (C5a; a Studio edit, R-row 30).
    const ruleErrors = [...model.itemRules.values(), ...f.availability.values()].flatMap((r) => scheduleIssues(r).filter((i) => i.level === 'error').map((i) => i.code))
    const availabilityIssues = [...new Set([...e.issues, ...((model.itemRuleIssues ?? []) as typeof e.issues), ...ruleErrors])]
    return {
      key: f.key,
      availability: { issues: availabilityIssues },
      everAvailable: availableSometime(e.rule),
      priceCoverage: priceCoverage(f, oc, model.channels, weekProfile(e.rule)),
      priceIssues: issues,
    }
  })
}

/** The model-dependent members of an ItemReadinessInput. */
export function modelFacts(model: ItemModel): Pick<ItemReadinessInput, 'categories' | 'categoryTree' | 'categoryState' | 'primaryPath' | 'formats' | 'profileFindings'> {
  const inputs = availabilityInputsOf(model.channels, { tree: model.tree, category: CATEGORY_RULES })
  const memo = new Map<string, FormatReadinessFacts[]>()
  return {
    categories: { primary: model.assignment.primary, additional: model.assignment.additional },
    categoryTree: model.tree,
    categoryState: categoryAssignmentState(model.tree, model.assignment),
    primaryPath: primaryPath(model.tree, model.assignment.primary),
    ...(model.applicability && { profileFindings: profileFindingsOf(model, model.applicability) }),
    formats: (oc) => {
      const k = contextKey(oc)
      let v = memo.get(k)
      if (!v) {
        v = formatFacts(model, inputs, oc)
        memo.set(k, v)
      }
      return v
    },
  }
}

/** D-22 (C1.12): the ONE place readiness asks the applicability rule (editor and gate alike, R-30). */
function profileFindingsOf(model: ItemModel, a: ApplicabilityFacts): ReadonlyArray<ProfileFinding & { name: string }> {
  return incompatibleAssignments(
    { profile: a.profile, assignment: model.assignment, tags: a.tags, optionListIds: a.optionListIds },
    { tree: model.tree, tags: a.taxonomyTags },
    a.optionLists,
  ).map((f) => ({ ...f, name: a.nameOf(f) }))
}

/** Default display names: a category's or tag's label in `defaultLocale` (else any label, else the key); option lists by `listName`. */
export function applicabilityNames(tree: CategoryTree, tags: readonly { key: string; label?: Record<string, string> }[], defaultLocale: string, listName: (id: string) => string | undefined = () => undefined): (f: ProfileFinding) => string {
  const pick = (label: Record<string, string> | undefined, key: string) => label?.[defaultLocale]?.trim() || Object.values(label ?? {}).find((v) => v?.trim()) || key
  return (f) => {
    if (f.kind === 'primary' || f.kind === 'additional') return pick(tree.nodes.get(f.key)?.label, f.key)
    if (f.kind === 'tag') return pick(tags.find((t) => t.key === f.key)?.label, f.key)
    return listName(f.key) || f.key
  }
}
