// ── Catalogue — offer resolution ──────────────────────────────────────────────
//
// Authority: ADR-033 D7 (currency), D14 (embedded offers, reserved fields),
// A2 (optional channel), A3 (non-overlap per scope), A4 (precedence and
// ambiguity), A5 (location inactive in V1).
//
// An offer is the commercial terms under which an item is available on one
// channel: a price, and when it applies. This module answers "what does this
// item cost on this channel, right now", and refuses to guess when the data
// cannot say.

import {
  evaluate,
  rulesOverlap,
  type AvailabilityRule,
  type AvailabilityState,
} from './availability'

export type Offer = {
  /** Sanity array `_key` — the offer's stable identity (D14). */
  _key: string
  /** Absent = unscoped: applies to any channel with no offer of its own (A2). */
  channel?: string | null
  price: number
  availability?: readonly AvailabilityRule[]
  /**
   * RESERVED (D7, D14). Never read. The project currency is the only persisted
   * currency in V1 and `effectiveCurrency` below ignores this field entirely —
   * a coalesce here would switch multi-currency on the moment anything wrote it.
   */
  currency?: string | null
  /** RESERVED (A5). No resolver consults it in V1. */
  locationKey?: string | null
}

/**
 * The scope an offer competes in: its channel, or the unscoped bucket.
 *
 * `null` rather than a string sentinel, deliberately. A tenant can create a
 * service channel whose stable value is literally "default", and a string
 * sentinel would silently put it in the same bucket as the unscoped offers.
 * Nothing to remember later.
 */
export type Scope = string | null

export const scopeOf = (o: Offer): Scope =>
  typeof o.channel === 'string' && o.channel !== '' ? o.channel : null

/**
 * The currency every price is read in.
 *
 * `project.currency`, full stop — NOT `offer.currency ?? project.currency`.
 * The project setting is the sole persisted authority in V1 (D7); the offer's
 * field is reserved and has no effect until multi-currency is formally
 * introduced. Changing the project currency reinterprets stored amounts and
 * converts nothing, which is why the configuration surface warns before it.
 */
export function effectiveCurrency(project: { currency: string }): string {
  return project.currency
}

export type Resolution =
  /** One offer applies. */
  | { kind: 'offer'; offer: Offer; scope: Scope; currency: string }
  /** Nothing applies: not sold through this channel at this instant. */
  | { kind: 'notSold' }
  /**
   * Two or more offers apply at the same precedence. Never the first, never the
   * cheapest — a silent pick is how a till ends up charging a price nobody
   * chose. Static validation makes this unreachable through the editor; it
   * exists for imported and legacy data, where no save-time check ever ran.
   */
  | { kind: 'ambiguous'; offers: Offer[]; scope: Scope }

/**
 * What this item costs on this channel at this instant.
 *
 * Precedence (A4):
 *   1. an applicable channel-specific offer;
 *   2. otherwise an applicable unscoped offer;
 *   3. otherwise, not sold through that channel;
 *   4. two at the same precedence → ambiguous.
 *
 * A consequence worth knowing rather than discovering: an unscoped offer makes
 * every channel sellable whenever that offer applies, so "dine-in only at lunch"
 * requires scoping the offers rather than relying on a universal one.
 */
export function resolveOffer(
  offers: readonly Offer[] | null | undefined,
  channel: string,
  instant: Date | string,
  timeZone: string,
  project: { currency: string },
): Resolution {
  const applicable = (scope: Scope) =>
    (offers ?? []).filter(
      (o) => scopeOf(o) === scope && evaluate(o.availability, instant, timeZone) === 'available',
    )

  for (const scope of [channel, null] as Scope[]) {
    const matches = applicable(scope)
    if (matches.length === 1) {
      return { kind: 'offer', offer: matches[0], scope, currency: effectiveCurrency(project) }
    }
    if (matches.length > 1) return { kind: 'ambiguous', offers: matches, scope }
  }
  return { kind: 'notSold' }
}

/** Whether the item is offered on this channel at all, ignoring the hour. */
export function isSoldOn(offers: readonly Offer[] | null | undefined, channel: string): boolean {
  return (offers ?? []).some((o) => {
    const s = scopeOf(o)
    return s === channel || s === null
  })
}

/** Availability of the offers that could serve this channel, for a "currently closed" note. */
export function channelState(
  offers: readonly Offer[] | null | undefined,
  channel: string,
  instant: Date | string,
  timeZone: string,
): AvailabilityState | 'notSold' {
  const candidates = (offers ?? []).filter((o) => {
    const s = scopeOf(o)
    return s === channel || s === null
  })
  if (candidates.length === 0) return 'notSold'
  return candidates.some((o) => evaluate(o.availability, instant, timeZone) === 'available')
    ? 'available'
    : 'outOfHours'
}

export type OfferIssue =
  /** Two offers in one scope whose availability windows intersect (A3). */
  | { kind: 'overlappingOffers'; scope: Scope; keys: [string, string] }
  /** A channel that is not in the module's configured service channels. */
  | { kind: 'unknownChannel'; key: string; channel: string }
  | { kind: 'negativePrice'; key: string }
  | { kind: 'tooManyDecimals'; key: string }

/**
 * Everything wrong with an item's offers, for save-time validation.
 *
 * The overlap check is what makes `ambiguous` unreachable through the editor:
 * two offers in the same scope are proved disjoint statically, across the whole
 * week, rather than discovered to collide at some particular instant. Overlap
 * BETWEEN scopes is legitimate and is not reported — that is exactly what
 * precedence resolves.
 *
 * `knownChannels` is passed in rather than read: these functions fetch nothing.
 */
export function offerIssues(
  offers: readonly Offer[] | null | undefined,
  knownChannels: readonly string[],
): OfferIssue[] {
  const list = offers ?? []
  const issues: OfferIssue[] = []

  for (const o of list) {
    const scope = scopeOf(o)
    if (scope !== null && !knownChannels.includes(scope)) {
      issues.push({ kind: 'unknownChannel', key: o._key, channel: scope })
    }
    if (typeof o.price !== 'number' || o.price < 0) issues.push({ kind: 'negativePrice', key: o._key })
    else if (Math.round(o.price * 100) !== Number((o.price * 100).toFixed(4))) {
      issues.push({ kind: 'tooManyDecimals', key: o._key })
    }
  }

  const byScope = new Map<Scope, Offer[]>()
  for (const o of list) {
    const s = scopeOf(o)
    const bucket = byScope.get(s)
    if (bucket) bucket.push(o)
    else byScope.set(s, [o])
  }

  for (const [scope, bucket] of byScope) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (rulesOverlap(bucket[i].availability, bucket[j].availability)) {
          issues.push({ kind: 'overlappingOffers', scope, keys: [bucket[i]._key, bucket[j]._key] })
        }
      }
    }
  }

  return issues
}
