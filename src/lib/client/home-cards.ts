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
