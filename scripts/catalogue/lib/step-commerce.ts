// ── D2 — commerce (C10-3, C10-6 D2) ───────────────────────────────────────────
// Pure. Mapping: migrateCommerceDoc / migrateChannelEntries / legacyOfferRefusals
// (commerce/legacy-commerce.ts — the same code the R1 dual-read uses). Verified
// with compareCommerce (commerce/equivalence.ts — the same comparison as the
// synthetic suite and scripts/catalogue/verify-commerce-equivalence.mjs).

import { formatsToLegacyOffers, legacyOfferRefusals, migrateChannelEntries, migrateCommerceDoc, type CatalogueFormatDoc } from '../../../src/lib/modules/catalogue/commerce/legacy-commerce'
import { compareCommerce } from '../../../src/lib/modules/catalogue/commerce/equivalence'
import { isValidChannelKey } from '../../../src/lib/modules/catalogue/commerce/channels'
import { catalogueProjects, docsOfType, groupByBase, idClassOf, sameValue, unchangedExcept, type Doc, type ProjectView } from './docs'
import { allowedFor, check, checksResult, configGroup, guardedPatch, unmarkGroup, type Check, type Finding, type ProjectPlan, type Refusal, type RevertContext, type StepContext, type StepDefinition, type StepPlan } from './step'
import { scoped } from './step-taxonomy'

const entriesOf = (config: Record<string, unknown>): Record<string, unknown>[] =>
  (Array.isArray(config.serviceChannels) ? config.serviceChannels : []).filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')

/** The legacy channel keys exactly as the legacy resolver and the equivalence read them (non-empty `value`s, stored order). */
export const legacyChannelKeys = (config: Record<string, unknown>) =>
  entriesOf(config)
    .map((e) => e.value)
    .filter((v): v is string => typeof v === 'string' && v !== '')

/** Non-conforming legacy channel entries (C10-6 P): missing/invalid/duplicate `value`. */
export function channelEntryRefusals(config: Record<string, unknown>): { index: number; value: unknown; problem: 'missingValue' | 'invalidKey' | 'duplicate' }[] {
  const out: { index: number; value: unknown; problem: 'missingValue' | 'invalidKey' | 'duplicate' }[] = []
  const raw = Array.isArray(config.serviceChannels) ? config.serviceChannels : []
  const seen = new Set<string>()
  raw.forEach((e, index) => {
    const value = e && typeof e === 'object' ? (e as { value?: unknown }).value : undefined
    if (typeof value !== 'string' || value === '') out.push({ index, value: value ?? null, problem: 'missingValue' })
    else if (!isValidChannelKey(value)) out.push({ index, value, problem: 'invalidKey' })
    else if (seen.has(value)) out.push({ index, value, problem: 'duplicate' })
    if (typeof value === 'string') seen.add(value)
  })
  return out
}

const equivalenceProject = (before: ProjectView, after: ProjectView | undefined) => {
  const locale = typeof before.site?.defaultLocale === 'string' && before.site.defaultLocale ? before.site.defaultLocale : 'en'
  return {
    channelsBefore: (before.config.serviceChannels as unknown[] | undefined) ?? null,
    channelsAfter: ((after ?? before).config.serviceChannels as unknown[] | undefined) ?? null,
    currency: (typeof before.config.currency === 'string' && before.config.currency ? before.config.currency : 'EUR').toUpperCase(),
    timeZone: typeof before.site?.timeZone === 'string' ? before.site.timeZone : '',
    locale,
    defaultLocale: locale,
  }
}

/** Class W and the offer refusals of the CURRENT data, read through the R1 dual-read (before = after). */
export function commercePreflight(view: ProjectView, docs: readonly Doc[], acceptVersions: boolean) {
  const items = docsOfType(docs, 'catalogueItem', view.slug)
  const project = equivalenceProject(view, view)
  if (!project.timeZone) return { report: null, items }
  return { report: compareCommerce(items.map((d) => ({ before: d as never, after: d as never })), project, { acceptVersions }), items }
}

function plan(docs: readonly Doc[], ctx: StepContext): StepPlan {
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const slug = view.slug
    const r = (code: string, extra: Partial<Refusal> = {}) => refusals.push({ step: 'commerce', code, project: slug, ...extra })
    for (const bad of channelEntryRefusals(view.config)) r('channel.nonConforming', { detail: bad })
    const keys = legacyChannelKeys(view.config)
    const { report, items } = commercePreflight(view, docs, !!ctx.acceptVersions)
    if (!report) r('site.timeZoneMissing', { detail: { note: 'siteConfig.timeZone is needed to evaluate the reference instants (C10-5)' } })
    else for (const w of report.classW.slice(0, 50)) r('commerce.classW', { id: w.id, detail: w })

    const groups: ProjectPlan['groups'] = []
    let documents = 0
    let prices = 0
    for (const [base, pair] of groupByBase(items)) {
      const mutations: ProjectPlan['groups'][number]['mutations'] = []
      for (const doc of pair) {
        if (idClassOf(doc._id) === 'version' && !ctx.acceptVersions) {
          r('item.versionsPresent', { id: doc._id })
          continue
        }
        for (const refusal of legacyOfferRefusals(Array.isArray(doc.offers) ? doc.offers : [], keys)) r(`offer.${refusal.kind}`, { id: doc._id, detail: refusal })
        if (Array.isArray(doc.formats) && doc.formats.length > 0 && Array.isArray(doc.offers) && doc.offers.length > 0) findings.push({ step: 'commerce', code: 'legacy.offersShadowed', project: slug, id: doc._id })
        const patch = migrateCommerceDoc({ formats: doc.formats, offers: doc.offers }, keys)
        if (!patch) continue
        documents++
        prices += patch.formats.reduce((n, f) => n + f.prices.length, 0)
        mutations.push(guardedPatch(doc, { set: { formats: patch.formats, ...(patch.channelAvailability ? { channelAvailability: patch.channelAvailability } : {}) } }))
      }
      if (mutations.length) groups.push({ key: `item:${base}`, mutations })
    }
    if (keys.length) {
      const cfg = configGroup(
        view,
        `config:${slug}`,
        (config) => {
          const entries = entriesOf(config)
          const next = migrateChannelEntries(entries)
          return sameValue(entries, next) ? null : { ...config, serviceChannels: next }
        },
        refusals,
        'commerce',
      )
      if (cfg.mutations.length) groups.push(cfg)
    }
    projects.push({ slug, groups, counts: { documents, prices, channels: keys.length } })
  }
  return { step: 'commerce', projects, refusals, findings }
}

function verify(before: readonly Doc[], after: readonly Doc[], ctx: StepContext) {
  const eqDiffs: unknown[] = []
  const classW: unknown[] = []
  const keptDiffs: unknown[] = []
  const configDiffs: unknown[] = []
  const afterViews = new Map(catalogueProjects(after).map((v) => [v.slug, v]))
  const afterById = new Map(after.map((d) => [d._id, d]))
  for (const view of catalogueProjects(before)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const project = equivalenceProject(view, afterViews.get(view.slug))
    const items = docsOfType(before, 'catalogueItem', view.slug)
    if (!project.timeZone) {
      eqDiffs.push({ project: view.slug, code: 'site.timeZoneMissing' })
      continue
    }
    const report = compareCommerce(items.map((b) => ({ before: b as never, after: (afterById.get(b._id) ?? b) as never })), project, { acceptVersions: ctx.acceptVersions })
    for (const d of report.diffs) eqDiffs.push({ project: view.slug, ...d })
    for (const x of report.refusals) eqDiffs.push({ project: view.slug, refusal: x })
    for (const w of report.classW) classW.push({ project: view.slug, ...w })
    if (!report.pass && report.diffs.length === 0 && report.refusals.length === 0) eqDiffs.push({ project: view.slug, code: 'versionsUnmapped', counts: report.counts })
    for (const b of items) {
      const a = afterById.get(b._id)
      if (a && !sameValue(b.offers, a.offers)) keptDiffs.push({ id: b._id, note: 'legacy offers must be kept until R3' })
    }
    const entriesBefore = entriesOf(view.config)
    const entriesAfter = entriesOf(afterViews.get(view.slug)?.config ?? {})
    const expected = entriesBefore.length ? migrateChannelEntries(entriesBefore) : entriesBefore
    if (!sameValue(entriesAfter, expected) && !sameValue(entriesAfter, entriesBefore)) configDiffs.push({ project: view.slug, before: entriesBefore, after: entriesAfter })
  }
  const checks: Check[] = [
    check('commerce.equivalence(E1–E9)', eqDiffs),
    check('commerce.classW', classW),
    check('commerce.offersKept', keptDiffs),
    check('commerce.channelEntries', configDiffs),
    check('commerce.unchangedElsewhere', unchangedExcept(scoped(before, ctx), scoped(after, ctx), allowedFor('commerce', after, ctx.project))),
  ]
  return checksResult(checks)
}

function revert(docs: readonly Doc[], ctx: RevertContext): StepPlan {
  // C10-7 after D2: unset formats/channelAvailability where still equal to the D2 output
  // (recomputed from the kept offers) and the two channel attributes (restored from the
  // P′ export). Anything else is lossy → listed, refused without --accept-lossy.
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  const rollbackViews = new Map(catalogueProjects(ctx.rollback ?? []).map((v) => [v.slug, v]))
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const keys = legacyChannelKeys(view.config)
    const groups: ProjectPlan['groups'] = []
    let reverted = 0
    for (const [base, pair] of groupByBase(docsOfType(docs, 'catalogueItem', view.slug))) {
      const mutations: ProjectPlan['groups'][number]['mutations'] = []
      for (const d of pair) {
        if (!Array.isArray(d.formats) || d.formats.length === 0) continue
        const expected = migrateCommerceDoc({ offers: d.offers }, keys)
        const exact = expected && sameValue(d.formats, expected.formats) && sameValue(d.channelAvailability ?? null, expected.channelAvailability ?? null)
        if (exact) {
          mutations.push(guardedPatch(d, { unset: ['formats', 'channelAvailability'] }))
          reverted++
        } else {
          const { lossy } = formatsToLegacyOffers(d.formats as CatalogueFormatDoc[])
          const entry = { step: 'commerce' as const, code: 'revert.lossy', project: view.slug, id: d._id, detail: { lossy: lossy.length ? lossy : ['changedSinceD2'] } }
          if (ctx.acceptLossy) findings.push(entry)
          else refusals.push(entry)
        }
      }
      if (mutations.length) groups.push({ key: `item:${base}`, mutations })
    }
    const original = rollbackViews.get(view.slug)
    if (keys.length && !original) refusals.push({ step: 'commerce', code: 'revert.rollbackExportMissing', project: view.slug, detail: { note: 'pass --rollback <P′ export> to restore serviceChannels' } })
    const restoreChannels = (config: Record<string, unknown>) =>
      keys.length && original && !sameValue(config.serviceChannels, original.config.serviceChannels) ? { ...config, serviceChannels: original.config.serviceChannels } : null
    const unmark = unmarkGroup(view, 'commerce', refusals, restoreChannels)
    if (unmark.mutations.length) groups.push(unmark)
    projects.push({ slug: view.slug, groups, counts: { reverted } })
  }
  return { step: 'commerce', projects, refusals, findings }
}

export const commerceStep: StepDefinition<'migration.commerce'> = {
  step: 'commerce',
  auditKind: 'migration.commerce',
  requires: ['taxonomy'],
  plan,
  verify,
  auditDetail(slug, _before, after, ctx) {
    const items = docsOfType(after, 'catalogueItem', slug)
    const migrated = items.filter((d) => Array.isArray(d.formats) && d.formats.length > 0)
    const formats = migrated.flatMap((d) => d.formats as CatalogueFormatDoc[])
    return {
      migrationId: ctx.migrationId,
      items: migrated.length,
      formats: formats.length,
      prices: formats.reduce((n, f) => n + (Array.isArray(f.prices) ? f.prices.length : 0), 0),
      legacyOffersKept: migrated.filter((d) => Array.isArray(d.offers) && d.offers.length > 0).length,
      equivalence: ctx.verification.checks.filter((c) => c.name.startsWith('commerce.equivalence') || c.name === 'commerce.classW').every((c) => c.pass) ? 'verified' : 'diffNonEmpty',
    }
  },
  revert,
}
