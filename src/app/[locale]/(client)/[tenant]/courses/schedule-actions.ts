'use server'

/**
 * Client dashboard — course schedule server actions (ADR-045): the Classes panel
 * of the course editor and the Timetable page.
 *
 * Thin wrappers over `src/lib/api/course-schedule.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Failures collapse to opaque codes
 * (`CourseErrorCode`). Meeting details reach only `courses.meeting.manage`.
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { CourseError, type CourseErrorCode } from '@/lib/api/course-lifecycle'
import {
  endClass,
  listClasses,
  listClosures,
  listMeetingRooms,
  listOccurrences,
  removeClosure,
  removeEdition,
  removeMeetingRoom,
  saveClass,
  saveClosure,
  saveEdition,
  saveMeetingRoom,
  searchTeachers,
  timetable,
  updateOccurrence,
  type ClassesScreen,
  type ClosureView,
  type OccurrenceView,
  type RoomView,
  type SaveClassInput,
  type SaveClassResult,
  type ScheduleSite,
  type TimetableScreen,
  type UpdateOccurrenceRequest,
} from '@/lib/api/course-schedule'

export type ScheduleActionError = 'unauthenticated' | CourseErrorCode
type Fail = { ok: false; error: ScheduleActionError }
type Result<T> = ({ ok: true } & T) | Fail

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof CourseError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

// ── Reading ───────────────────────────────────────────────────────────────────

export async function listClassesAction(input: { projectSlug: string; courseId: string }): Promise<Result<{ screen: ClassesScreen }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ screen: await listClasses(ctx, pid, { courseId: input.courseId }) }))
}

export async function timetableAction(input: { projectSlug: string; editionId?: string | null; window?: { from: string; to: string } }): Promise<Result<{ screen: TimetableScreen }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ screen: await timetable(ctx, pid, { editionId: input.editionId, window: input.window }) }))
}

export async function listOccurrencesAction(input: { projectSlug: string; seriesId: string; from?: string; count?: number }): Promise<Result<{ occurrences: OccurrenceView[]; hasMore: boolean; site: ScheduleSite }>> {
  return run(input?.projectSlug, (ctx, pid) => listOccurrences(ctx, pid, { seriesId: input.seriesId, from: input.from, count: input.count }))
}

export async function searchTeachersAction(input: { projectSlug: string; query?: string; limit?: number }): Promise<Result<{ items: Array<{ publicId: string; name: string; photoUrl: string | null; jobTitle: string }> }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ items: await searchTeachers(ctx, pid, { query: input.query, limit: input.limit }) }))
}

// ── Classes ───────────────────────────────────────────────────────────────────

export async function saveClassAction(input: { projectSlug: string; class: SaveClassInput }): Promise<Result<SaveClassResult>> {
  return run(input?.projectSlug, (ctx, pid) => saveClass(ctx, pid, input.class))
}

export async function endClassAction(input: { projectSlug: string; seriesId: string; expectedVersion: number }): Promise<Result<{ removed: number }>> {
  return run(input?.projectSlug, (ctx, pid) => endClass(ctx, pid, { seriesId: input.seriesId, expectedVersion: input.expectedVersion }))
}

export async function updateOccurrenceAction(input: { projectSlug: string; update: UpdateOccurrenceRequest }): Promise<Result<{ version: number }>> {
  return run(input?.projectSlug, (ctx, pid) => updateOccurrence(ctx, pid, input.update))
}

// ── Terms ─────────────────────────────────────────────────────────────────────

export async function saveEditionAction(input: {
  projectSlug: string
  id?: string | null
  label: Record<string, string>
  startsOn: string
  endsOn: string
  expectedVersion?: number | null
  timeZone?: string
}): Promise<Result<{ id: string; version: number }>> {
  return run(input?.projectSlug, (ctx, pid) =>
    saveEdition(ctx, pid, { id: input.id, label: input.label, startsOn: input.startsOn, endsOn: input.endsOn, expectedVersion: input.expectedVersion, timeZone: input.timeZone })
  )
}

export async function removeEditionAction(input: { projectSlug: string; id: string; expectedVersion: number }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await removeEdition(ctx, pid, { id: input.id, expectedVersion: input.expectedVersion })
    return {}
  })
}

// ── Holidays ──────────────────────────────────────────────────────────────────

export async function listClosuresAction(input: { projectSlug: string; editionId?: string | null }): Promise<Result<{ closures: ClosureView[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ closures: await listClosures(ctx, pid, { editionId: input.editionId }) }))
}

export async function saveClosureAction(input: {
  projectSlug: string
  id?: string | null
  editionId?: string | null
  startsOn: string
  endsOn: string
  label: Record<string, string>
}): Promise<Result<{ id: string; resynced: number }>> {
  return run(input?.projectSlug, (ctx, pid) => saveClosure(ctx, pid, { id: input.id, editionId: input.editionId, startsOn: input.startsOn, endsOn: input.endsOn, label: input.label }))
}

export async function removeClosureAction(input: { projectSlug: string; id: string }): Promise<Result<{ resynced: number }>> {
  return run(input?.projectSlug, (ctx, pid) => removeClosure(ctx, pid, { id: input.id }))
}

// ── Online rooms ──────────────────────────────────────────────────────────────

export async function listMeetingRoomsAction(input: { projectSlug: string }): Promise<Result<{ rooms: RoomView[]; canManage: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => listMeetingRooms(ctx, pid))
}

export async function saveMeetingRoomAction(input: {
  projectSlug: string
  id?: string | null
  label: string
  joinUrl?: string | null
  meetingId?: string | null
  passcode?: string | null
  expectedVersion?: number | null
}): Promise<Result<{ id: string; version: number }>> {
  return run(input?.projectSlug, (ctx, pid) =>
    saveMeetingRoom(ctx, pid, { id: input.id, label: input.label, joinUrl: input.joinUrl, meetingId: input.meetingId, passcode: input.passcode, expectedVersion: input.expectedVersion })
  )
}

export async function removeMeetingRoomAction(input: { projectSlug: string; id: string; expectedVersion: number }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await removeMeetingRoom(ctx, pid, { id: input.id, expectedVersion: input.expectedVersion })
    return {}
  })
}
