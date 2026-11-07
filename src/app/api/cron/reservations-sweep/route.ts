/**
 * GET /api/cron/reservations-sweep — ADR-044 D10: expires lapsed holds, then
 * delivers due reservation_outbox emails. Called every 15 minutes by a Supabase
 * pg_cron job (supabase/drafts/reservations-pg-cron.sql), not by Vercel Cron.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, like the other cron routes.
 * Migration 066 not applied → 200 with `skipped` (never a 500). Idempotent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { bearerMatches } from '@/lib/api/shared-secret'
import { runReservationsSweep } from '@/lib/reservations/notifications/run.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const report = await runReservationsSweep()
    return NextResponse.json({ ok: true, ...report, ranAt: new Date().toISOString() })
  } catch (e) {
    console.error('[cron/reservations-sweep] failed:', e instanceof Error ? e.message : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
