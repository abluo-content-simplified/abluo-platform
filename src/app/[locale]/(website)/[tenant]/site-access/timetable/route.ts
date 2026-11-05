/**
 * ADR-045 — the Timetable section asks for another month.
 * All logic lives in src/lib/modules/courses/timetable-route.server.ts
 * (it re-runs the page gate; meeting details only for a granted visitor).
 */
import type { NextRequest } from 'next/server'
import { handleTimetable } from '@/lib/modules/courses/timetable-route.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string; tenant: string }> }) {
  return handleTimetable(request, await params)
}
