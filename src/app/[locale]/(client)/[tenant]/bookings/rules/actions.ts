'use server'

/**
 * Bookings → Booking rules — server actions (ADR-044 D7, D13).
 *
 *   loadBookingRulesAction { projectSlug }                                  → { view }   reservations.booking.read
 *   saveBookingRulesAction { projectSlug, expectedVersion, values }         → { view }   reservations.settings.manage
 *
 * Failure: { ok: false, error: 'unauthenticated' | 'forbidden' | 'invalid' | 'conflict' | 'unavailable' | 'failed', errors? }
 *   conflict    = someone saved first (the screen reloads and keeps nothing silently)
 *   unavailable = bookings are not set up on this database yet (migration 066) — a calm state, not an error
 *   invalid     = `errors` names the fields (rules-form.ts)
 * The project comes from the caller's grant (resolveProjectAction), never from input.
 */
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { RulesErrors } from '@/lib/reservations/rules-form'
import { loadBookingRules, saveBookingRules, type RulesDeps, type RulesView } from '@/lib/reservations/server/settings-service'
import { readSiteFacts } from '@/lib/reservations/server/settings-site.server'
import { getSettingsStore } from '@/lib/reservations/server/settings-store.server'

export type BookingRulesFail = { ok: false; error: 'unauthenticated' | 'forbidden' | 'invalid' | 'conflict' | 'unavailable' | 'failed'; errors?: RulesErrors }
export type BookingRulesResult = { ok: true; view: RulesView } | BookingRulesFail

function deps(): RulesDeps {
  return { store: getSettingsStore(), readSite: readSiteFacts }
}

export async function loadBookingRulesAction(input: { projectSlug: string }): Promise<BookingRulesResult> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    const r = await loadBookingRules(access.ctx, access.grant.projectId, deps())
    return r.ok ? r : { ok: false, error: r.error }
  } catch (error) {
    return { ok: false, error: error instanceof TenantAuthorizationError ? 'forbidden' : 'failed' }
  }
}

export async function saveBookingRulesAction(input: { projectSlug: string; expectedVersion: number; values: unknown }): Promise<BookingRulesResult> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    const r = await saveBookingRules(access.ctx, access.grant.projectId, { expectedVersion: input.expectedVersion, values: input.values }, deps())
    if (!r.ok) return { ok: false, error: r.error, ...(r.errors && { errors: r.errors }) }
    try {
      revalidatePath('/[locale]/[tenant]/bookings', 'layout')
    } catch {
      /* not in a request (tests) */
    }
    return r
  } catch (error) {
    return { ok: false, error: error instanceof TenantAuthorizationError ? 'forbidden' : 'failed' }
  }
}
