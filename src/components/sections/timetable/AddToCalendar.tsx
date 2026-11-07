'use client'

// "Add to calendar" for one class in the details panel (ADR-045 / ADR-038). No subscription feed: a download
// (.ics, for Apple Calendar and Outlook) and a link into Google Calendar's own form.
//
// For a repeating class the visitor first chooses "this date only" or "the whole class". The .ics link goes to
// the site's own route (which re-checks the page's access); the Google link is built here from what the page
// already shows. Nothing about online meetings (join link, meeting number, passcode) is ever used.

import { CalendarPlus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { googleCalendarUrl } from '@/lib/calendar/ics'
import { repeatingRule, timetableEvent, timetableSeriesEvent } from '@/lib/calendar/timetable-event'
import { getAddToCalendarMessages } from '@/lib/i18n/add-to-calendar-messages'
import { describeClassRepeat } from '@/lib/scheduling/repeat-label'
import type { TimetableData, TimetableOccurrence, TimetableSeries } from '@/lib/modules/courses/timetable'

export type AddToCalendarProps = {
  occurrence: TimetableOccurrence
  series?: TimetableSeries
  data: TimetableData
  locale: string
  pageUrl?: string | null
  /** `${siteBase}/site-access/timetable-calendar`. Null/omitted = the .ics entry is not offered. */
  endpoint?: string | null
  /** The page (Sanity _id) and section (_key) the class is shown on: the .ics route re-gates them. */
  pageId?: string | null
  sectionKey?: string | null
}

const btn = 'inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--color-text-primary)_6%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]'
const btnStyle = { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-btn)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface)' } as const
const btnActive = { ...btnStyle, backgroundColor: 'color-mix(in srgb, var(--color-primary) 16%, var(--color-surface))', borderColor: 'var(--color-primary)' } as const

export function AddToCalendar({ occurrence, series, data, locale, pageUrl = null, endpoint = null, pageId = null, sectionKey = null }: AddToCalendarProps) {
  const msg = useMemo(() => getAddToCalendarMessages(locale), [locale])
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'occurrence' | 'series'>('occurrence')
  const panelId = useId()

  const repeats = !!repeatingRule(series)
  const host = typeof window === 'undefined' ? 'abluo.app' : window.location.hostname
  const input = { occurrence, series: series ?? null, data, locale, host, pageUrl, msg }
  const googleHref = useMemo(() => {
    const e = (scope === 'series' && repeats ? timetableSeriesEvent(input) : null) ?? timetableEvent(input)
    return e ? googleCalendarUrl(e) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, repeats, occurrence, series, data, locale, pageUrl, msg])

  if (occurrence.status === 'cancelled' || !data.courses[occurrence.courseId]) return null

  const icsHref =
    endpoint && pageId && sectionKey
      ? `${endpoint}?${new URLSearchParams({ page: pageId, section: sectionKey, occurrence: occurrence.id, date: occurrence.date, ...(scope === 'series' && repeats ? { scope: 'series' } : {}) }).toString()}`
      : null
  if (!icsHref && !googleHref) return null

  const repeat = series ? describeClassRepeat(series.rule, locale, { date: occurrence.date, withYear: true }) : ''

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" className={btn} style={btnStyle} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
          <CalendarPlus aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
          {msg.addToCalendar}
        </button>
      </div>
      {open && (
        <div id={panelId} className="flex flex-col gap-2">
          {repeats && (
            <div role="group" aria-label={msg.chooseWhat} className="flex flex-wrap gap-2">
              <button type="button" className={btn} style={scope === 'occurrence' ? btnActive : btnStyle} aria-pressed={scope === 'occurrence'} onClick={() => setScope('occurrence')}>
                {msg.thisDate}
              </button>
              <button type="button" className={btn} style={scope === 'series' ? btnActive : btnStyle} aria-pressed={scope === 'series'} onClick={() => setScope('series')}>
                {msg.wholeClass(repeat)}
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {icsHref && (
              <a href={icsHref} className={btn} style={btnStyle} download>
                {msg.appleOutlook}
              </a>
            )}
            {googleHref && (
              <a href={googleHref} className={btn} style={btnStyle} target="_blank" rel="noopener noreferrer">
                {msg.googleCalendar}
                <span className="sr-only"> ({msg.opensInNewTab})</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
