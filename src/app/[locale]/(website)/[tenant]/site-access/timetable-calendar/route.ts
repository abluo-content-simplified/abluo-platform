/**
 * ADR-045 / ADR-038 — "Add to calendar": the .ics file of one timetable session (or of the whole repeating class).
 * All logic lives in src/lib/modules/courses/timetable-calendar-route.server.ts
 * (it re-runs the page gate; never writes meeting details into the file).
 */
import type { NextRequest } from 'next/server'
import { handleTimetableCalendar } from '@/lib/modules/courses/timetable-calendar-route.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string; tenant: string }> }) {
  return handleTimetableCalendar(request, await params)
}
