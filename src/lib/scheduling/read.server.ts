// Server-only. ── Scheduling — the readers' entry point (ADR-038, step C3) ────
//
//   const [event] = await withSchedules(projectSlug, [event])
//
// Resolves the Supabase project of a Sanity projectSlug, reads the schedules of
// the given events and lays them over (overlay.ts). FAILS SOFT: any problem —
// Supabase down, unknown or ambiguous project, malformed rows — returns the
// events unchanged (their Sanity dates), so a scheduling outage never breaks a
// public page. Each request resolves a project once (React cache).

import { cache } from 'react'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { applySchedules, type SchedulableEvent } from './overlay'
import { createSupabaseScheduleStore, type ScheduleStore } from './store'

const REASON = 'ADR-038 event scheduling: resolve a Sanity projectSlug to its Supabase project for public schedule reads'

/** The Supabase project id of a Sanity projectSlug; null when unknown OR ambiguous (slugs are unique per tenant only). */
export const projectIdForSlug = cache(async (projectSlug: string): Promise<string | null> => {
  try {
    return await runAsTrustedSystemOperation(REASON, async (db) => {
      const { data, error } = await db.from('projects').select('id').eq('slug', projectSlug).limit(2)
      if (error || !data || data.length !== 1) return null
      return (data[0] as { id: string }).id
    })
  } catch {
    return null
  }
})

export type ScheduleReadDeps = {
  store?: Pick<ScheduleStore, 'schedulesForEvents'>
  resolveProject?: (projectSlug: string) => Promise<string | null>
}

export async function withSchedules<T extends SchedulableEvent>(projectSlug: string, events: T[], deps: ScheduleReadDeps = {}): Promise<T[]> {
  const list = (events ?? []).filter(Boolean)
  const ids = list.map((e) => e.publicId).filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!ids.length) return events
  try {
    const projectId = await (deps.resolveProject ?? projectIdForSlug)(projectSlug)
    if (!projectId) return events
    const schedules = await (deps.store ?? createSupabaseScheduleStore()).schedulesForEvents(projectId, ids)
    if (!schedules.size) return events
    return applySchedules(events, schedules)
  } catch (error) {
    console.warn(`[scheduling] schedules unavailable for "${projectSlug}" — showing Sanity dates:`, (error as Error)?.message)
    return events
  }
}

/** One event (or null) — the same overlay. */
export async function withSchedule<T extends SchedulableEvent>(projectSlug: string, event: T | null | undefined, deps: ScheduleReadDeps = {}): Promise<T | null> {
  if (!event) return null
  const [out] = await withSchedules(projectSlug, [event], deps)
  return out ?? event
}
