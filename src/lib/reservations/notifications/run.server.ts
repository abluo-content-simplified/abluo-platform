// Server-only (service role). Not marked with the 'server-only' package so the
// cron route can be imported by the route-auth matrix test; nothing here is
// reachable from a client bundle (it imports the service-role client).
// ── Reservations — the sweep: expire holds, then deliver the outbox (ADR-044 D10)
import { randomBytes } from 'crypto'
import { getAppEnvironment } from '@/lib/notifications/environment'
import { safeReplyTo } from '@/lib/notifications/branding'
import { sendEmail } from '@/lib/notifications/resend'
import { tenantClient } from '@/lib/sanity/client'
import { asProjectSlug } from '@/lib/tenancy/ids'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { createSupabaseReservationStore, type ReservationDb } from '../server/store'
import { runSweep, type SweepResult } from '../service/sweep'
import type { ServiceDeps } from '../service/types'
import { processOutbox, type ConsumerResult, type SiteContext } from './consumer'
import { createContentLoader } from './data'
import { createSupabaseOutboxRepo } from './outbox'
import { RESERVATION_SITE_QUERY } from './queries'

const REASON = 'ADR-044 reservations sweep: expire holds and deliver reservation_outbox emails (server-only tables, migration 066)'
const TIME_BUDGET_MS = 45_000

export type SweepReport =
  | { skipped: 'reservations unavailable' }
  | { skipped?: undefined; holds: SweepResult | { error: string }; outbox: ConsumerResult }

/** Site facts: Supabase for identity, Sanity (Website Settings) for name, time zone, contact address, logo. One read per project per run. */
function siteLoader(db: ReservationDb) {
  const cache = new Map<string, Promise<SiteContext | null>>()
  const load = async (projectId: string): Promise<SiteContext | null> => {
    const { data } = await db.from('projects').select('slug, name, custom_domain, default_locale').eq('id', projectId).limit(1)
    const p = Array.isArray(data) ? data[0] : null
    if (!p) return null
    let cfg: { siteName?: string | null; timeZone?: string | null; email?: string | null; logoUrl?: string | null } | null = null
    try {
      cfg = await tenantClient(asProjectSlug(String(p.slug))).fetchForTenant(RESERVATION_SITE_QUERY)
    } catch (err) {
      // Unbranded is better than silent: fall back to the project name and send.
      console.error('[reservations] site settings read failed for a project:', err instanceof Error ? err.message : String(err))
    }
    const logo = typeof cfg?.logoUrl === 'string' && /^https:\/\//.test(cfg.logoUrl) ? cfg.logoUrl : null
    return {
      name: (cfg?.siteName && cfg.siteName.trim()) || String(p.name),
      slug: String(p.slug),
      customDomain: typeof p.custom_domain === 'string' ? p.custom_domain : null,
      defaultLocale: typeof p.default_locale === 'string' ? p.default_locale : null,
      timeZone: cfg?.timeZone ?? null,
      replyTo: safeReplyTo(cfg?.email) ?? null,
      logoUrl: logo,
    }
  }
  return (projectId: string) => {
    let hit = cache.get(projectId)
    if (!hit) { hit = load(projectId); cache.set(projectId, hit) }
    return hit
  }
}

export async function runReservationsSweep(now: () => Date = () => new Date()): Promise<SweepReport> {
  return runAsTrustedSystemOperation(REASON, async (sb): Promise<SweepReport> => {
    const db = sb as unknown as ReservationDb
    const store = createSupabaseReservationStore(db)
    const environment = getAppEnvironment()
    const testRecipient = process.env.RESERVATIONS_TEST_RECIPIENT?.trim() || undefined
    const serviceDeps: ServiceDeps = {
      store, now, environment, testRecipient,
      randomBytes: (n) => new Uint8Array(randomBytes(n)),
    }

    // 1. Lapsed holds → bookings `expired` + "hold lapsed" intents.
    const holds = await runSweep(serviceDeps)
    if (!holds.ok && holds.code === 'unavailable') return { skipped: 'reservations unavailable' }

    // 2. Deliver whatever is due.
    const outbox = await processOutbox({
      repo: createSupabaseOutboxRepo(db), environment, testRecipient, now,
      send: sendEmail, loadSite: siteLoader(db), loadContent: createContentLoader(db, store), budgetMs: TIME_BUDGET_MS,
    })
    if (outbox.unavailable) return { skipped: 'reservations unavailable' }
    return { holds: holds.ok ? holds.value : { error: holds.code }, outbox }
  })
}
