// Shared by the Bookings server actions (a 'use server' file may export only actions).
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { errorKeyOf } from '@/lib/reservations/bookings-form'
import type { BookingsDeps, Failure } from '@/lib/reservations/server/bookings-service'
import { getBookingsDeps } from '@/lib/reservations/server/bookings-deps.server'

export type BookingActionFail = { ok: false; error: ReturnType<typeof errorKeyOf>; occurrenceIds?: string[] }
export type BookingActionResult<T extends object = object> = ({ ok: true } & T) | BookingActionFail

type Access = { ctx: TenantAuthorizationContext; projectId: string }

/** Resolves the caller, runs `work`, maps every failure to a code. The deps factory is injectable for tests. */
export async function runBookingAction<T extends object>(
  projectSlug: unknown,
  work: (a: Access, deps: BookingsDeps) => Promise<({ ok: true } & T) | Failure>,
  makeDeps: () => BookingsDeps = getBookingsDeps,
): Promise<BookingActionResult<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    const r = await work({ ctx: access.ctx, projectId: access.grant.projectId }, makeDeps())
    if (!r.ok) return { ok: false, error: errorKeyOf(r.code), ...(r.occurrenceIds ? { occurrenceIds: r.occurrenceIds } : {}) }
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

