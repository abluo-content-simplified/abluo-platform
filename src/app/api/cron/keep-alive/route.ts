import { NextRequest, NextResponse } from 'next/server'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/keep-alive
 *
 * Supabase pauses free-tier projects after 7 days with no API activity —
 * that's what took Livener's contact form down (2026-07-27). This route is
 * hit once a day by a Vercel Cron Job (see vercel.json) purely to generate
 * activity and reset that 7-day clock. Read-only — selects a single id from
 * `tenants`, writes nothing.
 *
 * This is a stopgap for the free-tier limit, not a substitute for it: a
 * missed/misfiring cron run still leaves the project exposed to pausing.
 * Moving Supabase to a paid plan removes the pause behavior entirely and
 * should happen before onboarding more tenants onto the shared instance.
 *
 * Auth: Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}`
 * when invoking a scheduled Cron Job, provided a `CRON_SECRET` env var is
 * set on the project. Reject anything else so this can't be hit publicly.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')

  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { error } = await runAsTrustedSystemOperation(
      'Vercel Cron keep-alive ping — no user session exists for a scheduled job; ' +
        'reads a single tenants.id to generate API activity and reset the free-tier pause clock.',
      async (supabase) => supabase.from('tenants').select('id').limit(1)
    )

    if (error) {
      console.error('[cron/keep-alive] Supabase ping failed:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/keep-alive] unexpected error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
