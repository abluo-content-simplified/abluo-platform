/**
 * The pure write model of CatalogueTaxonomyService (C1.4 stored shapes, C1.7a attribute-path
 * budget, C10-6 R2 item writer shape, C12 content-free summaries).
 */
import { describe, expect, it } from 'vitest'
import { readCategoryNodes } from '../read'
import { buildTree } from '../tree'
import {
  assignmentPatch,
  auditImpactCounts,
  changedKeys,
  fingerprintOf,
  mergeLabels,
  newCategoryRow,
  newTagRow,
  planUnassign,
  rowHashes,
  ruleRow,
  ruleSummary,
  setRuleOnRows,
  siblingWithLabel,
} from '../write-model'
import type { ChannelAvailabilityRule, ScheduledOverride } from '../types'

const site = { defaultLocale: 'en', locales: ['en', 'it', 'de'] }
const over = (key: string, from: string, to: string, days: ScheduledOverride['days'] = []): ScheduledOverride => ({ kind: 'weekly', key, days, from, to, state: 'available' })

describe('rule/stored-shape (C1.11, C5-7)', () => {
  it('a complete rule is one row keyed by its channel; an available/no-schedule row is kept (never collapsed)', () => {
    const rule: ChannelAvailabilityRule = { state: 'unavailable', overrides: [over('dinner', '18:00', '23:00')] }
    expect(ruleRow('delivery', rule)).toEqual({ _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'unavailable', schedule: [{ _key: 'dinner', _type: 'catalogueWeeklyOverride', from: '18:00', to: '23:00', state: 'available' }] })
    expect(ruleRow('delivery', { state: 'available', overrides: [] })).toEqual({ _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'available' })
  })

  it('set / replace / remove a channel row on one category; other channels untouched', () => {
    const rows = [newCategoryRow('food', { en: 'Food' }, null, 1000)]
    const a = setRuleOnRows(rows, 'food', 'delivery', { state: 'available', overrides: [] })
    const b = setRuleOnRows(a, 'food', 'takeaway', { state: 'unavailable', overrides: [] })
    const c = setRuleOnRows(b, 'food', 'delivery', { state: 'unavailable', overrides: [] })
    expect((c[0].channelRules as Array<{ channel: string; state: string }>).map((r) => [r.channel, r.state])).toEqual([['takeaway', 'unavailable'], ['delivery', 'unavailable']])
    expect(setRuleOnRows(setRuleOnRows(c, 'food', 'delivery', null), 'food', 'takeaway', null)[0].channelRules).toBeUndefined()
    expect(buildTree(readCategoryNodes(c)).nodes.get('food')!.channelRules.delivery).toEqual({ state: 'unavailable', overrides: [] })
  })
})

describe('taxonomy/attribute-paths (C1.7a)', () => {
  it('300 categories × 200 tags × 12 channel rules × 14 overrides stay ≤ 150 unique attribute paths; no data-named keys', () => {
    const channels = Array.from({ length: 12 }, (_, i) => `ch${i}`)
    const overrides = Array.from({ length: 14 }, (_, i) => over(`o${i}`, `${String(i).padStart(2, '0')}:00`, `${String(i).padStart(2, '0')}:30`, ['mon']))
    let categories = Array.from({ length: 300 }, (_, i) => newCategoryRow(`c${i}`, { en: `C${i}`, it: `C${i}`, de: `C${i}` }, i === 0 ? null : `c${Math.floor(i / 3)}`, 1000))
    for (const ch of channels) categories = categories.map((r) => setRuleOnRows([r], String(r.key), ch, { state: 'unavailable', overrides })[0])
    const tags = Array.from({ length: 200 }, (_, i) => newTagRow(`t${i}`, { en: `T${i}`, it: `T${i}` }, 1000))
    const doc = { _id: 'catalogue-taxonomy.p', _type: 'catalogueTaxonomy', projectSlug: 'p', categories, tags, updatedAt: 'x', updatedBy: 'u' }
    const paths = new Set<string>()
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, `${path}[]`))
      if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, path ? `${path}.${k}` : k))
      paths.add(path)
    }
    walk(doc, '')
    expect(paths.size).toBeLessThanOrEqual(150)
    const dataKeys = [...paths].filter((p) => /\b(c\d+|t\d+|ch\d+|o\d+|mon)\b/.test(p))
    expect(dataKeys).toEqual([])
  })
})

describe('labels and siblings', () => {
  it('merge: website-label rule, removal by empty, main language required, unknown language refused', () => {
    expect(mergeLabels({ en: 'Food' }, { it: 'PRIMI PIATTI', de: '' }, site)).toEqual({ ok: true, labels: { en: 'Food', it: 'Primi Piatti' } })
    expect(mergeLabels({ en: 'Food' }, { en: '' }, site)).toMatchObject({ ok: false, code: 'label_required' })
    expect(mergeLabels({}, { en: 'x', fr: 'y' }, site)).toMatchObject({ ok: false, code: 'label_locale_unknown', locale: 'fr' })
  })

  it('an active sibling with the same folded label (case, accents, spaces) clashes; archived ones and cousins do not', () => {
    const tree = buildTree(readCategoryNodes([
      newCategoryRow('a', { en: 'Caffè' }, null, 1000),
      { ...newCategoryRow('b', { en: 'Old' }, null, 2000), archivedAt: '2026-01-01' },
      newCategoryRow('c', { en: 'Caffe' }, 'a', 1000),
    ]))
    expect(siblingWithLabel(tree, null, '  caffe ', 'en')).toBe('a')
    expect(siblingWithLabel(tree, null, 'old', 'en')).toBeNull()
    expect(siblingWithLabel(tree, null, 'Caffè', 'en', 'a')).toBeNull()
  })
})

describe('item writer shape (C10-6 R2) and unassign', () => {
  it('writes primary/additional and unsets the legacy list on the same document', () => {
    expect(assignmentPatch({ primary: 'pizza', additional: ['desserts'] })).toEqual({ set: { primaryCategory: 'pizza', additionalCategories: ['desserts'] }, unset: ['categories'] })
    expect(assignmentPatch({ primary: null, additional: [] })).toEqual({ set: {}, unset: ['categories', 'primaryCategory', 'additionalCategories'] })
  })

  it('removing a category promotes the first additional to primary; idempotent', () => {
    const items = [
      { id: 'a', assignment: { primary: 'x', additional: ['y', 'z'] } },
      { id: 'b', assignment: { primary: 'y', additional: ['x'] } },
      { id: 'c', assignment: { primary: 'y', additional: [] } },
    ]
    const plan = planUnassign(items, 'x')
    expect(plan).toEqual([{ id: 'a', next: { primary: 'y', additional: ['z'] } }, { id: 'b', next: { primary: 'y', additional: [] } }])
    expect(planUnassign(plan.map((p) => ({ id: p.id, assignment: p.next })), 'x')).toEqual([])
  })
})

describe('concurrency helpers and audit summaries', () => {
  it('row fingerprints are order-independent; changedKeys lists added/removed/changed', () => {
    expect(fingerprintOf({ a: 1, b: [1, 2] })).toBe(fingerprintOf({ b: [1, 2], a: 1 }))
    const base = rowHashes([newCategoryRow('a', { en: 'A' }, null, 1000), newCategoryRow('b', { en: 'B' }, null, 2000)])
    const now = rowHashes([newCategoryRow('a', { en: 'A2' }, null, 1000), newCategoryRow('c', { en: 'C' }, null, 3000)])
    expect(changedKeys(base, now)).toEqual(['a', 'b', 'c'])
    expect(changedKeys(undefined, now)).toEqual([])
  })

  it('A-20: a schedule summary carries baseline, counts and a fingerprint — never times or labels', () => {
    const s = ruleSummary({ state: 'unavailable', overrides: [over('dinner', '18:00', '23:00'), over('sun', '12:00', '15:00', ['sun'])] })
    expect(s).toMatchObject({ baseline: 'unavailable', overrides: 2, daysCovered: 7 })
    expect(JSON.stringify(s)).not.toMatch(/18:00|dinner|sun"/)
    expect(ruleSummary(null)).toBe('inherit')
    const t = ruleSummary({ state: 'unavailable', overrides: [over('dinner', '18:30', '23:00')] })
    expect(typeof t === 'object' && typeof s === 'object' && t.fingerprint !== s.fingerprint).toBe(true)
  })

  it('impact counts sum gains and losses over channels (C12 impactCounts)', () => {
    expect(
      auditImpactCounts({ changes: [], itemsChanged: 3, formatsChanged: 4, shieldedByOverride: 2, byChannel: { a: { gainAvailability: 2, loseAvailability: 0, scheduleOnly: 1 }, b: { gainAvailability: 1, loseAvailability: 1, scheduleOnly: 0 } } as never }),
    ).toEqual({ items: 3, formats: 4, toAvailable: 3, toUnavailable: 1, shieldedByOverride: 2 })
  })
})
