/**
 * The Catalogue server publication gate (C6 §6.7, step 1: extracted UNCHANGED
 * from `cataloguePrepare` in catalogue-drafts.ts).
 *
 * `cataloguePublishGate(site, uuid)` returns the `prepare` callback that
 * `lifecycle.publishTogether` runs for the root and every dependency BEFORE
 * anything is written, and that `previewCataloguePublish` runs per node. It is
 * the ONLY server gate for a Catalogue publish; it lives in its own module so
 * the Studio break-glass route (C9 §9.5, not in R1) can import the same
 * function without importing the whole drafts API (test T-6).
 *
 * R1 is a pure move: same checks, same order, same CatalogueErrorCode for every
 * refusal (G-01 golden table in __tests__/catalogue-publish-gate.test.ts).
 *
 * Not in R1 (recorded, C6 §6.7 step 2 and §6.7.2):
 *  - switching the inline checks to the readiness engine via `loadNodeFacts` +
 *    `evaluateNode` with the LEGACY_ERROR_CODE mapping and the new `not_ready`
 *    code — needs the server facts loader over the C1/C3/C4 model. NOTE for
 *    that step: the engine's registry order (pageAddressInvalid → strayAddress
 *    → pageAddressTaken) differs from this gate's order (slug_without_name →
 *    slug_taken → missing_slug), and `missing_slug` is judged AFTER automatic
 *    slug generation; mapping "the first required finding" therefore changes
 *    the reported code in multi-problem cases and must be decided explicitly.
 *  - re-exposure (`mode: 'reexpose'`): the hook point is
 *    `LifecycleDescriptor.reexposeCheck?: (published, x) => Promise<void>`, set
 *    by the Catalogue descriptors, calling this gate with only
 *    `REEXPOSE_SAFETY_SUBSET` (readiness/rules.ts, D-15).
 */
import type { sanityWriteClient } from '@/lib/sanity/server-clients'
import { span } from '@/lib/perf/timing'
import * as lifecycle from '@/lib/lifecycle/service'
import type { Referrer } from '@/lib/lifecycle/service'
import { isPublishableDeclaration, unreviewedChoices } from '@/lib/modules/catalogue/allergens'
import { CatalogueError, slugsForPublish, slugLocalesWithoutName, type CatalogueKind } from '@/lib/modules/catalogue/dashboard-patch'
import { can, profileOf } from '@/lib/modules/catalogue/profiles'
import { SLUG_NAMESPACE_QUERY, namedSlugConflicts, toSlugOwners, type SlugRow } from '@/lib/modules/catalogue/validation'
import { CATALOGUE_FOOD_USERS_COUNT_QUERY, CATALOGUE_OPTION_LIST_CHOICES_QUERY } from '@/lib/modules/catalogue/dashboard-queries'
import type { CatalogueSite } from '@/lib/api/catalogue-drafts'
import { readChannels } from '@/lib/modules/catalogue/commerce/channels'
import { buildTree } from '@/lib/modules/catalogue/taxonomy/tree'
import { WEBSITE, evaluateItem } from '@/lib/modules/catalogue/readiness/engine'
import { MODEL_DEPENDENT_RULES, itemReadinessInputFromDoc } from '@/lib/modules/catalogue/readiness/facts-doc'
import { modelRulesActive } from '@/lib/modules/catalogue/readiness/facts-model'
import type { Finding } from '@/lib/modules/catalogue/readiness/types'

/**
 * C10-6 step 7 / C6 §6.13 item 2: in a project whose taxonomy AND commerce data steps are verified
 * (`catalogueMigrations`), an item also needs the model-dependent required findings cleared —
 * main category (D-15: required when publishing a new version), price/availability shape, and the
 * model's integrity rules. Elsewhere this returns [] and the gate behaves exactly as in R1.
 */
export function modelReadinessBlockers(site: Pick<CatalogueSite, 'defaultLocale' | 'locales' | 'timeZone'> & { config: Pick<CatalogueSite['config'], 'serviceChannels' | 'categoryNodes' | 'migrations'> }, id: string, draft: Record<string, unknown>): Finding[] {
  if (!modelRulesActive(site.config?.migrations)) return []
  const input = itemReadinessInputFromDoc(draft, {
    id,
    defaultLocale: site.defaultLocale,
    locales: site.locales,
    channels: readChannels(site.config.serviceChannels).channels,
    tree: buildTree(site.config.categoryNodes ?? []),
    timeZone: site.timeZone,
    migrations: site.config.migrations,
  })
  return evaluateItem(input, WEBSITE, { families: ['standard', 'integrity'], rules: MODEL_DEPENDENT_RULES }).required
}

type FetchClient = Pick<typeof sanityWriteClient, 'fetch'>

export const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])
/** Lifecycle fields live on the published version only (ADR-032): never copied from a draft on publish. */
export const LIFECYCLE_FIELDS = new Set(['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'])
const RAW = { perspective: 'raw' } as const

export const KIND_OF_TYPE: Record<string, CatalogueKind> = { catalogueItem: 'item', catalogueCollection: 'collection', catalogueOptionList: 'optionList' }

export function localized(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!k.startsWith('_') && typeof v === 'string' && v.trim()) out[k] = v
  return out
}

export const slugMap = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object') return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const c = (v as { current?: unknown } | null)?.current
    if (!k.startsWith('_') && typeof c === 'string' && c) out[k] = c
  }
  return out
}

/** Every item and collection slug of the project (D11 shared namespace), named. */
export async function catalogueSlugNamespace(client: FetchClient, projectSlug: string) {
  const rows = await span('sanity.namespace', () => client.fetch<SlugRow[] | null>(SLUG_NAMESPACE_QUERY, { projectSlug }, RAW))
  return toSlugOwners(rows ?? [])
}

/** The module's validation of one document of a publish; returns the published version to write. */
export function cataloguePublishGate(site: CatalogueSite, uuid: () => string) {
  const taken = new Map<string, Set<string>>()
  let owners: Awaited<ReturnType<typeof catalogueSlugNamespace>> | null = null
  return async (node: lifecycle.PublishNode, x: { client: lifecycle.LifecycleClient; projectSlug: string }): Promise<lifecycle.Doc> => {
    const kind = KIND_OF_TYPE[node.d.type]
    const draft = node.draft
    const named = (e: CatalogueError) =>
      node.isRoot || e.detail?.dependencies ? e : new CatalogueError(e.code, e.message, { ...e.detail, dependencies: [{ id: node.id, type: node.d.type, label: node.d.label?.(draft) ?? node.id }] })
    try {
      const d = site.defaultLocale
      const names = localized(draft.name)
      if (!names[d]?.trim()) throw new CatalogueError('missing_name', 'Add a name in the main language first.')
      if (kind === 'optionList' && !(Array.isArray(draft.options) && draft.options.length > 0)) throw new CatalogueError('no_options', 'Add at least one option.')
      // D-3: a food item publishes only with a reviewed, complete allergen declaration.
      if (kind === 'item' && can(profileOf(draft.itemProfile), 'foodInformation') && !isPublishableDeclaration(draft.allergenDeclaration)) {
        throw new CatalogueError('allergens_not_reviewed', 'Review the allergens first.')
      }
      // D-3a: every free-text "add" choice a food item offers must be reviewed.
      if (kind === 'item' && can(profileOf(draft.itemProfile), 'foodInformation')) {
        const ids = [...new Set((Array.isArray(draft.optionLists) ? draft.optionLists : []).map((a) => (a as { list?: { _ref?: unknown } })?.list?._ref).filter((r): r is string => typeof r === 'string'))]
        const blocking = await unreviewedChoicesOf(x.client, x.projectSlug, ids)
        if (blocking.length) throw new CatalogueError('option_allergens_not_reviewed', 'Review the allergens of the extras first.', { dependencies: blocking })
      }
      // …and an option list used by a food item cannot go live with an unreviewed one either.
      if (kind === 'optionList' && unreviewedChoices(draft.options as never[]).length) {
        const users = await x.client.fetch<number | null>(CATALOGUE_FOOD_USERS_COUNT_QUERY, { id: node.id, projectSlug: x.projectSlug }, RAW)
        if ((users ?? 0) > 0) throw new CatalogueError('option_allergens_not_reviewed', 'Review the allergens of the extras first.', { dependencies: choiceRefs(node.id, draft) })
      }
      // C6 step 7: the model-dependent rules, only where the project's markers activate them (§6.7.1 `not_ready`).
      if (kind === 'item') {
        const findings = modelReadinessBlockers(site, node.id, draft)
        if (findings.length) throw new CatalogueError('not_ready', 'Complete the item before publishing.', { readiness: findings })
      }
      const doc: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !LIFECYCLE_FIELDS.has(k)) doc[k] = v
      if (kind === 'item' && !can(profileOf(draft.itemProfile), 'foodInformation')) delete doc.allergenDeclaration
      if (kind !== 'optionList') {
        // publicId is set once (AC 29): the published one wins, a missing one is created.
        doc.publicId = (typeof node.published?.publicId === 'string' && node.published.publicId) || (typeof draft.publicId === 'string' && draft.publicId) || uuid()
        if (typeof doc.visibility !== 'string') doc.visibility = 'public'
      }
      if (kind !== 'optionList' && draft.hasPage === true) {
        owners ??= (await catalogueSlugNamespace(x.client, x.projectSlug))
        const others = owners.filter((o) => o.id !== node.id)
        // D-7 / E-3: an address exists only in the languages the name is written in.
        // Publishing never rewrites editorial data — a stray address refuses, naming the language.
        const explicit = slugMap(draft.slug)
        const stray = slugLocalesWithoutName(explicit, names)
        if (stray.length) throw new CatalogueError('slug_without_name', 'An address has no name in its language.', { locales: stray })
        const conflicts = namedSlugConflicts({ id: node.id, hasPage: true, slugs: explicit }, others)
        if (conflicts.length) throw new CatalogueError('slug_taken', 'This address is already used.', { conflicts })
        const slugs = slugsForPublish({
          names,
          slugs: explicit,
          locales: site.locales,
          // Also what this same publish already gave away (two new items named alike).
          taken: (l) => new Set([...others.map((o) => o.slugs[l]).filter((v): v is string => typeof v === 'string'), ...(taken.get(l) ?? [])]),
          fallback: node.id.slice(0, 8),
        })
        if (!slugs[d]) throw new CatalogueError('missing_slug', 'The page needs an address in the main language.')
        for (const [l, v] of Object.entries(slugs)) taken.set(l, new Set([...(taken.get(l) ?? []), v]))
        doc.slug = { _type: 'localizedSlug', ...Object.fromEntries(Object.entries(slugs).map(([l, v]) => [l, { _type: 'slug', current: v }])) }
      }
      return doc
    } catch (e) {
      throw e instanceof CatalogueError ? named(e) : e
    }
  }
}

const textOf = (v: unknown, fallback: string) => {
  const t = localized(v)
  return Object.values(t)[0] ?? fallback
}

/** "Extra · Mozzarella" refs for the unreviewed free-text add choices of one list (links go to the list). */
function choiceRefs(listId: string, list: Record<string, unknown>): Referrer[] {
  const name = textOf(list.name, 'Option list')
  return unreviewedChoices(list.options as never[]).map((c) => ({ id: listId, type: 'catalogueOptionList', label: `${name} · ${textOf((c as { label?: unknown }).label, 'Untitled option')}` }))
}

/** D-3a: unreviewed free-text add choices of these lists — the published version, else the draft (a list published together). */
async function unreviewedChoicesOf(client: FetchClient, projectSlug: string, ids: string[]): Promise<Referrer[]> {
  if (!ids.length) return []
  const rows = await client.fetch<Array<Record<string, unknown> & { _id: string }> | null>(CATALOGUE_OPTION_LIST_CHOICES_QUERY, { projectSlug, ids, draftIds: ids.map((i) => `drafts.${i}`) }, RAW)
  const out: Referrer[] = []
  for (const id of ids) {
    const row = (rows ?? []).find((r) => r._id === id) ?? (rows ?? []).find((r) => r._id === `drafts.${id}`)
    if (row) out.push(...choiceRefs(id, row))
  }
  return out
}
