import { describe, it, expect } from 'vitest'
import {
  resolveOffer,
  effectiveCurrency,
  scopeOf,
  isSoldOn,
  channelState,
  offerIssues,
  type Offer,
} from '../offers'

const ROME = 'Europe/Rome'
const project = { currency: 'EUR' }
const utc = (iso: string) => new Date(iso)

const offer = (over: Partial<Offer> & { _key: string }): Offer => ({ price: 10, ...over })

const CHANNELS = ['dine-in', 'takeaway', 'delivery']

describe('effectiveCurrency — ADR-033 D7 / A6', () => {
  it('is the project currency', () => {
    expect(effectiveCurrency({ currency: 'CHF' })).toBe('CHF')
  })

  it('IGNORES the reserved per-offer field — no coalesce', () => {
    // The field exists so multi-currency is additive later. If anything ever
    // writes it, V1 must not silently start honouring it.
    const o = offer({ _key: 'a', currency: 'USD' })
    const r = resolveOffer([o], 'dine-in', utc('2026-10-12T10:00:00Z'), ROME, project)
    expect(r.kind).toBe('offer')
    if (r.kind === 'offer') expect(r.currency).toBe('EUR')
  })
})

describe('scopeOf', () => {
  it('is the channel when set, and null when not', () => {
    expect(scopeOf(offer({ _key: 'a', channel: 'dine-in' }))).toBe('dine-in')
    expect(scopeOf(offer({ _key: 'b' }))).toBeNull()
    expect(scopeOf(offer({ _key: 'c', channel: '' }))).toBeNull()
  })

  it('does not collide with a channel literally keyed "default"', () => {
    // The scope key is string | null, never a stringified sentinel, so a tenant
    // may name a channel "default" without it sharing the unscoped bucket.
    expect(scopeOf(offer({ _key: 'd', channel: 'default' }))).toBe('default')
    expect(scopeOf(offer({ _key: 'e' }))).toBeNull()
  })
})

describe('resolveOffer — precedence (ADR-033 A4)', () => {
  const lunchTime = utc('2026-10-12T11:00:00Z') // 13:00 Rome, a Monday
  const eveningTime = utc('2026-10-12T19:00:00Z') // 21:00 Rome

  it('prefers a channel-specific offer over an unscoped one', () => {
    const offers = [
      offer({ _key: 'universal', price: 10 }),
      offer({ _key: 'takeaway', channel: 'takeaway', price: 8 }),
    ]
    const r = resolveOffer(offers, 'takeaway', lunchTime, ROME, project)
    expect(r.kind).toBe('offer')
    if (r.kind === 'offer') {
      expect(r.offer._key).toBe('takeaway')
      expect(r.scope).toBe('takeaway')
    }
  })

  it('falls back to the unscoped offer for a channel with none of its own', () => {
    const offers = [
      offer({ _key: 'universal', price: 10 }),
      offer({ _key: 'takeaway', channel: 'takeaway', price: 8 }),
    ]
    const r = resolveOffer(offers, 'dine-in', lunchTime, ROME, project)
    expect(r.kind).toBe('offer')
    if (r.kind === 'offer') {
      expect(r.offer._key).toBe('universal')
      expect(r.scope).toBeNull()
    }
  })

  it('falls back to unscoped when the channel offer is out of hours', () => {
    // The documented consequence: a universal offer makes every channel
    // sellable whenever it applies, so "dine-in only at lunch" needs scoping.
    const offers = [
      offer({ _key: 'universal', price: 10 }),
      offer({
        _key: 'lunch',
        channel: 'dine-in',
        price: 8,
        availability: [{ days: ['mon'], from: '12:00', to: '15:00' }],
      }),
    ]
    const atLunch = resolveOffer(offers, 'dine-in', lunchTime, ROME, project)
    const atNight = resolveOffer(offers, 'dine-in', eveningTime, ROME, project)
    if (atLunch.kind === 'offer') expect(atLunch.offer._key).toBe('lunch')
    if (atNight.kind === 'offer') expect(atNight.offer._key).toBe('universal')
  })

  it('reports notSold when nothing applies', () => {
    const offers = [offer({ _key: 'takeaway', channel: 'takeaway' })]
    expect(resolveOffer(offers, 'dine-in', lunchTime, ROME, project).kind).toBe('notSold')
    expect(resolveOffer([], 'dine-in', lunchTime, ROME, project).kind).toBe('notSold')
    expect(resolveOffer(undefined, 'dine-in', lunchTime, ROME, project).kind).toBe('notSold')
  })

  it('reports notSold when the only offer for that channel is out of hours', () => {
    const offers = [
      offer({
        _key: 'lunch',
        channel: 'dine-in',
        availability: [{ days: ['mon'], from: '12:00', to: '15:00' }],
      }),
    ]
    expect(resolveOffer(offers, 'dine-in', eveningTime, ROME, project).kind).toBe('notSold')
  })

  it('returns ambiguous rather than picking — never the first, never the cheapest', () => {
    const offers = [
      offer({ _key: 'a', channel: 'dine-in', price: 12 }),
      offer({ _key: 'b', channel: 'dine-in', price: 9 }),
    ]
    const r = resolveOffer(offers, 'dine-in', lunchTime, ROME, project)
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') {
      expect(r.offers.map((o) => o._key).sort()).toEqual(['a', 'b'])
      expect(r.scope).toBe('dine-in')
    }
  })

  it('reports ambiguity among unscoped offers too', () => {
    const offers = [offer({ _key: 'a' }), offer({ _key: 'b' })]
    const r = resolveOffer(offers, 'dine-in', lunchTime, ROME, project)
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.scope).toBeNull()
  })

  it('does not call overlap between scopes ambiguous — precedence resolves it', () => {
    const offers = [
      offer({ _key: 'universal', price: 10 }),
      offer({ _key: 'scoped', channel: 'dine-in', price: 9 }),
    ]
    expect(resolveOffer(offers, 'dine-in', lunchTime, ROME, project).kind).toBe('offer')
  })

  it('evaluates hours in the tenant zone, not the machine’s', () => {
    const offers = [
      offer({
        _key: 'late',
        channel: 'dine-in',
        availability: [{ days: ['fri'], from: '18:00', to: '02:00' }],
      }),
    ]
    // 23:00 UTC Friday = 01:00 Saturday in Rome, still inside the window.
    expect(resolveOffer(offers, 'dine-in', utc('2026-10-16T23:00:00Z'), ROME, project).kind).toBe(
      'offer',
    )
  })
})

describe('isSoldOn / channelState', () => {
  const offers = [
    offer({ _key: 'universal' }),
    offer({
      _key: 'lunch',
      channel: 'takeaway',
      availability: [{ days: ['mon'], from: '12:00', to: '15:00' }],
    }),
  ]

  it('says whether a channel is served at all, ignoring the hour', () => {
    expect(isSoldOn(offers, 'takeaway')).toBe(true)
    expect(isSoldOn(offers, 'delivery')).toBe(true) // the unscoped offer covers it
    expect(isSoldOn([offer({ _key: 'a', channel: 'dine-in' })], 'delivery')).toBe(false)
  })

  it('distinguishes closed-right-now from never-sold', () => {
    const scoped = [
      offer({
        _key: 'lunch',
        channel: 'takeaway',
        availability: [{ days: ['mon'], from: '12:00', to: '15:00' }],
      }),
    ]
    expect(channelState(scoped, 'takeaway', utc('2026-10-12T11:00:00Z'), ROME)).toBe('available')
    expect(channelState(scoped, 'takeaway', utc('2026-10-12T19:00:00Z'), ROME)).toBe('outOfHours')
    expect(channelState(scoped, 'delivery', utc('2026-10-12T11:00:00Z'), ROME)).toBe('notSold')
  })
})

describe('offerIssues — static validation (ADR-033 A3)', () => {
  it('accepts lunch and dinner on the same channel', () => {
    const offers = [
      offer({
        _key: 'lunch',
        channel: 'dine-in',
        availability: [{ days: ['mon'], from: '12:00', to: '15:00' }],
      }),
      offer({
        _key: 'dinner',
        channel: 'dine-in',
        availability: [{ days: ['mon'], from: '19:00', to: '23:00' }],
      }),
    ]
    expect(offerIssues(offers, CHANNELS)).toEqual([])
  })

  it('accepts universal lunch and dinner pricing without duplicating per channel', () => {
    const offers = [
      offer({ _key: 'lunch', availability: [{ from: '12:00', to: '15:00' }] }),
      offer({ _key: 'dinner', availability: [{ from: '19:00', to: '23:00' }] }),
    ]
    expect(offerIssues(offers, CHANNELS)).toEqual([])
  })

  it('refuses two overlapping offers in one scope', () => {
    const offers = [
      offer({ _key: 'a', channel: 'dine-in', availability: [{ from: '12:00', to: '15:00' }] }),
      offer({ _key: 'b', channel: 'dine-in', availability: [{ from: '14:00', to: '18:00' }] }),
    ]
    expect(offerIssues(offers, CHANNELS)).toContainEqual({
      kind: 'overlappingOffers',
      scope: 'dine-in',
      keys: ['a', 'b'],
    })
  })

  it('catches an overlap created by a wrap into the next day', () => {
    const offers = [
      offer({
        _key: 'late',
        channel: 'dine-in',
        availability: [{ days: ['fri'], from: '18:00', to: '02:00' }],
      }),
      offer({
        _key: 'early',
        channel: 'dine-in',
        availability: [{ days: ['sat'], from: '01:00', to: '04:00' }],
      }),
    ]
    expect(offerIssues(offers, CHANNELS)).toContainEqual({
      kind: 'overlappingOffers',
      scope: 'dine-in',
      keys: ['late', 'early'],
    })
  })

  it('allows overlap ACROSS scopes — that is what precedence is for', () => {
    const offers = [
      offer({ _key: 'universal', availability: [{ from: '12:00', to: '15:00' }] }),
      offer({ _key: 'scoped', channel: 'dine-in', availability: [{ from: '12:00', to: '15:00' }] }),
    ]
    expect(offerIssues(offers, CHANNELS)).toEqual([])
  })

  it('treats two always-on offers in one scope as overlapping', () => {
    const offers = [offer({ _key: 'a', channel: 'dine-in' }), offer({ _key: 'b', channel: 'dine-in' })]
    expect(offerIssues(offers, CHANNELS)).toContainEqual({
      kind: 'overlappingOffers',
      scope: 'dine-in',
      keys: ['a', 'b'],
    })
  })

  it('permits more than one unscoped offer when their windows are disjoint', () => {
    // A3 replaced "at most one unscoped offer" with non-overlap per scope.
    const offers = [
      offer({ _key: 'a', availability: [{ days: ['mon'], from: '12:00', to: '15:00' }] }),
      offer({ _key: 'b', availability: [{ days: ['tue'], from: '12:00', to: '15:00' }] }),
    ]
    expect(offerIssues(offers, CHANNELS)).toEqual([])
  })

  it('names an unknown channel', () => {
    const offers = [offer({ _key: 'a', channel: 'drive-through' })]
    expect(offerIssues(offers, CHANNELS)).toContainEqual({
      kind: 'unknownChannel',
      key: 'a',
      channel: 'drive-through',
    })
  })

  it('accepts an unscoped offer without complaining about its channel', () => {
    expect(offerIssues([offer({ _key: 'a' })], CHANNELS)).toEqual([])
  })

  it('rejects a negative price', () => {
    expect(offerIssues([offer({ _key: 'a', price: -1 })], CHANNELS)).toContainEqual({
      kind: 'negativePrice',
      key: 'a',
    })
  })

  it('accepts zero as a free item', () => {
    expect(offerIssues([offer({ _key: 'a', price: 0 })], CHANNELS)).toEqual([])
  })

  it('is empty-safe', () => {
    expect(offerIssues([], CHANNELS)).toEqual([])
    expect(offerIssues(undefined, CHANNELS)).toEqual([])
  })
})
