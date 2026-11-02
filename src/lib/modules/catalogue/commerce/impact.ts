// ── Catalogue commerce — availability impact (C5-6) ───────────────────────────
//
// Pure, instant-free diff of two complete input sets over the same items. A
// change = the weekly profile of the effective rule differs (so a schedule
// edit 18:00–23:00 → 18:30–23:00 counts, with its minutes). Never edits rules:
// "preserving explicit overrides" is a property of the inputs, not an action.

import { availableSometime, profileStateAt, weekProfile } from './availability-schedule'
import { effectiveRule, type AvailabilityInputs, type ItemAvailabilityInput } from './channel-availability'
import { asChannelKey, type ChannelKey, type FormatKey, type WeekProfile } from './commerce-types'

export type AvailabilityChange = {
  itemId: string
  formatKey: FormatKey
  channel: ChannelKey
  before: WeekProfile
  after: WeekProfile
  /** Minutes of the week that become available. */
  minutesToAvailable: number
  /** Minutes of the week that become unavailable. */
  minutesToUnavailable: number
}

export type AvailabilityImpact = {
  changes: readonly AvailabilityChange[]
  itemsChanged: number
  formatsChanged: number
  /**
   * Counted in formats. gain = was never available on the channel and now is at some time;
   * lose = was available at some time and now never is; scheduleOnly = available in both, at different times.
   */
  byChannel: Readonly<Record<ChannelKey, { gainAvailability: number; loseAvailability: number; scheduleOnly: number }>>
  /** (item, format, channel) whose upstream rule changed but an explicit item/format rule kept the result. */
  shieldedByOverride: number
}

const sameProfile = (a: WeekProfile, b: WeekProfile) => a.length === b.length && a.every((p, i) => p.start === b[i].start && p.end === b[i].end && p.state === b[i].state)

function diffMinutes(before: WeekProfile, after: WeekProfile): { toAvailable: number; toUnavailable: number } {
  const cuts = [...new Set([...before.flatMap((p) => [p.start, p.end]), ...after.flatMap((p) => [p.start, p.end])])].sort((a, b) => a - b)
  let toAvailable = 0
  let toUnavailable = 0
  for (let i = 0; i < cuts.length - 1; i++) {
    const b = profileStateAt(before, cuts[i])
    const a = profileStateAt(after, cuts[i])
    const len = cuts[i + 1] - cuts[i]
    if (b === 'unavailable' && a === 'available') toAvailable += len
    if (b === 'available' && a === 'unavailable') toUnavailable += len
  }
  return { toAvailable, toUnavailable }
}

export function availabilityImpact(before: AvailabilityInputs, after: AvailabilityInputs, items: readonly ItemAvailabilityInput[]): AvailabilityImpact {
  const channelKeys = [...new Set([...before.channels.all.map((c) => c.key as string), ...after.channels.all.map((c) => c.key as string)])].map(asChannelKey)
  const changes: AvailabilityChange[] = []
  const byChannel: Record<string, { gainAvailability: number; loseAvailability: number; scheduleOnly: number }> = {}
  let shieldedByOverride = 0
  for (const item of items) {
    for (const f of item.formats) {
      for (const channel of channelKeys) {
        const ctx = { kind: 'channel' as const, channel }
        const eb = effectiveRule(before, item, f.key, ctx)
        const ea = effectiveRule(after, item, f.key, ctx)
        const pb = weekProfile(eb.rule)
        const pa = weekProfile(ea.rule)
        if (sameProfile(pb, pa)) {
          const explicit = (s: typeof eb.source) => s.level === 'item' || s.level === 'format'
          if (explicit(eb.source) && explicit(ea.source) && eb.inherited && ea.inherited && !sameProfile(weekProfile(eb.inherited.rule), weekProfile(ea.inherited.rule))) shieldedByOverride++
          continue
        }
        const { toAvailable, toUnavailable } = diffMinutes(pb, pa)
        changes.push({ itemId: item.itemId, formatKey: f.key, channel, before: pb, after: pa, minutesToAvailable: toAvailable, minutesToUnavailable: toUnavailable })
        const bucket = (byChannel[channel] ??= { gainAvailability: 0, loseAvailability: 0, scheduleOnly: 0 })
        const wasSometime = availableSometime(eb.rule)
        const isSometime = availableSometime(ea.rule)
        if (!wasSometime && isSometime) bucket.gainAvailability++
        else if (wasSometime && !isSometime) bucket.loseAvailability++
        else bucket.scheduleOnly++
      }
    }
  }
  return {
    changes,
    itemsChanged: new Set(changes.map((c) => c.itemId)).size,
    formatsChanged: new Set(changes.map((c) => `${c.itemId}\u0000${c.formatKey}`)).size,
    byChannel,
    shieldedByOverride,
  }
}

/** Counts for audit payloads (C12 §12.3 `impact = impactCounts(availabilityImpact(...))`). */
export function impactCounts(impact: AvailabilityImpact): { itemsChanged: number; formatsChanged: number; shieldedByOverride: number } {
  return { itemsChanged: impact.itemsChanged, formatsChanged: impact.formatsChanged, shieldedByOverride: impact.shieldedByOverride }
}
