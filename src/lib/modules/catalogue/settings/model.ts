// ── Catalogue settings — the pure model of catalogueSettingsService (C2, C3-6, C11, D-1, D-14) ──
//
// Pure: no I/O, no clock. Parses Setup input into stored module-config values
// and works out which channel events a change is (C2 I-C2-4). The service reads,
// validates with these, previews impact and commits one key-level, revision-guarded
// patch on the project document.

import { websiteLabel } from '@/lib/tag-text'
import { isValidTermKey } from '@/lib/taxonomy/ids'
import { LABEL_MAX } from '../taxonomy/limits'
import { WEEKLY_OVERRIDE_TYPE, readSchedule } from '../commerce/availability-schedule'
import { channelSetOf, type Channel, type ChannelSet } from '../commerce/channels'
import { asChannelKey, isChannelAvailabilityState, type ChannelAvailabilityState, type ScheduledOverride } from '../commerce/commerce-types'
import { QUANTITY_UNITS, type FormatTemplate, type QuantityUnit } from '../commerce/formats'
import { isItemProfile, type ItemProfile } from '../profiles'

export type SettingsIssue = { field: string; code: string; index?: number; key?: string }

// ── labels ──────────────────────────────────────────────────────────────────

/** A localized label from Setup: only site locales, website-label rule, each ≤ 80. `requireDefault` → the main language must be present. */
export function parseLabel(raw: unknown, site: { defaultLocale: string; locales: readonly string[] }, field: string, requireDefault: boolean): { ok: true; value: Record<string, string> } | { ok: false; issue: SettingsIssue } {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) return { ok: false, issue: { field, code: 'labelInvalid' } }
  const out: Record<string, string> = {}
  for (const [locale, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (locale.startsWith('_') || v === null || v === undefined || v === '') continue
    if (!site.locales.includes(locale)) return { ok: false, issue: { field, code: 'labelLocaleUnknown', key: locale } }
    if (typeof v !== 'string') return { ok: false, issue: { field, code: 'labelInvalid', key: locale } }
    const text = websiteLabel(v).trim()
    if (text.length > LABEL_MAX) return { ok: false, issue: { field, code: 'labelTooLong', key: locale } }
    if (text) out[locale] = text
  }
  if (requireDefault && !out[site.defaultLocale]) return { ok: false, issue: { field, code: 'labelRequired', key: site.defaultLocale } }
  return { ok: true, value: out }
}

// ── channels ────────────────────────────────────────────────────────────────

export type ChannelInput = {
  key: string
  label: Record<string, string>
  active: boolean
  defaultAvailability: ChannelAvailabilityState
  /** Weekly overrides of the default (C5a): { key?, days?, from, to, state }. */
  defaultSchedule?: readonly unknown[]
}

/** Setup's override rows → the stored members (`catalogueWeeklyOverride`), then read back by the ONE schedule reader. */
export function scheduleFromInput(raw: readonly unknown[] | undefined): { overrides: ScheduledOverride[]; issues: string[] } {
  const rows = (Array.isArray(raw) ? raw : []).map((o, i) => {
    const x = (o ?? {}) as Record<string, unknown>
    const key = typeof x.key === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.key) ? x.key : `s${i + 1}`
    return { _key: key, _type: WEEKLY_OVERRIDE_TYPE, days: x.days, from: x.from, to: x.to, state: x.state }
  })
  const read = readSchedule(rows)
  return { overrides: read.overrides, issues: read.issues }
}

/** Channel list input → `Channel[]` in the given order, carrying the stored `_key` of an existing entry. Structural problems are issues. */
export function channelsFromInput(input: unknown, previous: readonly Channel[], site: { defaultLocale: string; locales: readonly string[] }): { channels: Channel[]; issues: SettingsIssue[] } {
  const issues: SettingsIssue[] = []
  const list = Array.isArray(input) ? input : null
  if (!list) return { channels: [], issues: [{ field: 'channels', code: 'invalid' }] }
  const channels: Channel[] = []
  list.forEach((raw, index) => {
    const c = (raw ?? {}) as Partial<ChannelInput>
    if (typeof c.key !== 'string' || !isChannelAvailabilityState(c.defaultAvailability) || typeof c.active !== 'boolean') {
      issues.push({ field: 'channels', code: 'invalid', index })
      return
    }
    const sched = scheduleFromInput(c.defaultSchedule)
    for (const code of sched.issues) issues.push({ field: 'channels', code, index, key: c.key })
    const parsed = parseLabel(c.label, site, 'channels', false)
    if (!parsed.ok) issues.push({ ...parsed.issue, index, key: c.key })
    const label = parsed.ok ? parsed.value : {}
    const before = previous.find((p) => p.key === c.key)
    channels.push({ key: asChannelKey(c.key), label, active: c.active, defaultAvailability: c.defaultAvailability, defaultSchedule: sched.overrides, entryKey: before?.entryKey ?? `ch-${c.key}`, explicitDefault: true })
  })
  return { channels, issues }
}

/** A channel as stored in `serviceChannels` (C2-3): `value` = key, both attributes ALWAYS explicit (C10: no read default for written entries). */
export function channelEntry(c: Channel): Record<string, unknown> {
  return {
    _key: c.entryKey ?? `ch-${c.key}`,
    _type: 'serviceChannelsEntry',
    value: c.key,
    label: { _type: 'localizedString', ...(typeof c.label === 'string' ? {} : c.label) },
    active: c.active,
    defaultAvailability: c.defaultAvailability,
    ...(c.defaultSchedule.length > 0 && {
      defaultSchedule: c.defaultSchedule.map((o) => ({
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

/** Raw stored entries re-written with explicit attributes (keeps unknown fields of an entry). */
export function channelEntries(next: readonly Channel[], storedRaw: unknown): Record<string, unknown>[] {
  const raw = Array.isArray(storedRaw) ? (storedRaw as Record<string, unknown>[]) : []
  return next.map((c) => {
    const stored = raw.find((e) => e && e.value === c.key)
    const entry = channelEntry(c)
    if (!stored) return entry
    const { defaultSchedule: _drop, ...rest } = stored
    void _drop
    return { ...rest, ...entry }
  })
}

export type ChannelEvent =
  | { kind: 'channel.activated'; channelKey: string; defaultAvailability: ChannelAvailabilityState }
  | { kind: 'channel.deactivated'; channelKey: string }
  | { kind: 'channel.default_changed'; channelKey: string; before: Channel; after: Channel }

const sameDefault = (a: Channel, b: Channel) => a.defaultAvailability === b.defaultAvailability && JSON.stringify(a.defaultSchedule) === JSON.stringify(b.defaultSchedule)

/**
 * C2 I-C2-4 — which rule changes a new list is: activation (incl. a NEW active channel),
 * deactivation, and a default (baseline or schedule) change of a channel that stays. A label or
 * order change is no event. A channel both re-defaulted and (de)activated yields both.
 */
export function channelEvents(previous: readonly Channel[], next: readonly Channel[]): ChannelEvent[] {
  const out: ChannelEvent[] = []
  for (const n of next) {
    const p = previous.find((x) => x.key === n.key)
    if (!p) {
      if (n.active) out.push({ kind: 'channel.activated', channelKey: n.key, defaultAvailability: n.defaultAvailability })
      continue
    }
    if (!p.active && n.active) out.push({ kind: 'channel.activated', channelKey: n.key, defaultAvailability: n.defaultAvailability })
    if (p.active && !n.active) out.push({ kind: 'channel.deactivated', channelKey: n.key })
    if (!sameDefault(p, n)) out.push({ kind: 'channel.default_changed', channelKey: n.key, before: p, after: n })
  }
  return out
}

/** The channel set as it would be if only `event` happened (exact per-event impact; others unchanged). */
export function channelSetWithOnly(previous: readonly Channel[], next: readonly Channel[], channelKey: string): ChannelSet {
  const changed = next.find((c) => c.key === channelKey)
  const base = previous.some((c) => c.key === channelKey) ? previous.map((c) => (c.key === channelKey && changed ? changed : c)) : [...previous, ...(changed ? [changed] : [])]
  return channelSetOf(base)
}

// ── other settings ──────────────────────────────────────────────────────────

/** C3-6 format templates: `{ key, label, quantity? }`, unique keys, main-language label. */
export function formatTemplatesFromInput(raw: unknown, site: { defaultLocale: string; locales: readonly string[] }): { value: Record<string, unknown>[]; issues: SettingsIssue[] } {
  const issues: SettingsIssue[] = []
  const list = Array.isArray(raw) ? raw : null
  if (!list) return { value: [], issues: [{ field: 'formatTemplates', code: 'invalid' }] }
  const seen = new Set<string>()
  const value = list.flatMap((r, index): Record<string, unknown>[] => {
    const t = (r ?? {}) as Partial<FormatTemplate> & { quantity?: { value?: unknown; unit?: unknown } | null }
    if (!isValidTermKey(t.key) || seen.has(t.key)) {
      issues.push({ field: 'formatTemplates', code: seen.has(String(t.key)) ? 'keyDuplicate' : 'keyInvalid', index })
      return []
    }
    seen.add(t.key)
    const label = parseLabel(t.label, site, 'formatTemplates', true)
    if (!label.ok) {
      issues.push({ ...label.issue, index })
      return []
    }
    let quantity: { value: number; unit: QuantityUnit } | null = null
    if (t.quantity) {
      const v = t.quantity.value
      const u = t.quantity.unit
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || !QUANTITY_UNITS.includes(u as QuantityUnit)) {
        issues.push({ field: 'formatTemplates', code: 'quantityInvalid', index })
        return []
      }
      quantity = { value: v, unit: u as QuantityUnit }
    }
    return [{ _key: t.key, _type: 'catalogueFormatTemplate', key: t.key, label: { _type: 'localizedString', ...label.value }, ...(quantity && { quantity }) }]
  })
  return { value, issues }
}

/** `dietaryTags` (the controlled dietary vocabulary, REVIEW X-10): `{ value, label }`, unique valid keys, main-language label. */
export function dietaryTagsFromInput(raw: unknown, storedRaw: unknown, site: { defaultLocale: string; locales: readonly string[] }): { value: Record<string, unknown>[]; issues: SettingsIssue[] } {
  const issues: SettingsIssue[] = []
  const list = Array.isArray(raw) ? raw : null
  if (!list) return { value: [], issues: [{ field: 'dietaryTags', code: 'invalid' }] }
  const stored = Array.isArray(storedRaw) ? (storedRaw as Record<string, unknown>[]) : []
  const seen = new Set<string>()
  const value = list.flatMap((r, index): Record<string, unknown>[] => {
    const e = (r ?? {}) as { value?: unknown; label?: unknown }
    if (!isValidTermKey(e.value) || seen.has(e.value)) {
      issues.push({ field: 'dietaryTags', code: seen.has(String(e.value)) ? 'keyDuplicate' : 'keyInvalid', index })
      return []
    }
    seen.add(e.value)
    const label = parseLabel(e.label, site, 'dietaryTags', true)
    if (!label.ok) {
      issues.push({ ...label.issue, index })
      return []
    }
    const before = stored.find((s) => s && s.value === e.value)
    return [{ _key: typeof before?._key === 'string' ? before._key : `dt-${e.value}`, _type: 'dietaryTagsEntry', value: e.value, label: { _type: 'localizedString', ...label.value } }]
  })
  return { value, issues }
}

export const removedValues = (storedRaw: unknown, next: readonly Record<string, unknown>[]): string[] => {
  const keep = new Set(next.map((e) => e.value))
  return (Array.isArray(storedRaw) ? (storedRaw as Record<string, unknown>[]) : []).map((e) => e?.value).filter((v): v is string => typeof v === 'string' && !keep.has(v))
}

export const parseProfile = (v: unknown): { ok: true; value: ItemProfile | null } | { ok: false } => (v === null || v === '' ? { ok: true, value: null } : isItemProfile(v) ? { ok: true, value: v } : { ok: false })

export const SETUP_SOURCES = ['empty', 'pack', 'manual'] as const
export type SetupSource = (typeof SETUP_SOURCES)[number]
