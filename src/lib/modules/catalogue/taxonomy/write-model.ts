// ── Catalogue taxonomy — the pure write model of CatalogueTaxonomyService (C1.4, C1.7) ──
//
// Pure: no I/O, no clock. Turns validated intent into the STORED rows of
// `catalogue-taxonomy.<slug>` (C1.4 shapes) and back, so the service only reads,
// plans with these and commits one revision-guarded patch. Tree logic is NOT here —
// traversal, cycles, moves, paths and "unused" are tree.ts (the one implementation).

import { websiteLabel } from '@/lib/tag-text'
import { WEEKLY_OVERRIDE_TYPE } from '../commerce/availability-schedule'
import { WEEKDAYS } from '../commerce/windows'
import type { AvailabilityImpact } from '../commerce/impact'
import type { ImpactCounts, ScheduleSummary, RuleSummary } from '../audit/events'
import { LABEL_MAX } from './limits'
import type { CategoryAssignment, CategoryKey, CategoryTree, ChannelAvailabilityRule, ChannelRules } from './types'

export type StoredRow = Record<string, unknown> & { _key?: string; key?: string }

// ── labels ──────────────────────────────────────────────────────────────────

export type LabelIssueCode = 'label_required' | 'label_too_long' | 'label_locale_unknown' | 'label_invalid'

/**
 * Merges label edits into `current`: a string sets that locale (website-label
 * rule: no WORDS IN CAPITALS, spaces collapsed), '' or null removes it. Only the
 * site's locales are accepted; the default locale must remain. Returns the merged
 * map (no `_type`) or the first issue.
 */
export function mergeLabels(
  current: Readonly<Record<string, string>>,
  edits: unknown,
  site: { defaultLocale: string; locales: readonly string[] },
): { ok: true; labels: Record<string, string> } | { ok: false; code: LabelIssueCode; locale?: string } {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return { ok: false, code: 'label_required' }
  const out: Record<string, string> = { ...current }
  for (const [locale, raw] of Object.entries(edits as Record<string, unknown>)) {
    if (!site.locales.includes(locale)) return { ok: false, code: 'label_locale_unknown', locale }
    if (raw === null || raw === undefined || raw === '') {
      delete out[locale]
      continue
    }
    if (typeof raw !== 'string') return { ok: false, code: 'label_invalid', locale }
    const text = websiteLabel(raw).trim()
    if (!text) delete out[locale]
    else if (text.length > LABEL_MAX) return { ok: false, code: 'label_too_long', locale }
    else out[locale] = text
  }
  if (!(out[site.defaultLocale] ?? '').trim()) return { ok: false, code: 'label_required', locale: site.defaultLocale }
  return { ok: true, labels: out }
}

export const storedLabel = (labels: Readonly<Record<string, string>>) => ({ _type: 'localizedString', ...labels })

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** I6: an ACTIVE sibling (same parent) whose folded default-language label equals `label`, other than `exceptKey`. */
export function siblingWithLabel(tree: CategoryTree, parentKey: CategoryKey | null, label: string, defaultLocale: string, exceptKey?: CategoryKey): CategoryKey | null {
  const siblings = parentKey === null ? tree.roots : (tree.childrenOf.get(parentKey) ?? [])
  const want = fold(label)
  for (const k of siblings) {
    if (k === exceptKey) continue
    const node = tree.nodes.get(k)!
    if (node.archivedAt) continue
    if (fold(node.label[defaultLocale] ?? '') === want) return k
  }
  return null
}

// ── rows ────────────────────────────────────────────────────────────────────

/** C5-7 / C5a-2: one complete rule → its stored `catalogueChannelRule` row (`_key` = channel). Never 'inherit'. */
export function ruleRow(channel: string, rule: ChannelAvailabilityRule): Record<string, unknown> {
  return {
    _key: channel,
    _type: 'catalogueChannelRule',
    channel,
    state: rule.state,
    ...(rule.overrides.length > 0 && {
      schedule: rule.overrides.map((o) => ({
        _key: o.key,
        _type: WEEKLY_OVERRIDE_TYPE,
        ...(o.days.length > 0 && { days: [...o.days] }),
        ...(o.from !== null && { from: o.from }),
        ...(o.to !== null && { to: o.to }),
        state: o.state,
      })),
    }),
  }
}

export const ruleRows = (rules: ChannelRules): Record<string, unknown>[] =>
  Object.entries(rules).flatMap(([channel, rule]) => (rule ? [ruleRow(channel, rule)] : []))

/**
 * A NEW category row (C1.4). New categories carry no channel rule (inherit, D-3). `useFor` (D-22,
 * C1.12) only on a new ROOT; an empty list is not stored ("All item types" = absent).
 */
export function newCategoryRow(key: CategoryKey, labels: Readonly<Record<string, string>>, parentKey: CategoryKey | null, order: number, useFor: readonly string[] = []): StoredRow {
  return { _key: key, _type: 'catalogueCategory', key, label: storedLabel(labels), ...(parentKey !== null && { parentKey }), order, ...(parentKey === null && useFor.length > 0 && { useFor: [...useFor] }) }
}

export function newTagRow(key: string, labels: Readonly<Record<string, string>>, order: number, useFor: readonly string[] = []): StoredRow {
  return { _key: key, _type: 'catalogueTag', key, label: storedLabel(labels), order, ...(useFor.length > 0 && { useFor: [...useFor] }) }
}

const rowKey = (r: StoredRow) => (typeof r?.key === 'string' ? r.key : typeof r?._key === 'string' ? r._key : '')

/** Replaces fields of the row with `key` (unknown fields kept); `undefined` in `fields` removes the field. Rows of other keys untouched. */
export function updateRows(rows: readonly StoredRow[], key: string, fields: Readonly<Record<string, unknown>>): StoredRow[] {
  return rows.map((r) => {
    if (rowKey(r) !== key) return r
    const next: StoredRow = { ...r }
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete next[k]
      else next[k] = v
    }
    return next
  })
}

/** Applies a MovePlan's patches (parentKey/order) to the stored rows. */
export function applyMovePatches(rows: readonly StoredRow[], patches: readonly { key: CategoryKey; parentKey: CategoryKey | null; order: number }[]): StoredRow[] {
  let out = [...rows]
  for (const p of patches) out = updateRows(out, p.key, { parentKey: p.parentKey ?? undefined, order: p.order })
  return out
}

export const removeRow = (rows: readonly StoredRow[], key: string): StoredRow[] => rows.filter((r) => rowKey(r) !== key)

/** Sets (rule) or removes (null = "Use category default" / inherit) the channel's row on one category. */
export function setRuleOnRows(rows: readonly StoredRow[], key: CategoryKey, channel: string, rule: ChannelAvailabilityRule | null): StoredRow[] {
  return rows.map((r) => {
    if (rowKey(r) !== key) return r
    const existing = (Array.isArray(r.channelRules) ? r.channelRules : []).filter((x) => {
      const row = x as { channel?: unknown; _key?: unknown } | null
      return row && row.channel !== channel && row._key !== channel
    })
    const next = rule ? [...existing, ruleRow(channel, rule)] : existing
    const out: StoredRow = { ...r }
    if (next.length > 0) out.channelRules = next
    else delete out.channelRules
    return out
  })
}

// ── concurrency (C1.7a) ─────────────────────────────────────────────────────

/** Stable short fingerprint of a JSON-able value (key order independent). Not cryptographic. */
export function fingerprintOf(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).filter((k) => k !== '_rev').sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v
  const text = JSON.stringify(stable(value)) ?? ''
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

/** Per-key fingerprints of stored rows — the `hashes` a list returns and a user op may send back as its base. */
export function rowHashes(rows: readonly StoredRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = rowKey(r)
    if (k && !(k in out)) out[k] = fingerprintOf(r)
  }
  return out
}

/** Keys whose row differs between the caller's base and now (added, removed or changed). */
export function changedKeys(base: Readonly<Record<string, string>> | undefined, now: Readonly<Record<string, string>>): string[] {
  if (!base) return []
  const keys = new Set([...Object.keys(base), ...Object.keys(now)])
  return [...keys].filter((k) => base[k] !== now[k]).sort()
}

// ── item assignment changes ─────────────────────────────────────────────────

/**
 * Removing a category from items (delete with no reassignment target): drop `key`;
 * when it was the primary, the first remaining additional becomes primary (D-15
 * rule: never leave additional without a primary). Only items that change.
 */
export function planUnassign(items: readonly { id: string; assignment: CategoryAssignment }[], key: CategoryKey): { id: string; next: CategoryAssignment }[] {
  const out: { id: string; next: CategoryAssignment }[] = []
  for (const { id, assignment } of items) {
    if (assignment.primary !== key && !assignment.additional.includes(key)) continue
    const rest = assignment.additional.filter((k) => k !== key)
    const next: CategoryAssignment = assignment.primary === key ? { primary: rest[0] ?? null, additional: rest.slice(1) } : { primary: assignment.primary, additional: rest }
    out.push({ id, next })
  }
  return out
}

/** C10-6 R2: the item writer's patch — the new shape, and the legacy list UNSET on the same document. */
export function assignmentPatch(next: CategoryAssignment): { set: Record<string, unknown>; unset: string[] } {
  const set: Record<string, unknown> = {}
  const unset: string[] = ['categories']
  if (next.primary !== null) set.primaryCategory = next.primary
  else unset.push('primaryCategory')
  if (next.additional.length > 0) set.additionalCategories = [...next.additional]
  else unset.push('additionalCategories')
  return { set, unset }
}

// ── audit summaries (C12 §12.3; content-free) ───────────────────────────────

/** Counts and a hash of a rule — never times or labels. */
export function scheduleSummary(rule: ChannelAvailabilityRule): ScheduleSummary {
  const days = new Set<string>()
  for (const o of rule.overrides) for (const d of o.days.length > 0 ? o.days : WEEKDAYS) days.add(d)
  return {
    baseline: rule.state,
    overrides: rule.overrides.length,
    daysCovered: days.size,
    fingerprint: fingerprintOf({ s: rule.state, o: rule.overrides.map((o) => ({ d: o.days, f: o.from, t: o.to, s: o.state })) }),
  }
}

export const ruleSummary = (rule: ChannelAvailabilityRule | null | undefined): RuleSummary => (rule ? scheduleSummary(rule) : 'inherit')

/** C12 `impactCounts`: the audit counts of a C5 `AvailabilityImpact` (the single implementation of the diff). */
export function auditImpactCounts(impact: AvailabilityImpact): ImpactCounts {
  let toAvailable = 0
  let toUnavailable = 0
  for (const c of Object.values(impact.byChannel)) {
    toAvailable += c.gainAvailability
    toUnavailable += c.loseAvailability
  }
  return { items: impact.itemsChanged, formats: impact.formatsChanged, toAvailable, toUnavailable, shieldedByOverride: impact.shieldedByOverride }
}
