// ── D4 — navLabel → publicName (C11.5 R-A2, C10-6 D4) ────────────────────────
// Pure. Mapping: planPublicNameMigration (public-name.ts — the one plan).
//   copy → write `publicName` (every non-empty locale, trimmed) and unset `navLabel`;
//   drop → unset `navLabel` only (discarded values audited);
//   none → nothing, except a blank `navLabel` object is still unset (C11.5).
// The only non-additive data step; safe because R1 removed every reader. Runs last.

import { planPublicNameMigration, publicNameMap, resolvePublicName } from '../../../src/lib/modules/catalogue/public-name'
import { catalogueInstallation, catalogueProjects, sameValue, unchangedExcept, type Doc } from './docs'
import { allowedFor, check, checksResult, configGroup, unmarkGroup, type Finding, type ProjectPlan, type Refusal, type RevertContext, type StepContext, type StepDefinition, type StepPlan } from './step'
import { scoped } from './step-taxonomy'

/** The config after D4 (same function for the published and the draft copy). null = no change. */
export function publicNameConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  const plan = planPublicNameMigration(config)
  const hasNav = Object.prototype.hasOwnProperty.call(config, 'navLabel')
  if (plan.action === 'none' && !hasNav) return null
  const { navLabel: _nav, ...rest } = config
  void _nav
  if (plan.action === 'copy') return { ...rest, publicName: { _type: 'localizedString', ...plan.publicName } }
  return rest
}

const localesOf = (site: Doc | null): string[] => (Array.isArray(site?.supportedLocales) ? (site!.supportedLocales as unknown[]).filter((l): l is string => typeof l === 'string') : [])
const defaultLocaleOf = (site: Doc | null) => (typeof site?.defaultLocale === 'string' && site.defaultLocale ? site.defaultLocale : 'en')

function plan(docs: readonly Doc[], ctx: StepContext): StepPlan {
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const p = planPublicNameMigration(view.config)
    const locales = localesOf(view.site)
    if (p.action === 'copy') {
      const extra = Object.keys(p.publicName).filter((l) => locales.length && !locales.includes(l))
      findings.push({ step: 'publicName', code: 'publicName.copy', project: view.slug, detail: { publicName: p.publicName, ...(extra.length ? { localesNotOnSite: extra } : {}) } })
    } else if (p.action === 'drop') {
      const existing = publicNameMap(view.config.publicName)
      const lost = Object.keys(p.discarded).filter((l) => !(l in existing))
      findings.push({ step: 'publicName', code: lost.length ? 'publicName.partialDrop' : 'publicName.drop', project: view.slug, detail: { discarded: p.discarded, publicName: existing, ...(lost.length ? { localesWithoutPublicName: lost } : {}) } })
    }
    const group = configGroup(view, `config:${view.slug}`, publicNameConfig, refusals, 'publicName')
    projects.push({ slug: view.slug, groups: group.mutations.length ? [group] : [], counts: { copy: p.action === 'copy' ? 1 : 0, drop: p.action === 'drop' ? 1 : 0 } })
  }
  return { step: 'publicName', projects, refusals, findings }
}

function verify(before: readonly Doc[], after: readonly Doc[], ctx: StepContext) {
  const preserved: unknown[] = []
  const navLeft: unknown[] = []
  const untouched: unknown[] = []
  const afterViews = new Map(catalogueProjects(after).map((v) => [v.slug, v]))
  for (const view of catalogueProjects(before)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const a = afterViews.get(view.slug)
    if (!a) continue
    for (const doc of a.docs) if ('navLabel' in (catalogueInstallation(doc)?.config ?? {})) navLeft.push({ id: doc._id })
    const p = planPublicNameMigration(view.config)
    if (p.action === 'copy') {
      // public-name.preserved: for every locale, the resolved public name equals the old designated word.
      const nav = publicNameMap(view.config.navLabel)
      const defaultLocale = defaultLocaleOf(view.site)
      for (const locale of [...new Set([...localesOf(view.site), ...Object.keys(nav), defaultLocale])].sort()) {
        const want = nav[locale] ?? nav[defaultLocale] ?? null
        const got = resolvePublicName(publicNameMap(a.config.publicName), { locale, defaultLocale }).text
        if (want !== got) preserved.push({ project: view.slug, locale, want, got })
      }
    } else if (!sameValue(view.config.publicName ?? null, a.config.publicName ?? null)) untouched.push({ project: view.slug, before: view.config.publicName ?? null, after: a.config.publicName ?? null })
  }
  return checksResult([
    check('publicName.preserved', preserved),
    check('publicName.navLabelUnset', navLeft),
    check('publicName.existingUntouched', untouched),
    check('publicName.unchangedElsewhere', unchangedExcept(scoped(before, ctx), scoped(after, ctx), allowedFor('publicName', after, ctx.project))),
  ])
}

function revert(docs: readonly Doc[], ctx: RevertContext): StepPlan {
  // C10-7 after D4: restore navLabel from the P′ export (= the audit `old` payload) and
  // unset publicName where it was copied (still equal to the copy of that navLabel).
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  const originals = new Map(catalogueProjects(ctx.rollback ?? []).map((v) => [v.slug, v]))
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const original = originals.get(view.slug)
    if (!original) {
      refusals.push({ step: 'publicName', code: 'revert.rollbackExportMissing', project: view.slug })
      continue
    }
    const copied = planPublicNameMigration(original.config)
    let edited = false
    const restore = (config: Record<string, unknown>) => {
      if (original.config.navLabel === undefined) return null
      const next: Record<string, unknown> = { ...config, navLabel: original.config.navLabel }
      if (copied.action === 'copy' && config.publicName !== undefined) {
        if (sameValue(publicNameMap(config.publicName), copied.publicName)) delete next.publicName
        else edited = true
      }
      return sameValue(next, config) ? null : next
    }
    const group = unmarkGroup(view, 'publicName', refusals, restore)
    if (edited) findings.push({ step: 'publicName', code: 'revert.publicNameEditedSinceD4', project: view.slug, detail: { note: 'publicName was changed after D4 and is kept' } })
    projects.push({ slug: view.slug, groups: group.mutations.length ? [group] : [], counts: { restored: group.mutations.length } })
  }
  return { step: 'publicName', projects, refusals, findings }
}

export const publicNameStep: StepDefinition<'public_name.migrated'> = {
  step: 'publicName',
  auditKind: 'public_name.migrated',
  requires: ['taxonomy', 'commerce', 'packHistory'],
  plan,
  verify,
  auditDetail(slug, before, _after, ctx) {
    const view = catalogueProjects(before).find((v) => v.slug === slug)
    if (!view) return null
    const p = planPublicNameMigration(view.config)
    if (p.action === 'none') return null
    return {
      migrationId: ctx.migrationId,
      action: p.action,
      old: publicNameMap(view.config.navLabel),
      new: p.action === 'copy' ? p.publicName : null,
      discarded: p.action === 'drop' ? p.discarded : null,
    }
  },
  revert,
}
