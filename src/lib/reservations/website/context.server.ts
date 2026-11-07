import 'server-only'
// ── Reservations website — the request context of the two private link pages ──
//
// One place decides, for a request to /<locale>/booking/<token> or
// /<locale>/my-pass/<token> (and their server actions):
//   - which project this SITE serves (from the host + path, never from the link),
//   - whether the Reservations module is installed for it (not → "link not valid":
//     a site without the module looks exactly like an unknown link),
//   - the visitor's salted address hash for the rate limit (no salt → refuse),
//   - a service-role store and database handle, inside the audited
//     trusted-operation wrapper, plus the clock / random source / environment.
// Nothing here reads or logs the token.
import { randomBytes } from 'crypto'
import { headers } from 'next/headers'
import { extractIp } from '@/lib/forms/spam'
import { hashIp } from '@/lib/access/rate-limit'
import { accessIpSalt } from '@/lib/access/server'
import { isSupportedLocale, resolveAccessRouteProject } from '@/lib/access/request'
import { projectEnabledModuleIds } from '@/lib/access/visitor-routes'
import { getAppEnvironment } from '@/lib/notifications/environment'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { createSupabaseReservationStore, type ReservationDb } from '../server/store'
import type { ServiceDeps } from '../service/types'
import type { ActionCtx } from './run-actions'
import { createSiteLookup } from './site-lookup.server'

export const RESERVATIONS_MODULE_ID = 'reservations'
const REASON = 'ADR-044 reservations website: the private booking / My pass link pages and their actions (server-only booking_* tables, migration 066)'

export type WebsiteOutcome<T> = { kind: 'ok'; value: T } | { kind: 'invalid' } | { kind: 'unavailable' }

export async function withWebsiteContext<T>(
  input: { tenant: string; locale: string },
  fn: (ctx: ActionCtx) => Promise<T>,
): Promise<WebsiteOutcome<T>> {
  if (!isSupportedLocale(input.locale)) return { kind: 'invalid' }
  const h = await headers()
  const project = resolveAccessRouteProject(h.get('host'), input.tenant)
  if (!project) return { kind: 'invalid' }

  const enabled = await projectEnabledModuleIds(project, input.locale)
  if (enabled === null) return { kind: 'unavailable' }
  if (!enabled.includes(RESERVATIONS_MODULE_ID)) return { kind: 'invalid' }

  const salt = accessIpSalt()
  const ipHash = salt ? hashIp(extractIp(h), salt) : null
  try {
    const value = await runAsTrustedSystemOperation(REASON, async (sb) => {
      const db = sb as unknown as ReservationDb
      const store = createSupabaseReservationStore(db)
      const service: ServiceDeps = {
        store,
        now: () => new Date(),
        randomBytes: (n) => new Uint8Array(randomBytes(n)),
        environment: getAppEnvironment(),
        testRecipient: process.env.RESERVATIONS_TEST_RECIPIENT?.trim() || undefined,
      }
      return fn({
        projectId: project.projectId,
        locale: input.locale,
        db,
        service,
        site: createSiteLookup({ projectSegment: project.segment, locale: input.locale }),
        ipHash,
      })
    })
    return { kind: 'ok', value }
  } catch {
    // Never echo the cause: it could carry a query with the token's hash.
    return { kind: 'unavailable' }
  }
}
