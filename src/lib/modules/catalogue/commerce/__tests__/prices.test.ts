/** Contract C4-9 — price model fixtures, zone Europe/Rome. */
import { describe, expect, it } from 'vitest'
import { availabilityMatrix } from '../channel-availability'
import { channelSetOf, EMPTY_CHANNELS } from '../channels'
import { displayPrices, priceCoverage, priceIssues, resolvePrice, WHOLE_WEEK } from '../prices'
import { ZONE, at, channel, ck, format, inputs, item, price, rule } from './fixtures'

const T_MON_1100 = at('2026-11-02T10:00:00Z')
const T_MON_1600 = at('2026-11-02T15:00:00Z')
const T_SAT_0130 = at('2026-11-07T00:30:00Z')
const T_MON_0030 = at('2026-11-08T23:30:00Z')
const EUR = { currency: 'EUR' }
const general = { kind: 'general' as const }
const ch = (c: string) => ({ kind: 'channel' as const, channel: ck(c) })
const CH = channelSetOf([channel('dine-in', 'available'), channel('takeaway', 'available'), channel('delivery', 'available', { active: false })])
const f = (...prices: ReturnType<typeof price>[]) => format('f', { prices })
const lunch = [{ days: ['mon'], from: '12:00', to: '15:00' }]

describe('C4 prices', () => {
  it('C4-F1 standard only, general', () => {
    expect(resolvePrice(f(price('s', 12)), general, T_MON_1100, ZONE, EMPTY_CHANNELS, EUR)).toEqual({ kind: 'price', price: price('s', 12), source: { kind: 'standard', priceKey: 's', fallbackFrom: null }, currency: 'EUR' })
  })
  it('C4-F2 channel wins', () => {
    expect(resolvePrice(f(price('s', 12), price('t', 10, { scope: 'takeaway' })), ch('takeaway'), T_MON_1100, ZONE, CH, EUR)).toMatchObject({ kind: 'price', price: { amount: 10 }, source: { kind: 'channel', channel: 'takeaway' } })
  })
  it('C4-F3 fallback outside the channel window', () => {
    expect(resolvePrice(f(price('s', 12), price('t', 10, { scope: 'takeaway', windows: lunch })), ch('takeaway'), T_MON_1600, ZONE, CH, EUR)).toMatchObject({ kind: 'price', price: { amount: 12 }, source: { kind: 'standard', fallbackFrom: 'takeaway' } })
  })
  it('C4-F4 no fallback available', () => {
    expect(resolvePrice(f(price('t', 10, { scope: 'takeaway', windows: lunch })), ch('takeaway'), T_MON_1600, ZONE, CH, EUR)).toEqual({ kind: 'noPrice', reason: 'outsideWindows' })
  })
  it('C4-F5 lunch/dinner gap — noPrice at 16:00; coverage partial with gaps from [0,720)', () => {
    const fm = f(price('l', 10, { windows: [{ from: '12:00', to: '15:00' }] }), price('d', 14, { windows: [{ from: '18:00', to: '23:00' }] }))
    expect(resolvePrice(fm, general, T_MON_1600, ZONE, EMPTY_CHANNELS, EUR)).toEqual({ kind: 'noPrice', reason: 'outsideWindows' })
    const cov = priceCoverage(fm, general, EMPTY_CHANNELS, WHOLE_WEEK)
    expect(cov.kind).toBe('partial')
    expect(cov.kind === 'partial' && cov.gaps[0]).toEqual({ start: 0, end: 720 })
    expect(cov.kind === 'partial' && cov.gaps[1]).toEqual({ start: 900, end: 1080 })
  })
  it('C4-F6 overnight — Fri 18:00–02:00 applies Sat 01:30, not Mon 11:00', () => {
    const fm = f(price('n', 8, { windows: [{ days: ['fri'], from: '18:00', to: '02:00' }] }))
    expect(resolvePrice(fm, general, T_SAT_0130, ZONE, EMPTY_CHANNELS, EUR)).toMatchObject({ kind: 'price', price: { amount: 8 } })
    expect(resolvePrice(fm, general, T_MON_1100, ZONE, EMPTY_CHANNELS, EUR).kind).toBe('noPrice')
  })
  it('C4-F7 week wrap — Sun 23:00–01:00 applies Mon 00:30', () => {
    expect(resolvePrice(f(price('w', 8, { windows: [{ days: ['sun'], from: '23:00', to: '01:00' }] })), general, T_MON_0030, ZONE, EMPTY_CHANNELS, EUR)).toMatchObject({ kind: 'price', price: { amount: 8 } })
  })
  it('C4-F8 ambiguous channel does not fall through to the standard price', () => {
    expect(resolvePrice(f(price('a', 9, { scope: 'takeaway' }), price('b', 10, { scope: 'takeaway' }), price('s', 12)), ch('takeaway'), T_MON_1100, ZONE, CH, EUR)).toEqual({ kind: 'ambiguous', scope: 'takeaway', priceKeys: ['a', 'b'] })
  })
  it('C4-F9 ambiguous standard → ambiguous{null}; priceIssues → price.overlap', () => {
    const fm = f(price('a', 9), price('b', 10))
    expect(resolvePrice(fm, general, T_MON_1100, ZONE, EMPTY_CHANNELS, EUR)).toEqual({ kind: 'ambiguous', scope: null, priceKeys: ['a', 'b'] })
    expect(priceIssues(fm, EMPTY_CHANNELS)).toEqual([{ code: 'price.overlap', level: 'error', keys: ['a', 'b'], scope: null }])
  })
  it('C4-F10 inactive channel ignored — direct call falls back to standard; priceIssues warns', () => {
    const fm = f(price('s', 12), price('d', 9, { scope: 'delivery' }))
    expect(resolvePrice(fm, ch('delivery'), T_MON_1100, ZONE, CH, EUR)).toMatchObject({ kind: 'price', price: { amount: 12 }, source: { kind: 'standard', fallbackFrom: 'delivery' } })
    expect(priceIssues(fm, CH)).toEqual([{ code: 'price.inactiveChannel', level: 'warning', keys: ['d'], scope: 'delivery' }])
  })
  it('C4-F11 no zone — a windowed candidate is indeterminate; un-windowed only resolves', () => {
    expect(resolvePrice(f(price('l', 10, { windows: lunch })), general, T_MON_1100, null, EMPTY_CHANNELS, EUR)).toEqual({ kind: 'indeterminate', reason: 'timeZoneMissing' })
    expect(resolvePrice(f(price('s', 10)), general, T_MON_1100, null, EMPTY_CHANNELS, EUR)).toMatchObject({ kind: 'price' })
  })
  it('C4-F12 currency reserved — a stored price currency is never read', () => {
    const withCurrency = { ...price('s', 12), currency: 'USD' } as ReturnType<typeof price>
    expect(resolvePrice(f(withCurrency), general, T_MON_1100, ZONE, EMPTY_CHANNELS, { currency: 'CHF' })).toMatchObject({ currency: 'CHF' })
  })
  it('C4-F13 displayPrices — stored order; a channel the item is unavailable on is not listed', () => {
    const chs = channelSetOf([channel('dine-in', 'available'), channel('takeaway', 'available')])
    const fm = format('default', { label: null, implicit: true, prices: [price('t', 10, { scope: 'takeaway' }), price('s', 12), price('d', 11, { scope: 'dine-in' })] })
    const i = item({ rules: { takeaway: rule('unavailable') }, formats: [fm] })
    const m = availabilityMatrix(inputs(chs), i).get(fm.key)!
    expect(displayPrices(fm, m, chs).map((p) => [p.key, p.amount])).toEqual([
      ['s', 12],
      ['d', 11],
    ])
  })
  it('C4-F14 a channel keyed literally "default" is a channel price, not standard', () => {
    const chs = channelSetOf([channel('default', 'available')])
    expect(resolvePrice(f(price('c', 7, { scope: 'default' })), ch('default'), T_MON_1100, ZONE, chs, EUR)).toMatchObject({ source: { kind: 'channel', channel: 'default' } })
    expect(resolvePrice(f(price('c', 7, { scope: 'default' })), general, T_MON_1100, ZONE, chs, EUR)).toEqual({ kind: 'noPrice', reason: 'noPrices' })
  })
  it('priceCoverage: gaps only inside available minutes; none when no price applies', () => {
    const late = Array.from({ length: 7 }, (_, d) => ({ start: d * 1440 + 420, end: d * 1440 + 720, state: 'available' as const }))
    const cov = priceCoverage(f(price('b', 5, { windows: [{ from: '07:00', to: '11:00' }] })), general, EMPTY_CHANNELS, late)
    expect(cov).toEqual({ kind: 'partial', gaps: Array.from({ length: 7 }, (_, d) => ({ start: d * 1440 + 660, end: d * 1440 + 720 })) })
    // Every day breakfast: priced every day 07–11 → full.
    const everyDay = Array.from({ length: 7 }, (_, d) => ({ start: d * 1440 + 420, end: d * 1440 + 660, state: 'available' as const }))
    expect(priceCoverage(f(price('b', 5, { windows: [{ from: '07:00', to: '11:00' }] })), general, EMPTY_CHANNELS, everyDay)).toEqual({ kind: 'full' })
    expect(priceCoverage(f(), general, EMPTY_CHANNELS, WHOLE_WEEK)).toEqual({ kind: 'none' })
  })
  it('priceIssues: amounts, decimals, unknown channel, window codes', () => {
    const codes = priceIssues(f(price('a', -1), price('b', 1.005, { scope: 'ghost' }), price('c', 2, { scope: 'dine-in', windows: [{ from: '10:00' }] })), CH).map((i) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['price.amountInvalid', 'price.tooManyDecimals', 'price.unknownChannel', 'price.windowIncomplete']))
  })
})
