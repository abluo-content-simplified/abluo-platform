// ── Starter Structures + food-and-drink setup — the pure screen model (C7, brief §6) ──
//
// No I/O, no React. Selection edits (what the person ticks, renames, adds, how they answer a
// "looks like yours" proposal), the rows the review / availability steps render, and the counts of
// the summary ("2 service channels, 14 categories, 1 menu, 7 sections, 3 option groups"). Every
// number comes from the SERVER plan (planPack) — nothing here decides what a pack adds.

import { deriveTermKey } from '@/lib/taxonomy/rules'
import type { ChannelAvailabilityRule } from '@/lib/modules/catalogue/commerce/commerce-types'
import { defaultSelection, type PackPlan, type PackSelection, type PlanItem } from '@/lib/modules/catalogue/packs/plan'
import type { PackDeclaration, PackLocalized } from '@/lib/modules/catalogue/packs/types'
import type { Localized } from '@/lib/modules/catalogue/taxonomy/types'

export { defaultSelection }

/** A pack's own text (name, description) in the interface language, English otherwise. */
export const packText = (l: PackLocalized, ui: string): string => l[ui] ?? l.en

/** A planned element's name in the website's main language (what will be created). */
export const itemText = (label: PlanItem['label'] | Localized, locale: string, defaultLocale: string): string => {
  const l = label as Record<string, string | undefined>
  return l[locale] || l[defaultLocale] || Object.values(l).find((v) => typeof v === 'string' && v) || ''
}

// ── selection edits ──────────────────────────────────────────────────────────

const toggle = (list: readonly string[], value: string, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((x) => x !== value))

export const withChannel = (s: PackSelection, key: string, on: boolean): PackSelection => ({ ...s, acceptChannels: toggle(s.acceptChannels, key, on) })
export const withIncluded = (s: PackSelection, ref: string, on: boolean): PackSelection => ({ ...s, exclude: toggle(s.exclude, ref, !on) })
export const withSchedules = (s: PackSelection, on: boolean): PackSelection => ({ ...s, channelRules: on ? 'apply' : 'skip' })
export const withSetting = (s: PackSelection, key: PackSelection['acceptSettings'][number], on: boolean): PackSelection => ({ ...s, acceptSettings: toggle(s.acceptSettings, key, on) as PackSelection['acceptSettings'] })

/** "Use yours" / "Add anyway" for a label proposal. */
export function withResolution(s: PackSelection, area: 'category' | 'tag', packKey: string, use: { use: 'existing'; key: string } | { use: 'add' }): PackSelection {
  return { ...s, resolutions: { ...s.resolutions, [`${area}:${packKey}`]: use } }
}

/** A rename in the review step: only filled languages count; an empty rename removes it. */
export function withRename(s: PackSelection, ref: string, labels: Localized): PackSelection {
  const clean = Object.fromEntries(Object.entries(labels).flatMap(([l, v]) => (typeof v === 'string' && v.trim() ? [[l, v.trim()]] : [])))
  const next = { ...(s.labels ?? {}) }
  if (Object.keys(clean).length) next[ref] = clean
  else delete next[ref]
  return { ...s, labels: next }
}

/** A key for the person's own category or tag, made from its name and unique among `taken`. */
export function extraKey(label: string, taken: ReadonlySet<string>): string | null {
  if (!label.trim()) return null
  return deriveTermKey(label, [...taken]) || null
}

export function withExtraCategory(s: PackSelection, pack: PackDeclaration, plan: PackPlan | null, label: Localized, parent: string | null, defaultLocale: string): PackSelection {
  const taken = new Set([...pack.categories.map((c) => c.key), ...(s.extras?.categories ?? []).map((c) => c.key), ...(plan ? [...plan.add, ...plan.equivalent, ...plan.skipped].filter((i) => i.area === 'category').map((i) => i.key) : [])])
  const key = extraKey(label[defaultLocale] ?? '', taken)
  if (!key) return s
  return { ...s, extras: { ...s.extras, categories: [...(s.extras?.categories ?? []), { key, label, parent }] } }
}

export function withExtraTag(s: PackSelection, pack: PackDeclaration, label: Localized, defaultLocale: string): PackSelection {
  const taken = new Set([...pack.tags.map((t) => t.key), ...(s.extras?.tags ?? []).map((t) => t.key)])
  const key = extraKey(label[defaultLocale] ?? '', taken)
  if (!key) return s
  return { ...s, extras: { ...s.extras, tags: [...(s.extras?.tags ?? []), { key, label }] } }
}

export function withoutExtra(s: PackSelection, area: 'category' | 'tag', key: string): PackSelection {
  const ex = s.extras ?? {}
  return { ...s, extras: area === 'category' ? { ...ex, categories: (ex.categories ?? []).filter((c) => c.key !== key && c.parent !== key) } : { ...ex, tags: (ex.tags ?? []).filter((t) => t.key !== key) } }
}

export const isExtra = (s: PackSelection, area: 'category' | 'tag', key: string) => (area === 'category' ? (s.extras?.categories ?? []) : (s.extras?.tags ?? [])).some((x) => x.key === key)

// ── rows ─────────────────────────────────────────────────────────────────────

export type RowStatus = 'add' | 'equivalent' | 'skipped'
export type CategoryRow = { key: string; label: PlanItem['label']; depth: number; status: RowStatus; mappedTo?: string; archived: boolean; ref: string }

/** The category tree of a plan in pack order (added, already there, or unticked), with depth for indenting. */
export function categoryRows(plan: PackPlan): CategoryRow[] {
  const all = [...plan.add.map((i) => [i, 'add'] as const), ...plan.equivalent.map((i) => [i, 'equivalent'] as const), ...plan.skipped.filter((i) => i.note !== 'excluded' || !i.rules).map((i) => [i, 'skipped'] as const)].filter(([i]) => i.area === 'category')
  const parentOf = new Map(all.map(([i]) => [i.key, i.parentKey ?? null]))
  const depth = (k: string, seen = new Set<string>()): number => {
    const p = parentOf.get(k)
    if (!p || seen.has(p) || !parentOf.has(p)) return 0
    seen.add(p)
    return 1 + depth(p, seen)
  }
  const seen = new Set<string>()
  const rows: CategoryRow[] = []
  // tree order: parents before children, siblings in plan order
  const visit = (parent: string | null) => {
    for (const [i, status] of all) {
      if (seen.has(i.key) || (i.parentKey ?? null) !== parent) continue
      if (parent === null && i.parentKey && parentOf.has(i.parentKey)) continue
      seen.add(i.key)
      rows.push({ key: i.key, label: i.label, depth: depth(i.key), status, ...(i.mappedTo && { mappedTo: i.mappedTo }), archived: i.note === 'archived_in_project', ref: `category:${i.key}` })
      visit(i.key)
    }
  }
  visit(null)
  for (const [i, status] of all) if (!seen.has(i.key)) rows.push({ key: i.key, label: i.label, depth: 0, status, archived: i.note === 'archived_in_project', ref: `category:${i.key}` })
  return rows
}

export type SimpleRow = { key: string; label: PlanItem['label']; status: RowStatus; ref: string; parentKey?: string | null; note?: PlanItem['note'] }
export function rowsOf(plan: PackPlan, area: 'tag' | 'collection' | 'section' | 'optionGroup' | 'formatSuggestion' | 'channelSuggestion'): SimpleRow[] {
  const out: SimpleRow[] = []
  const push = (items: readonly PlanItem[], status: RowStatus) => {
    for (const i of items) if (i.area === area) out.push({ key: i.key, label: i.label, status, ref: area === 'section' ? `section:${i.parentKey}.${i.key}` : `${area}:${i.key}`, parentKey: i.parentKey, note: i.note })
  }
  push(plan.add, 'add')
  push(plan.equivalent, 'equivalent')
  push(plan.skipped, 'skipped')
  return out
}

/** The channels active after applying: existing active ones (equivalent and switched on are not known here: the caller passes them) + ticked. */
export type AvailabilityCell = { channel: string; rule: ChannelAvailabilityRule | null; ref: string; included: boolean }
export type AvailabilityRow = { key: string; label: PlanItem['label']; depth: number; cells: AvailabilityCell[] }

/**
 * Category tree × active channels (brief §6 step 4): the complete rule a NEW category gets on each
 * active channel (null = inherits the channel default), and the rules the person unticked.
 */
export function availabilityRows(plan: PackPlan, channels: readonly string[]): AvailabilityRow[] {
  const rows = categoryRows(plan).filter((r) => r.status === 'add')
  return rows.map((r) => {
    const item = plan.add.find((i) => i.area === 'category' && i.key === r.key)!
    const skipped = plan.skipped.filter((i) => i.area === 'category' && i.key === r.key && i.rules)
    return {
      key: r.key,
      label: r.label,
      depth: r.depth,
      cells: channels.map((ch) => {
        const on = item.rules?.find((x) => x.channel === ch)
        const off = skipped.flatMap((s) => s.rules ?? []).find((x) => x.channel === ch)
        return { channel: ch, rule: on?.rule ?? off?.rule ?? null, ref: `rule:${r.key}:${ch}`, included: !!on }
      }),
    }
  })
}

// ── summary ──────────────────────────────────────────────────────────────────

export type PlanCounts = { channels: number; categories: number; tags: number; menus: number; lists: number; sections: number; optionGroups: number; formats: number; equivalent: number }

export function planCounts(plan: PackPlan, pack: PackDeclaration): PlanCounts {
  const n = (area: string) => plan.add.filter((i) => i.area === area).length
  const added = plan.add.filter((i) => i.area === 'collection').map((i) => pack.collections.find((c) => c.key === i.key)?.collectionType)
  return {
    channels: n('channelSuggestion'),
    categories: n('category'),
    tags: n('tag'),
    menus: added.filter((t) => t === 'menu').length,
    lists: added.filter((t) => t === 'list').length,
    sections: n('section'),
    optionGroups: n('optionGroup'),
    formats: n('formatSuggestion'),
    equivalent: plan.equivalent.length,
  }
}

/** The blocking conflicts in the order the screen explains them. */
export const blockingConflicts = (plan: PackPlan) => plan.conflicts.filter((c) => c.blocking)
