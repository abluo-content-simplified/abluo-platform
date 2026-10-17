'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'

const svg = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

export const EVENT_ICONS = {
  back: svg('M15 18l-6-6 6-6'),
  plus: svg('M12 5v14M5 12h14'),
  calendar: svg('M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'),
  pin: svg('M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'),
  photo: svg('M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01'),
}

export type EventState = 'live' | 'changes' | 'draft'

export function eventState(e: { isPublished: boolean; hasDraft: boolean }): EventState {
  if (!e.isPublished) return 'draft'
  return e.hasDraft ? 'changes' : 'live'
}

const TONE: Record<EventState, PillTone> = { live: 'success', changes: 'highlight', draft: 'outline' }

/** Published · Unpublished changes · Not published yet. */
export function EventStatePill({ state }: { state: EventState }) {
  const t = useTranslations('clientDashboard.events.state')
  return (
    <Pill tone={TONE[state]} icon={state === 'live' ? <span aria-hidden="true" className="size-1.5 rounded-full bg-success" /> : undefined}>
      {t(state)}
    </Pill>
  )
}

/** "Sat 12 Apr 2026, 09:00 – Mon 14 Apr, 20:00" in the viewer's language and time zone. */
export function useEventDates() {
  const ui = useLocale()
  return (start: string | null, end: string | null): string => {
    if (!start) return ''
    const s = new Date(start)
    if (Number.isNaN(s.getTime())) return ''
    const day: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
    const full = new Intl.DateTimeFormat(ui, { ...day, ...time })
    if (!end) return full.format(s)
    const e = new Date(end)
    if (Number.isNaN(e.getTime())) return full.format(s)
    const sameDay = s.toDateString() === e.toDateString()
    try {
      return sameDay
        ? `${full.format(s)} – ${new Intl.DateTimeFormat(ui, time).format(e)}`
        : full.formatRange(s, e)
    } catch {
      return `${full.format(s)} – ${full.format(e)}`
    }
  }
}
