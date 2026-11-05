// Server-only. ── GET /{locale}/{project}/site-access/timetable (ADR-045) ───────
//
// Lets the Timetable section ask for another month. It answers with the same
// plain JSON the hydration produces and enforces the same rules, decided
// entirely on the server:
//
//   1. the project comes from the website address (as every visitor route);
//   2. the page is re-read and re-gated for THIS request (loadGatedPage):
//      a page the visitor may not see answers 404, like a page that is not there;
//   3. the section's own settings (courses shown, "show online details") come
//      from the stored section — never from the query string;
//   4. meeting details only when the section asks AND the gate granted the
//      visitor on a protected page (onlineDetailsAllowed).
//
// The query string carries only: page (Sanity _id), section (_key), month.
// Every response: `Cache-Control: private, no-store`.

import { NextResponse } from 'next/server'
import { tenantClient } from '@/lib/sanity/client'
import { pageHomeQuery } from '@/lib/sanity/queries'
import type { TimetableSection, WebsitePage } from '@/lib/sanity/types'
import { loadGatedPage } from '@/lib/access/page-gate.server'
import { isSupportedLocale, resolveAccessRouteProject } from '@/lib/access/request'
import { projectEnabledModuleIds } from '@/lib/access/visitor-routes'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { timetableForSection } from '@/lib/scheduling/timetable.server'
import { COURSES_MODULE_ID } from './model'
import { TIMETABLE_PAGE_REF_QUERY } from './queries'
import { sectionCourseIds } from './timetable-section.server'
import { addMonths, isMonth, monthOf, monthRange, onlineDetailsAllowed, todayIn } from './timetable'

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }
const MAX_ID = 128
/** How far from today a visitor may page, in months either way. */
export const MAX_MONTHS_AWAY = 24

type RouteParams = { locale: string; tenant: string }

const reply = (status: number, body: unknown = null) => NextResponse.json(body, { status, headers: NO_STORE })

/** Pure: the three query parameters, or null when any is missing, oversized or out of range. */
export function parseTimetableQuery(search: URLSearchParams, now: Date = new Date()): { pageId: string; sectionKey: string; month: string } | null {
  const pageId = search.get('page')
  const sectionKey = search.get('section')
  const month = search.get('month')
  if (!pageId || !sectionKey || pageId.length > MAX_ID || sectionKey.length > MAX_ID) return null
  if (!isMonth(month)) return null
  const here = monthOf(todayIn(null, now))
  if (month < addMonths(here, -MAX_MONTHS_AWAY - 1) || month > addMonths(here, MAX_MONTHS_AWAY + 1)) return null
  return { pageId, sectionKey, month }
}

export async function handleTimetable(request: Request, params: RouteParams): Promise<NextResponse> {
  const h = request.headers
  const fetchSite = h.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') return reply(403)
  if (!isSupportedLocale(params.locale)) return reply(404)
  const project = resolveAccessRouteProject(h.get('host'), params.tenant)
  if (!project) return reply(404)
  const query = parseTimetableQuery(new URL(request.url).searchParams)
  if (!query) return reply(400)

  try {
    const locale = params.locale
    const enabled = await projectEnabledModuleIds(project, locale)
    // Unreadable installation list = off (this route has no fail-open reason).
    if (!Array.isArray(enabled) || !enabled.includes(COURSES_MODULE_ID)) return reply(404)

    const defaultLocale = resolveScopeFromProjectSegment(project.segment)?.defaultLocale ?? locale
    const { fetchForTenant } = tenantClient(asUrlProjectSegment(project.segment))
    const ref = await fetchForTenant<{ pageType?: string; slug?: string } | null>(TIMETABLE_PAGE_REF_QUERY, { pageId: query.pageId, locale, defaultLocale })
    if (!ref) return reply(404)

    let page: WebsitePage | null
    let pageProtected = false
    if (ref.pageType === 'home') {
      // The home page is always public (no gate, no online details).
      page = await fetchForTenant<WebsitePage | null>(pageHomeQuery, { locale, defaultLocale })
    } else {
      if (!ref.slug) return reply(404)
      const gated = await loadGatedPage(project.segment, locale, defaultLocale, ref.slug, enabled)
      if (!gated.page || !gated.gate || gated.gate.kind === 'denied') return reply(404)
      page = gated.page
      pageProtected = gated.gate.kind === 'granted'
    }
    if (!page || page._id !== query.pageId) return reply(404)

    const section = (page.sections ?? []).find((s): s is TimetableSection => s._key === query.sectionKey && s._type === 'timetableSection')
    if (!section) return reply(404)

    const includeOnlineDetails = onlineDetailsAllowed({ showOnlineDetails: section.showOnlineDetails, pageProtected })
    const data = await timetableForSection(
      project.segment,
      { ...monthRange(query.month), coursePublicIds: sectionCourseIds(section), includeOnlineDetails, locale, defaultLocale },
      { fetchForTenant },
    )
    return reply(200, data)
  } catch {
    return reply(503)
  }
}
