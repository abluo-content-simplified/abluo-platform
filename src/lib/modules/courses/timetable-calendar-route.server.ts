// Server-only. ── GET /{locale}/{project}/site-access/timetable-calendar (ADR-045, ADR-038) ──
//
// The .ics file behind "Add to calendar". Same rules as the month route (timetable-route.server.ts):
//
//   1. the project comes from the website address;
//   2. the page is re-read and re-gated for THIS request (resolveTimetableSection): a page the visitor may
//      not see answers 404, like a page that is not there — a forwarded link does not open a members page;
//   3. the courses come from the stored section; only visible courses (published, not archived) are read;
//   4. the session must exist in this project's data for that course (otherwise 404);
//   5. the file NEVER carries meeting ids, passcodes or join links: online details are not requested at all.
//
// The query string carries only: page (Sanity _id), section (_key), occurrence (id), date (the session's
// 'YYYY-MM-DD', to read one narrow window) and optionally scope=series. The page URL in the file is built
// here, never taken from the request. One scheduling window read + the course/People/site reads of the
// timetable reader. Cached nowhere: `Cache-Control: private, no-store`.

import { NextResponse } from 'next/server'
import { timetableForSection } from '@/lib/scheduling/timetable.server'
import { addDays } from '@/lib/scheduling/recurrence'
import { accessSiteBase } from '@/lib/access/request'
import { buildIcs } from '@/lib/calendar/ics'
import { icsFileName, repeatingRule, SERIES_LOOKAHEAD_DAYS, timetableEvent, timetableSeriesEvent } from '@/lib/calendar/timetable-event'
import { getAddToCalendarMessages } from '@/lib/i18n/add-to-calendar-messages'
import { isDate } from './timetable'
import { sectionCourseIds } from './timetable-section.server'
import { resolveTimetableSection, type RouteParams } from './timetable-route.server'

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }
const MAX_ID = 128
const MAX_RANGE_FROM_TODAY_DAYS = 800

const refuse = (status: number) => new NextResponse(null, { status, headers: NO_STORE })

export type TimetableCalendarQuery = { pageId: string; sectionKey: string; occurrenceId: string; date: string; scope: 'occurrence' | 'series' }

/** Pure: the query parameters, or null when any is missing, oversized or malformed. */
export function parseCalendarQuery(search: URLSearchParams): TimetableCalendarQuery | null {
  const pageId = search.get('page')
  const sectionKey = search.get('section')
  const occurrenceId = search.get('occurrence')
  const date = search.get('date')
  const scopeRaw = search.get('scope')
  if (!pageId || !sectionKey || !occurrenceId || pageId.length > MAX_ID || sectionKey.length > MAX_ID || occurrenceId.length > MAX_ID) return null
  if (!isDate(date)) return null
  if (scopeRaw !== null && scopeRaw !== 'series' && scopeRaw !== 'occurrence') return null
  return { pageId, sectionKey, occurrenceId, date, scope: scopeRaw === 'series' ? 'series' : 'occurrence' }
}

/** The canonical host for UIDs: the request host without port or a leading "www.". */
function uidHost(host: string | null): string {
  const h = (host ?? '').toLowerCase().split(':')[0].replace(/^www\./, '')
  return /^[a-z0-9.-]+$/.test(h) && h ? h : 'abluo.app'
}

export async function handleTimetableCalendar(request: Request, params: RouteParams): Promise<NextResponse> {
  const query = parseCalendarQuery(new URL(request.url).searchParams)
  if (!query) return refuse(400)
  try {
    const access = await resolveTimetableSection(request, params, { pageId: query.pageId, sectionKey: query.sectionKey })
    if (access.status !== undefined) return refuse(access.status)
    const { project, locale, defaultLocale, fetchForTenant, section, slug } = access

    const today = new Date().toISOString().slice(0, 10)
    if (query.date < addDays(today, -MAX_RANGE_FROM_TODAY_DAYS) || query.date > addDays(today, MAX_RANGE_FROM_TODAY_DAYS)) return refuse(400)

    const to = query.scope === 'series' ? addDays(query.date, SERIES_LOOKAHEAD_DAYS) : query.date
    const data = await timetableForSection(
      project.segment,
      // Online details are NEVER requested for a calendar file.
      { from: query.date, to, coursePublicIds: sectionCourseIds(section), includeOnlineDetails: false, includeEvents: false, locale, defaultLocale },
      { fetchForTenant },
    )
    const occurrence = data.occurrences.find((o) => o.id === query.occurrenceId && o.date === query.date)
    // Not found = not in this project, not a visible course, or not on that date.
    if (!occurrence || occurrence.status === 'cancelled' || !data.courses[occurrence.courseId]) return refuse(404)

    const host = request.headers.get('host')
    const proto = /^(localhost|127\.)/.test(host ?? '') ? 'http' : 'https'
    const siteBase = accessSiteBase(locale, project)
    const pageUrl = host ? `${proto}://${host}${siteBase}${slug ? `/${slug}` : ''}` : null
    const input = {
      occurrence,
      series: data.series.find((s) => s.id === occurrence.seriesId) ?? null,
      data,
      locale,
      host: uidHost(host),
      pageUrl,
      msg: getAddToCalendarMessages(locale),
    }
    // "series" on a class that does not repeat falls back to the one session.
    const event = (query.scope === 'series' && repeatingRule(input.series) ? timetableSeriesEvent(input) : null) ?? timetableEvent(input)
    const ics = event ? buildIcs(event) : null
    if (!ics) return refuse(404)

    const name = icsFileName(data.courses[occurrence.courseId].title, occurrence.date)
    return new NextResponse(ics, {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` },
    })
  } catch {
    return refuse(503)
  }
}
