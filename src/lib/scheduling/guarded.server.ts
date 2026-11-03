// Server-only: never import from a client component.
// ── Scheduling — writes that name people (ADR-043 D9) ─────────────────────────
//
// `event_series.instructor_public_ids` and `event_occurrences.instructor_override`
// hold `person.publicId`s. The store only checks "is a UUID" and has no notion of
// a project slug, so every code path that WRITES instructors goes through this
// module: each id must be a person OF THE CALLER'S PROJECT (assertPeopleBelongToProject)
// BEFORE anything is sent to Supabase. `projectSlug` MUST come from the authorisation
// grant, never from input. The refusal is one opaque ScheduleError('invalid') — no hint
// about whether an id exists on another website.
//
// Instructor semantics (store.ts, unchanged): series ids = the defaults; an occurrence
// override of `null` = "same as the course", `[]` = "nobody" — callers pass the override
// through `guardInstructorOverride`, which treats both as "nothing to check".

import { assertPeopleBelongToProject } from '@/lib/api/persons-guard'
import { PersonError } from '@/lib/api/persons-lifecycle'
import { createSupabaseScheduleStore, type SaveOneOffInput, type ScheduleStore } from './store'
import { ScheduleError } from './types'

type GuardDeps = { assertPeople?: typeof assertPeopleBelongToProject }

/** Every id must be a person of `projectSlug` (the grant's), else ScheduleError('invalid'). Empty passes without I/O. */
export async function guardInstructors(projectSlug: string, publicIds: readonly string[] | null | undefined, deps: GuardDeps = {}): Promise<void> {
  if (!publicIds || publicIds.length === 0) return
  try {
    await (deps.assertPeople ?? assertPeopleBelongToProject)(projectSlug, publicIds)
  } catch (error) {
    if (error instanceof PersonError) {
      if (error.code === 'failed') throw new ScheduleError('unavailable', 'Could not check the people.')
      throw new ScheduleError('invalid', 'One of the people is not on this website.')
    }
    throw error
  }
}

/** An occurrence's `instructor_override`: null = same as the course, [] = nobody (nothing to check), otherwise the ids. */
export function guardInstructorOverride(projectSlug: string, override: readonly string[] | null | undefined, deps: GuardDeps = {}): Promise<void> {
  return guardInstructors(projectSlug, override, deps)
}

/** `store.saveOneOff` behind the people guard: the ONLY way the event API should save a schedule. */
export async function saveOneOffGuarded(
  projectSlug: string,
  input: SaveOneOffInput,
  deps: GuardDeps & { store?: Pick<ScheduleStore, 'saveOneOff'> } = {}
): Promise<Awaited<ReturnType<ScheduleStore['saveOneOff']>>> {
  await guardInstructors(projectSlug, input.instructorPublicIds, deps)
  return (deps.store ?? createSupabaseScheduleStore()).saveOneOff(input)
}
