/** Contract C5-9 — precedence (C5-F*), schedules (C5-S*), impact (C5-F12…F14). Zone Europe/Rome. */
import { describe, expect, it } from 'vitest'
import { availableNow, effectiveRule, explainAvailability } from '../channel-availability'
import { scheduleIssues } from '../availability-schedule'
import { channelSetOf } from '../channels'
import { availabilityImpact } from '../impact'
import { displayPrices } from '../prices'
import { resolveOffering } from '../offering'
import { availabilityMatrix } from '../channel-availability'
import {
  C5_CHANNELS,
  DINNER_RULE,
  FRI_2200,
  MON_0800,
  MON_1100,
  MON_1759,
  MON_1800,
  MON_2300,
  SAT_0100,
  SAT_0200,
  SUN_1200,
  ZONE,
  at,
  channel,
  ck,
  fk,
  format,
  implicitFormat,
  inputs,
  item,
  price,
  rule,
  tree,
  weekly,
} from './fixtures'

const D = fk('default')
const ch = (c: string) => ({ kind: 'channel' as const, channel: ck(c) })
const x = (i: ReturnType<typeof item>, c: string, t: Date, f = D, inp = inputs()) => explainAvailability(inp, i, f, ch(c), t, ZONE)

describe('C5 precedence (rules without schedules)', () => {
  it('C5-F1 bottoms out — dine-in projectDefault; delivery from category pizza, inherited from an ancestor', () => {
    const i = item({ primary: 'bianche' })
    const dine = x(i, 'dine-in', MON_1100)
    expect(dine.state).toBe('available')
    expect(dine.source).toEqual({ level: 'projectDefault', channel: 'dine-in' })
    const del = x(i, 'delivery', MON_1100)
    expect(del.state).toBe('unavailable')
    expect(del.source).toEqual({ level: 'category', channel: 'delivery', categoryKey: 'pizza', path: ['food', 'pizza', 'bianche'], inheritedFromAncestor: true })
  })
  it('C5-F2 most specific wins — food available, pizza unavailable → pizza', () => {
    const e = effectiveRule(inputs(), item({ primary: 'pizza' }), D, ch('delivery'))
    expect(e.source).toMatchObject({ level: 'category', categoryKey: 'pizza', inheritedFromAncestor: false })
    expect(e.rule.state).toBe('unavailable')
  })
  it('C5-F3 item rule — available/item; inherited = the complete rule from category pizza', () => {
    const e = effectiveRule(inputs(), item({ primary: 'bianche', rules: { delivery: rule('available') } }), D, ch('delivery'))
    expect(e.source).toEqual({ level: 'item', channel: 'delivery' })
    expect(e.rule).toEqual(rule('available'))
    expect(e.inherited).toEqual({ rule: rule('unavailable'), source: expect.objectContaining({ level: 'category', categoryKey: 'pizza' }) })
  })
  it('C5-F4 format rule — B unavailable/format; A available/projectDefault; item-level takeaway available', () => {
    const i = item({ formats: [format('A'), format('B', { rules: { takeaway: rule('unavailable') } })] })
    expect(x(i, 'takeaway', MON_1100, fk('B'))).toMatchObject({ state: 'unavailable', source: { level: 'format', channel: 'takeaway', formatKey: 'B' } })
    expect(x(i, 'takeaway', MON_1100, fk('A'))).toMatchObject({ state: 'available', source: { level: 'projectDefault' } })
  })
  it('C5-F5 additional categories inert — not an input; takeaway stays available', () => {
    // ItemAvailabilityInput has no additionalCategories field (K-3 rule 5): an item filed also under drinks keeps its primary-path result.
    expect(x(item({ primary: 'bianche' }), 'takeaway', MON_1100).state).toBe('available')
  })
  it('C5-F6 no primary — L0 only', () => {
    expect(x(item(), 'delivery', MON_1100)).toMatchObject({ state: 'unavailable', source: { level: 'projectDefault' }, issues: [] })
  })
  it('C5-F7 broken path — primary ghost → L0 + availability.primaryCategoryBroken', () => {
    const e = x(item({ primary: 'ghost' }), 'delivery', MON_1100)
    expect(e.source).toEqual({ level: 'projectDefault', channel: 'delivery' })
    expect(e.issues).toContain('availability.primaryCategoryBroken')
  })
  it('C5-F8 inactive — room → unavailable/channelInactive, nextTransition null', () => {
    expect(x(item(), 'room', MON_1100)).toMatchObject({ state: 'unavailable', source: { level: 'channelInactive' }, nextTransition: null })
  })
  it('C5-F9 no channels — general available/noChannels, nextTransition null', () => {
    const e = explainAvailability(inputs(channelSetOf([])), item(), D, { kind: 'general' }, MON_1100, ZONE)
    expect(e).toMatchObject({ state: 'available', source: { level: 'noChannels' }, nextTransition: null })
  })
  it('C5-F10 general with channels — available on dine-in only → anyChannel [dine-in]', () => {
    const chs = channelSetOf([channel('dine-in', 'available'), channel('takeaway', 'unavailable')])
    const e = explainAvailability(inputs(chs), item(), D, { kind: 'general' }, MON_1100, ZONE)
    expect(e).toMatchObject({ state: 'available', source: { level: 'anyChannel', channels: ['dine-in'] } })
  })
})

const BREAKFAST = rule('unavailable', [weekly('b1', 'available', '07:00', '11:00')])

describe('C5a schedules (D-6)', () => {
  it('C5-S1 breakfast 07–11 — available at 08:00 until 11:00; half-open at 11:00', () => {
    const i = item({ rules: { 'dine-in': BREAKFAST } })
    const a = x(i, 'dine-in', MON_0800)
    expect(a.state).toBe('available')
    expect(a.activeOverride).toEqual({ key: 'b1', kind: 'weekly', endsAt: MON_1100 })
    expect(a.nextTransition).toEqual(MON_1100)
    const b = x(i, 'dine-in', MON_1100)
    expect(b.state).toBe('unavailable')
    expect(b.nextTransition).toEqual(at('2026-11-03T06:00:00Z'))
  })
  it('C5-S2 Dinner category — 17:59 unavailable → 18:00 available → 23:00 unavailable', () => {
    const i = item({ primary: 'dinner' })
    const a = x(i, 'dine-in', MON_1759)
    expect(a).toMatchObject({ state: 'unavailable', source: { level: 'category', categoryKey: 'dinner' } })
    expect(a.nextTransition).toEqual(MON_1800)
    const b = x(i, 'dine-in', MON_1800)
    expect(b.state).toBe('available')
    expect(b.nextTransition).toEqual(MON_2300)
    expect(x(i, 'dine-in', MON_2300).state).toBe('unavailable')
  })
  it('C5-S3 delivery evening only — channel default with a schedule', () => {
    const chs = channelSetOf([channel('delivery', 'unavailable', { schedule: [weekly('e', 'available', '18:00', '23:00')] })])
    const i = item()
    expect(x(i, 'delivery', MON_1100, D, inputs(chs))).toMatchObject({ state: 'unavailable', source: { level: 'projectDefault' } })
    expect(x(i, 'delivery', MON_1800, D, inputs(chs))).toMatchObject({ state: 'available', source: { level: 'projectDefault' } })
  })
  it('C5-S4 unavailable on Sundays', () => {
    const i = item({ rules: { 'dine-in': rule('available', [weekly('sun', 'unavailable', null, null, ['sun'])]) } })
    expect(x(i, 'dine-in', SUN_1200).state).toBe('unavailable')
    const sat = x(i, 'dine-in', SAT_0100)
    expect(sat.state).toBe('available')
    expect(sat.nextTransition).toEqual(at('2026-11-07T23:00:00Z'))
    expect(x(i, 'dine-in', SUN_1200).nextTransition).toEqual(at('2026-11-08T23:00:00Z'))
  })
  it('C5-S5 overnight Fri 22:00–02:00 — Saturday 01:00 belongs to Friday (A1)', () => {
    const i = item({ rules: { 'dine-in': rule('unavailable', [weekly('n', 'available', '22:00', '02:00', ['fri'])]) } })
    expect(x(i, 'dine-in', FRI_2200).state).toBe('available')
    expect(x(i, 'dine-in', SAT_0100).state).toBe('available')
    expect(x(i, 'dine-in', SAT_0200).state).toBe('unavailable')
    expect(x(i, 'dine-in', FRI_2200).nextTransition).toEqual(SAT_0200)
  })

  const DST_RULE = rule('unavailable', [weekly('n', 'available', '01:00', '02:30')])
  /** Brute-force oracle: the first minute after `t` whose wall-clock state differs. */
  function oracle(i: ReturnType<typeof item>, t: Date): Date | null {
    const s0 = x(i, 'dine-in', t).state
    for (let m = 1; m <= 8 * 1440; m++) {
      const u = new Date(Math.floor(t.getTime() / 60000) * 60000 + m * 60000)
      if (x(i, 'dine-in', u).state !== s0) return u
    }
    return null
  }
  it('C5-S6 DST spring-forward — 02:00–02:59 does not exist; transition at 03:00 CEST, equals the minute scan', () => {
    const i = item({ rules: { 'dine-in': DST_RULE } })
    const t = at('2027-03-28T00:30:00Z')
    const e = x(i, 'dine-in', t)
    expect(e.state).toBe('available')
    expect(e.nextTransition).toEqual(at('2027-03-28T01:00:00Z'))
    expect(e.nextTransition).toEqual(oracle(i, t))
  })
  it('C5-S7 DST fall-back — the repeated hour evaluates by wall clock; both transitions equal the minute scan', () => {
    const i = item({ rules: { 'dine-in': DST_RULE } })
    const t1 = at('2026-10-25T00:30:00Z')
    expect(x(i, 'dine-in', t1).state).toBe('unavailable')
    expect(x(i, 'dine-in', t1).nextTransition).toEqual(at('2026-10-25T01:00:00Z'))
    expect(oracle(i, t1)).toEqual(at('2026-10-25T01:00:00Z'))
    const t2 = at('2026-10-25T01:00:00Z')
    expect(x(i, 'dine-in', t2).state).toBe('available')
    expect(x(i, 'dine-in', t2).nextTransition).toEqual(at('2026-10-25T01:30:00Z'))
    expect(oracle(i, t2)).toEqual(at('2026-10-25T01:30:00Z'))
  })
  it('C5-S8 item "Available" replaces a category schedule — available all week, nextTransition null', () => {
    const e = x(item({ primary: 'dinner', rules: { 'dine-in': rule('available') } }), 'dine-in', MON_1100)
    expect(e).toMatchObject({ state: 'available', source: { level: 'item' }, nextTransition: null })
  })
  it('C5-S9 format replaces item — B unavailable all week; A follows the item schedule; other channels unaffected', () => {
    const i = item({ rules: { 'dine-in': BREAKFAST }, formats: [format('A'), format('B', { rules: { 'dine-in': rule('unavailable') } })] })
    expect(x(i, 'dine-in', MON_0800, fk('B'))).toMatchObject({ state: 'unavailable', source: { level: 'format' }, nextTransition: null })
    expect(x(i, 'dine-in', MON_0800, fk('A'))).toMatchObject({ state: 'available', source: { level: 'item' } })
    expect(x(i, 'takeaway', MON_0800, fk('B')).source.level).toBe('projectDefault')
  })
  it('C5-S10 "Use category default" — removing the item row restores the complete upstream rule exactly (= S2)', () => {
    const withRow = item({ primary: 'dinner', rules: { 'dine-in': rule('available') } })
    const without = item({ primary: 'dinner' })
    expect(effectiveRule(inputs(), withRow, D, ch('dine-in')).inherited?.rule).toEqual(DINNER_RULE)
    for (const t of [MON_1759, MON_1800, MON_2300]) expect(x(without, 'dine-in', t)).toEqual(x(item({ primary: 'dinner' }), 'dine-in', t))
    expect(effectiveRule(inputs(), without, D, ch('dine-in')).rule).toEqual(DINNER_RULE)
  })
  it('C5-S11 overlap refusal — overlapping overrides in one rule refused; touching is valid; across levels never merged', () => {
    const bad = scheduleIssues(rule('unavailable', [weekly('a', 'available', '07:00', '11:00'), weekly('b', 'available', '10:00', '12:00')]))
    expect(bad).toContainEqual({ code: 'availability.scheduleOverlap', level: 'error', keys: ['a', 'b'] })
    const ok = scheduleIssues(rule('unavailable', [weekly('a', 'available', '07:00', '11:00'), weekly('b', 'available', '11:00', '12:00')]))
    expect(ok.filter((i) => i.level === 'error')).toEqual([])
    // Item 07–11 and category 10–12: only the item rule is evaluated.
    const t = tree([{ key: 'c', rules: { 'dine-in': rule('unavailable', [weekly('c', 'available', '10:00', '12:00')]) } }])
    expect(x(item({ primary: 'c', rules: { 'dine-in': BREAKFAST } }), 'dine-in', at('2026-11-02T10:30:00Z'), D, inputs(C5_CHANNELS, t)).state).toBe('unavailable')
  })
  it('C5-S12 standard price unchanged across availability changes', () => {
    const i = item({ primary: 'dinner', formats: [implicitFormat([price('p', 18)])] })
    expect(resolveOffering(inputs(), i, D, ch('dine-in'), MON_1759, ZONE, { currency: 'EUR' }).kind).toBe('unavailable')
    const o = resolveOffering(inputs(), i, D, ch('dine-in'), MON_1800, ZONE, { currency: 'EUR' })
    expect(o).toMatchObject({ kind: 'available', price: { kind: 'price', price: { amount: 18 }, source: { kind: 'standard' } } })
    const dp = displayPrices(i.formats[0], availabilityMatrix(inputs(), i).get(D)!, C5_CHANNELS)
    expect(dp.map((p) => p.amount)).toEqual([18]) // instant-free: identical at both instants by construction
  })
  it('C5-S13 available + no price — available with price.missing, never unavailable', () => {
    const o = resolveOffering(inputs(), item({ primary: 'dinner' }), D, ch('dine-in'), MON_1800, ZONE, { currency: 'EUR' })
    expect(o).toMatchObject({ kind: 'available', issues: ['price.missing'] })
  })
  it('C5-S14 a price window does not gate availability', () => {
    const i = item({ primary: 'dinner', formats: [implicitFormat([price('p', 12, { scope: 'dine-in', windows: [{ from: '19:00', to: '20:00' }] })])] })
    expect(resolveOffering(inputs(), i, D, ch('dine-in'), MON_1800, ZONE, { currency: 'EUR' })).toMatchObject({ kind: 'available', price: { kind: 'noPrice', reason: 'outsideWindows' }, issues: ['price.missing'] })
    expect(resolveOffering(inputs(), i, D, ch('dine-in'), at('2026-11-02T18:30:00Z'), ZONE, { currency: 'EUR' })).toMatchObject({ kind: 'available', price: { kind: 'price', price: { amount: 12 } } })
  })
  it('C5-S15 no zone — scheduleOnly{timeZoneMissing}', () => {
    expect(availableNow(inputs(), item({ primary: 'dinner' }), D, ch('dine-in'), MON_1800, null)).toMatchObject({ kind: 'scheduleOnly', reason: 'timeZoneMissing' })
  })
})

describe('C5-6 impact', () => {
  it('C5-F12 — pizza.delivery → inherit: 1 change (whole week to available), shieldedByOverride 1', () => {
    const after = tree([
      { key: 'food', rules: { delivery: rule('available') } },
      { key: 'pizza', parent: 'food' },
      { key: 'bianche', parent: 'pizza' },
    ])
    const items = [item({ id: 'a', primary: 'bianche' }), item({ id: 'b', primary: 'bianche', rules: { delivery: rule('unavailable') } })]
    const impact = availabilityImpact(inputs(), inputs(C5_CHANNELS, after), items)
    expect(impact.changes).toHaveLength(1)
    expect(impact.changes[0]).toMatchObject({ itemId: 'a', channel: 'delivery', minutesToAvailable: 10080, minutesToUnavailable: 0 })
    expect(impact.shieldedByOverride).toBe(1)
  })
  it('C5-F13 activation — room active with default available over 3 items × 2 formats', () => {
    const after = channelSetOf([...C5_CHANNELS.all.filter((c) => c.key !== 'room'), channel('room', 'available')])
    const items = ['a', 'b', 'c'].map((id) => item({ id, formats: [format('A'), format('B')] }))
    const impact = availabilityImpact(inputs(), inputs(after), items)
    expect(impact.formatsChanged).toBe(6)
    expect(impact.byChannel[ck('room')].gainAvailability).toBe(6)
  })
  it('C5-F14 schedule edit — dinner 18:00–23:00 → 18:30–23:00: 2 formats lose 210 minutes, 1 shielded', () => {
    const after = tree([{ key: 'dinner', rules: { 'dine-in': rule('unavailable', [weekly('d1', 'available', '18:30', '23:00')]) } }])
    const items = [item({ id: 'a', primary: 'dinner' }), item({ id: 'b', primary: 'dinner' }), item({ id: 'c', primary: 'dinner', rules: { 'dine-in': rule('available') } })]
    const impact = availabilityImpact(inputs(), inputs(C5_CHANNELS, after), items)
    expect(impact.formatsChanged).toBe(2)
    for (const c of impact.changes) expect(c).toMatchObject({ minutesToUnavailable: 210, minutesToAvailable: 0 })
    expect(impact.shieldedByOverride).toBe(1)
  })
})
