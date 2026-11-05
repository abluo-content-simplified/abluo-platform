// Server-only: never import from a client component.
// ── Scheduling — course schedule writes behind their guards (ADR-045, ADR-043 D9) ──
//
// The ONLY entry the dashboard's course actions use to change a class or one of
// its dates. course-store.ts checks shapes ("is a UUID", "is a valid key"); it has
// no notion of a project slug. Before anything reaches Supabase this module proves:
//   - the owning course is a published course OF THE CALLER'S PROJECT (Sanity read),
//   - the place is one of that project's `siteConfig.locations` keys, or a saved
//     venue (`eventVenue`) of that project,
//   - every named person belongs to that project (guardInstructors).
// `projectSlug` and `projectId` MUST come from the authorisation grant, never from
// input. Every refusal is ONE opaque ScheduleError('invalid') — no hint about
// whether an id exists on another website; a failed Sanity read is 'unavailable'.

import { assertPeopleBelongToProject } from '@/lib/api/persons-guard'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { createCourseScheduleStore, type CourseScheduleStore, type SaveClassInput, type SaveEditionInput, type SyncResult, type UpdateOccurrenceInput } from './course-store'
import { guardInstructors } from './guarded.server'
import { ScheduleError, type SchedulePlace } from './types'

type Fetcher = { fetch: (query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }
type GuardDeps = { client?: Fetcher; assertPeople?: typeof assertPeopleBelongToProject }
type WriteDeps = GuardDeps & { store?: CourseScheduleStore }

export const COURSE_GUARD_QUERY = /* groq */ `count(*[_type == "course" && projectSlug == $projectSlug && publicId == $id && !(_id in path("drafts.**"))])`
export const LOCATION_KEYS_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].locations[].key`
export const VENUE_GUARD_QUERY = /* groq */ `count(*[_type == "eventVenue" && projectSlug == $projectSlug && publicId == $id && !(_id in path("drafts.**"))])`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const refuse = (what: string) => new ScheduleError('invalid', `This ${what} is not on this website.`)

async function read(client: Fetcher, query: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    return await client.fetch(query, params, { perspective: 'raw' })
  } catch {
    throw new ScheduleError('unavailable', 'Could not check the website.')
  }
}

const clientOf = (deps: GuardDeps) => deps.client ?? (sanityWriteClient as unknown as Fetcher)

/** The course must be a published course of `projectSlug`, else ScheduleError('invalid'). */
export async function guardCourseOwner(projectSlug: string, coursePublicId: string, deps: GuardDeps = {}): Promise<void> {
  if (typeof projectSlug !== 'string' || !projectSlug || typeof coursePublicId !== 'string' || !UUID.test(coursePublicId)) throw refuse('course')
  const n = await read(clientOf(deps), COURSE_GUARD_QUERY, { projectSlug, id: coursePublicId.toLowerCase() })
  if (typeof n !== 'number' || n < 1) throw refuse('course')
}

/** A location key must be in the project's siteConfig.locations; a venue must be a saved venue of the project. null passes. */
export async function guardPlace(projectSlug: string, placeValue: SchedulePlace | null, deps: GuardDeps = {}): Promise<void> {
  if (placeValue === null) return
  if (typeof projectSlug !== 'string' || !projectSlug) throw refuse('place')
  if (placeValue.kind === 'location') {
    const keys = await read(clientOf(deps), LOCATION_KEYS_QUERY, { projectSlug })
    if (!Array.isArray(keys) || !keys.includes(placeValue.key)) throw refuse('place')
    return
  }
  if (placeValue.kind === 'venue' && typeof placeValue.venuePublicId === 'string' && UUID.test(placeValue.venuePublicId)) {
    const n = await read(clientOf(deps), VENUE_GUARD_QUERY, { projectSlug, id: placeValue.venuePublicId.toLowerCase() })
    if (typeof n !== 'number' || n < 1) throw refuse('place')
    return
  }
  throw refuse('place')
}

/**
 * Creates or updates a weekly class and regenerates its dates. The owner (when it
 * is a course), place and hosts are checked first. Returns the series ids and what
 * the regeneration changed (`sync.modifiedOutsideRule` = edited dates kept for review).
 */
export async function saveClassGuarded(
  projectSlug: string,
  input: SaveClassInput,
  deps: WriteDeps = {}
): Promise<{ seriesId: string; version: number; sync: SyncResult }> {
  if ((input.ownerType ?? 'course') === 'course') await guardCourseOwner(projectSlug, input.ownerPublicId, deps)
  await guardPlace(projectSlug, input.place, deps)
  await guardInstructors(projectSlug, input.instructorPublicIds, deps)
  const store = deps.store ?? createCourseScheduleStore()
  const saved = await store.saveSeries(input)
  const sync = await store.syncSeries(input.projectId, saved.seriesId)
  return { ...saved, sync }
}

/** Edits one date of a class (cancel / restore, substitute, time, note). Substitute hosts are checked first. */
export async function updateOccurrenceGuarded(projectSlug: string, input: UpdateOccurrenceInput, deps: WriteDeps = {}): Promise<number> {
  await guardInstructors(projectSlug, input.instructorPublicIds, deps)
  return (deps.store ?? createCourseScheduleStore()).updateOccurrence(input)
}

/** Ends a class (its future dates go, past ones stay). Scoped by the grant's project id. */
export function endClassGuarded(projectId: string, seriesId: string, expectedVersion: number, deps: { store?: CourseScheduleStore } = {}): Promise<number> {
  return (deps.store ?? createCourseScheduleStore()).endSeries(projectId, seriesId, expectedVersion)
}

/** Saves a term; when it belongs to a course, that course must be the project's. */
export async function saveEditionGuarded(projectSlug: string, input: SaveEditionInput, deps: WriteDeps = {}): Promise<{ id: string; version: number }> {
  if (input.ownerType === 'course' && input.ownerPublicId) await guardCourseOwner(projectSlug, input.ownerPublicId, deps)
  return (deps.store ?? createCourseScheduleStore()).saveEdition(input)
}
