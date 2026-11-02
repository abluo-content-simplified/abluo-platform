// ── Catalogue commerce — the composed public question (C5-5) ──────────────────
//
// "Can this be obtained on context X at instant T, and at what price?" is
// answered ONLY by resolveOffering (point-in-time) or publicCommerce
// (instant-free, for cached pages). Availability is computed first and is
// never changed by the price answer (D-6 independence; K-3 rules 9–10):
// available + noPrice = available with 'price.missing'.

import { availableSometime, weekProfile } from './availability-schedule'
import {
  availabilityMatrix,
  explainAvailability,
  type AvailabilityExplanation,
  type AvailabilityInputs,
  type ItemAvailabilityInput,
} from './channel-availability'
import { publicContexts } from './channels'
import type { FormatKey, LocalizedText, OfferingContext, WeekProfile } from './commerce-types'
import type { Format } from './formats'
import { displayPrices, effectiveCurrency, resolvePrice, type Price, type PriceResolution } from './prices'

export type EffectiveOffer =
  | { kind: 'unavailable'; availability: AvailabilityExplanation }
  | { kind: 'available'; availability: AvailabilityExplanation; price: PriceResolution; issues: readonly ('price.missing' | 'price.ambiguous' | 'price.indeterminate')[] }

export type CommerceItemInput = Omit<ItemAvailabilityInput, 'formats'> & { formats: readonly Format[] }

const NO_PRICES: Pick<Format, 'prices'> = { prices: [] }

/**
 * explainAvailability(at, tz) → (if available) resolvePrice(at, tz). Price windows never shorten or extend
 * availability; availability schedules never choose a price. The zone is required; a caller without a
 * project zone uses availableNow(), which returns 'scheduleOnly'.
 */
export function resolveOffering(
  inputs: AvailabilityInputs,
  item: CommerceItemInput,
  formatKey: FormatKey,
  ctx: OfferingContext,
  at: Date,
  timeZone: string,
  project: { currency: string },
): EffectiveOffer {
  const availability = explainAvailability(inputs, item, formatKey, ctx, at, timeZone)
  if (availability.state === 'unavailable') return { kind: 'unavailable', availability }
  const format = item.formats.find((f) => f.key === formatKey) ?? NO_PRICES
  const price = resolvePrice(format, ctx, at, timeZone, inputs.channels, project)
  const issues: ('price.missing' | 'price.ambiguous' | 'price.indeterminate')[] =
    price.kind === 'noPrice' ? ['price.missing'] : price.kind === 'ambiguous' ? ['price.ambiguous'] : price.kind === 'indeterminate' ? ['price.indeterminate'] : []
  return { kind: 'available', availability, price, issues }
}

export type PublicCommerce = {
  formats: readonly {
    key: FormatKey
    label: LocalizedText | null
    /** Per public context: its weekly profile. For "Served 18:00–23:00" display and client-side re-evaluation. */
    availability: readonly { context: OfferingContext; profile: WeekProfile; availableSometime: boolean }[]
    /** displayPrices — instant-free. */
    prices: readonly Price[]
  }[]
  /** Any format available at some time in some public context. Does NOT decide website presence (D-4). */
  availableSomewhere: boolean
  currency: string
}

/** Instant-free for cached public pages: effective rules (as weekly profiles) + displayPrices per format. Contains no "now". */
export function publicCommerce(inputs: AvailabilityInputs, item: CommerceItemInput, project: { currency: string }): PublicCommerce {
  const matrix = availabilityMatrix(inputs, item)
  const contexts = publicContexts(inputs.channels)
  const formats = item.formats.map((f) => {
    const m = matrix.get(f.key)!
    const availability = contexts.map((context) => {
      const e = m.get(context.kind === 'general' ? 'general' : context.channel)!
      return { context, profile: weekProfile(e.rule), availableSometime: availableSometime(e.rule) }
    })
    return { key: f.key, label: f.label, availability, prices: displayPrices(f, m, inputs.channels) }
  })
  return {
    formats,
    availableSomewhere: formats.some((f) => f.availability.some((a) => a.availableSometime)),
    currency: effectiveCurrency(project),
  }
}

