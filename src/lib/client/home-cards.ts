/**
 * Pure helpers for the dashboard Home (canvas "Main"): greeting by time of
 * day, how far a draft got (the 4-segment bar), and "2 h ago".
 */
import { WIZARD_STEP_ORDER } from '@/lib/client/wizard-steps'
import type { WizardStep } from '@/lib/api/post-drafts'

export type PartOfDay = 'morning' | 'afternoon' | 'evening'

/** 05–11 morning, 12–17 afternoon, otherwise evening (viewer's local hour). */
export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

/** First-pass steps in order (what the bar measures). */
const PASS: WizardStep[] = ['category', 'title', 'story', 'cover', 'languages', 'cta', 'gallery', 'preview', 'publish']

/** 0…1: how far the first pass got (overview / later = 1). */
export function draftProgress(step: WizardStep): number {
  const rank = WIZARD_STEP_ORDER.indexOf(step)
  if (rank >= WIZARD_STEP_ORDER.indexOf('publish')) return 1
  const at = PASS.indexOf(step)
  if (at < 0) return 0
  return Math.max(0, Math.min(1, (at + 1) / PASS.length))
}

/** Fill of each of `segments` bars (0…1 each) for a progress fraction. */
export function segmentFills(progress: number, segments = 4): number[] {
  const p = Math.max(0, Math.min(1, progress)) * segments
  return Array.from({ length: segments }, (_, i) => Math.max(0, Math.min(1, p - i)))
}

/** "2 h ago", "yesterday", "3 days ago" in the viewer's language. */
export function timeAgo(iso: string, locale: string, now = Date.now()): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const s = Math.round((at - now) / 1000)
  const abs = Math.abs(s)
  let rtf: Intl.RelativeTimeFormat
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })
  }
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  return rtf.format(Math.round(s / (86400 * 30)), 'month')
}

/** Contact requests: how many this week (last 7 days) and how many are still unanswered (status "new"). */
export function requestCounts(rows: readonly { status: string; createdAt: string }[], now = Date.now()): { week: number; open: number } {
  const since = now - 7 * 86400 * 1000
  return {
    week: rows.filter((r) => Date.parse(r.createdAt) >= since).length,
    open: rows.filter((r) => r.status === 'new').length,
  }
}

const DAY_MS = 86400 * 1000

/** Days in a "this week" window for contact requests. */
export const REQUEST_WEEK_DAYS = 7

/**
 * Contact requests this week and the week before. `previous` is null when the
 * rows read do not reach back two full weeks (the read hit its `limit`), so a
 * delta is only ever shown when it is true.
 */
export function requestTrend(
  rows: readonly { createdAt: string }[],
  limit: number,
  now = Date.now(),
): { week: number; previous: number | null } {
  const weekStart = now - REQUEST_WEEK_DAYS * DAY_MS
  const prevStart = now - 2 * REQUEST_WEEK_DAYS * DAY_MS
  const times = rows.map((r) => Date.parse(r.createdAt)).filter((t) => !Number.isNaN(t))
  const week = times.filter((t) => t >= weekStart).length
  const complete = rows.length < limit || times.some((t) => t < prevStart)
  return { week, previous: complete ? times.filter((t) => t >= prevStart && t < weekStart).length : null }
}

/**
 * Whole-number % change from `previous` to `current`, or null when there is
 * nothing honest to say (no previous period, or it was zero).
 */
export function percentChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

/**
 * `/{projectSlug}/{segment}` for a registered nav surface, or null when the
 * registry has no such entry. Home derives every link from the registry.
 */
export function navHref(
  projectSlug: string,
  navId: string,
  registry: readonly { kind: string; id: string; segment?: string }[],
  query?: Record<string, string>,
): string | null {
  const entry = registry.find((s) => s.kind === 'nav' && s.id === navId)
  if (!entry?.segment) return null
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : ''
  return `/${projectSlug}/${entry.segment}${qs}`
}
