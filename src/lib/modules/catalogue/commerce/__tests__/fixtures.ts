/**
 * Shared fixtures for the commerce contract tests (C2-C5-C10, Rev 4).
 *
 * `fakeTaxonomy` is the REAL C1 category level (CATEGORY_RULES:
 * taxonomy/tree.ts categoryChannelRule / primaryPath) and `tree()` builds the
 * fixture tree with C1's buildTree — the C5 fixtures run against C1 itself.
 */
import { channelSetOf, type Channel } from '../channels'
import { CATEGORY_RULES, type AvailabilityInputs, type CategoryRuleLookup, type ItemAvailabilityInput } from '../channel-availability'
import { asChannelKey, asFormatKey, type ChannelAvailabilityRule, type ChannelAvailabilityState, type ChannelKey, type WeeklyOverride } from '../commerce-types'
import type { Format } from '../formats'
import type { Price } from '../prices'
import { buildTree } from '../../taxonomy/tree'
import type { CategoryNode, CategoryTree } from '../../taxonomy/types'

export const ZONE = 'Europe/Rome'
export const ck = asChannelKey
export const fk = asFormatKey

export const at = (iso: string) => new Date(iso)

export function channel(key: string, defaultAvailability: ChannelAvailabilityState, opts: { active?: boolean; schedule?: WeeklyOverride[]; label?: string } = {}): Channel {
  return {
    key: ck(key),
    label: { en: opts.label ?? key },
    active: opts.active ?? true,
    defaultAvailability,
    defaultSchedule: opts.schedule ?? [],
    entryKey: key,
    explicitDefault: true,
  }
}

export const weekly = (key: string, state: ChannelAvailabilityState, from: string | null, to: string | null, days: WeeklyOverride['days'] = []): WeeklyOverride => ({ kind: 'weekly', key, days, from, to, state })
export const rule = (state: ChannelAvailabilityState, overrides: WeeklyOverride[] = []): ChannelAvailabilityRule => ({ state, overrides })

export function tree(nodes: { key: string; parent?: string | null; rules?: Record<string, ChannelAvailabilityRule> }[]): CategoryTree {
  return buildTree(
    nodes.map((n, i) => ({ key: n.key, label: { en: n.key }, parentKey: n.parent ?? null, order: (i + 1) * 1000, channelRules: (n.rules ?? {}) as CategoryNode['channelRules'], defaultOptionListIds: [], archivedAt: null })),
  )
}

/** The real C1 category level (taxonomy/tree.ts) — formerly a test double. */
export const fakeTaxonomy: CategoryRuleLookup = CATEGORY_RULES

export function format(key: string, opts: { label?: string | null; prices?: Price[]; rules?: Record<string, ChannelAvailabilityRule>; implicit?: boolean } = {}): Format {
  return {
    key: fk(key),
    label: opts.label === undefined ? { en: key } : opts.label === null ? null : { en: opts.label },
    identifiers: {},
    quantity: null,
    templateKey: null,
    availability: new Map(Object.entries(opts.rules ?? {}).map(([c, r]) => [ck(c), r])),
    prices: opts.prices ?? [],
    implicit: opts.implicit ?? false,
  }
}

export const implicitFormat = (prices: Price[] = []) => format('default', { label: null, prices, implicit: true })

export const price = (key: string, amount: number, opts: { scope?: string; windows?: Price['windows'] } = {}): Price => ({
  key,
  scope: opts.scope ? ck(opts.scope) : null,
  amount,
  note: null,
  windows: opts.windows ?? [],
})

export function item(opts: { id?: string; primary?: string | null; rules?: Record<string, ChannelAvailabilityRule>; formats?: Format[] } = {}): ItemAvailabilityInput & { formats: Format[] } {
  return {
    itemId: opts.id ?? 'i1',
    primaryCategory: opts.primary ?? null,
    itemRules: new Map<ChannelKey, ChannelAvailabilityRule>(Object.entries(opts.rules ?? {}).map(([c, r]) => [ck(c), r])),
    formats: opts.formats ?? [implicitFormat()],
  }
}

// ── The C5-9 fixture project ──────────────────────────────────────────────────
// channels dine-in (default available), takeaway (default available), delivery (default unavailable), room (inactive).
// Tree: food › pizza › bianche; food.delivery = available; pizza.delivery = unavailable; bianche none;
// drinks (root) {takeaway: unavailable}; dinner (root) {dine-in: baseline unavailable, every day 18:00–23:00 available}.
export const DINNER_RULE = rule('unavailable', [weekly('d1', 'available', '18:00', '23:00')])
export const C5_TREE = tree([
  { key: 'food', rules: { delivery: rule('available') } },
  { key: 'pizza', parent: 'food', rules: { delivery: rule('unavailable') } },
  { key: 'bianche', parent: 'pizza' },
  { key: 'drinks', rules: { takeaway: rule('unavailable') } },
  { key: 'dinner', rules: { 'dine-in': DINNER_RULE } },
])
export const C5_CHANNELS = channelSetOf([
  channel('dine-in', 'available'),
  channel('takeaway', 'available'),
  channel('delivery', 'unavailable'),
  channel('room', 'available', { active: false }),
])
export const inputs = (channels = C5_CHANNELS, t: CategoryTree = C5_TREE): AvailabilityInputs => ({ channels, tree: t, category: fakeTaxonomy })

export const MON_0800 = at('2026-11-02T07:00:00Z')
export const MON_1100 = at('2026-11-02T10:00:00Z')
export const MON_1759 = at('2026-11-02T16:59:00Z')
export const MON_1800 = at('2026-11-02T17:00:00Z')
export const MON_2300 = at('2026-11-02T22:00:00Z')
export const FRI_2200 = at('2026-11-06T21:00:00Z')
export const SAT_0100 = at('2026-11-07T00:00:00Z')
export const SAT_0200 = at('2026-11-07T01:00:00Z')
export const SUN_1200 = at('2026-11-08T11:00:00Z')
