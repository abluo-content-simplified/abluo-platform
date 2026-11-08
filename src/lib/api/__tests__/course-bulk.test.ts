/**
 * Courses list — bulk actions and "change last date of classes" (ADR-045).
 * Permission and input checks happen before any read or write; each course gets
 * its own result; delete only reaches never-published drafts and archived
 * courses and ends the classes with them; the last date snaps to the last class
 * day on or before the chosen day.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { bulkUpdateCourses, setClassesLastDate, type CourseBulkDeps } from '../course-bulk'
import { CourseError } from '../course-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { CourseListItem } from '../course-drafts'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import type { ClassSeries } from '@/lib/scheduling/types'
import type { CourseScheduleStore } from '@/lib/scheduling/course-store'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const PID = '11111111-1111-4111-8111-111111111111'
const pub = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const ALL = ['courses.course.read', 'courses.course.write', 'courses.course.delete', 'courses.schedule.write']
const grant = (permissions = ALL): ProjectGrant => ({ projectId: PID, projectSlug: asSupabaseProjectSlug('cyce'), membershipId: 'm1', role: 'owner', permissions, enabledModuleIds: ['courses'] })
const ctx = (permissions?: string[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [grant(permissions)] })

const course = (id: string, n: number, state: CourseListItem['state'], over: Partial<CourseListItem> = {}): CourseListItem =>
  ({
    id,
    publicId: pub(n),
    title: id,
    shortDescription: '',
    color: 'accent',
    state,
    hasDraft: state === 'draft' || state === 'changes',
    isPublished: state === 'published' || state === 'changes' || state === 'scheduled',
    archivedAt: state === 'archived' ? '2026-10-01T00:00:00Z' : null,
    publishedAt: null,
    schedule: null,
    updatedAt: '2026-10-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    searchText: id,
    missingLanguages: [],
    ...over,
  }) as CourseListItem

const COURSES = [
  course('draft1', 1, 'draft'),
  course('draft2', 2, 'draft', { missingLanguages: ['de'] }),
  course('live', 3, 'published'),
  course('old', 4, 'archived'),
]

function series(over: Partial<ClassSeries> = {}): ClassSeries {
  return {
    id: '99999999-9999-4999-8999-999999999991',
    ownerType: 'course',
    ownerPublicId: pub(3),
    editionId: null,
    timeZone: 'Europe/Rome',
    startLocal: '2026-09-07T18:00',
    endLocal: '2026-09-07T19:00',
    rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE',
    weekday: 1,
    weekdays: [1, 3],
    interval: 1,
    startsOn: '2026-09-07',
    endsOn: null,
    place: null,
    attendanceMode: 'inPerson',
    instructorPublicIds: [],
    languages: ['it'],
    meetingRoomId: null,
    status: 'active',
    version: 4,
    ...over,
  }
}

function fake(opts: { courses?: CourseListItem[]; series?: Record<string, ClassSeries[]> } = {}) {
  const list = vi.fn(async () => ({ courses: opts.courses ?? COURSES, site: { defaultLocale: 'fr', languages: ['fr'], timeZone: 'Europe/Rome' } }))
  const publish = vi.fn(async (...args: unknown[]) => (void args, { rev: 'r', publishedAt: null as string | null }))
  const lifecycle = vi.fn(async (...args: [unknown, unknown, { id: string; op: string }, { hasSchedule?: () => Promise<boolean> }?]) => (void args, { rev: null as string | null }))
  const draftRev = vi.fn(async (id: string) => `rev-${id}`)
  const saveClass = vi.fn(async () => ({ seriesId: 's', version: 5, sync: { truncated: false, modifiedOutsideRule: [] } as never }))
  const store = {
    listSeries: vi.fn(async (_p: string, o?: { ownerPublicIds?: string[] }) => (opts.series?.[o?.ownerPublicIds?.[0] ?? ''] ?? []) as ClassSeries[]),
    endSeries: vi.fn(async () => 3),
  } as unknown as CourseScheduleStore
  const deps = { store, impl: { list, publish, lifecycle, draftRev, saveClass } } as unknown as CourseBulkDeps
  return { list, publish, lifecycle, draftRev, saveClass, store, deps }
}

describe('bulkUpdateCourses — gates (before any read)', () => {
  it('needs write for publish / archive / restore and delete for delete', async () => {
    for (const [perms, op, ok] of [
      [['courses.course.read'], 'archive', false],
      [['courses.course.read'], 'publish', false],
      [['courses.course.read', 'courses.course.write'], 'delete', false],
      [['courses.course.read', 'courses.course.write'], 'archive', true],
      [['courses.course.read', 'courses.course.delete'], 'delete', true],
    ] as const) {
      const f = fake()
      const call = bulkUpdateCourses(ctx([...perms]), PID, { ids: ['draft1'], op }, f.deps)
      if (ok) await expect(call).resolves.toBeDefined()
      else {
        await expect(call).rejects.toBeInstanceOf(TenantAuthorizationError)
        expect(f.list).not.toHaveBeenCalled()
        expect(f.lifecycle).not.toHaveBeenCalled()
      }
    }
  })
  it('rejects bad input and unknown ids before writing anything', async () => {
    const f = fake()
    for (const input of [{ ids: [], op: 'archive' }, { ids: ['a', 'a'], op: 'archive' }, { ids: ['../x'], op: 'archive' }, { ids: ['live'], op: 'purge' }, { ids: Array.from({ length: 51 }, (_, i) => `c${i}`), op: 'archive' }]) {
      await expect(bulkUpdateCourses(ctx(), PID, input as never, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    }
    await expect(bulkUpdateCourses(ctx(), PID, { ids: ['live', 'elsewhere'], op: 'archive' }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    expect(f.lifecycle).not.toHaveBeenCalled()
  })
})

describe('bulkUpdateCourses — per-course results', () => {
  it('archive: published courses change, the rest are skipped with a reason, a refusal fails only that course', async () => {
    const f = fake({ courses: [...COURSES, course('live2', 5, 'published')] })
    f.lifecycle.mockImplementation(async (_c, _p, i) => {
      if (i.id === 'live2') throw new CourseError('conflict', 'changed')
      return { rev: null }
    })
    const r = await bulkUpdateCourses(ctx(), PID, { ids: ['live', 'draft1', 'old', 'live2'], op: 'archive' }, f.deps)
    expect(r.changed).toEqual(['live'])
    expect(r.skipped).toEqual([
      { id: 'draft1', reason: 'not_published' },
      { id: 'old', reason: 'archived' },
    ])
    expect(r.failed).toEqual([{ id: 'live2', code: 'conflict' }])
  })
  it('publish: only drafts with every text; uses the draft revision', async () => {
    const f = fake()
    const r = await bulkUpdateCourses(ctx(), PID, { ids: ['draft1', 'draft2', 'live'], op: 'publish' }, f.deps)
    expect(r.changed).toEqual(['draft1'])
    expect(r.skipped).toEqual([
      { id: 'draft2', reason: 'missing_text' },
      { id: 'live', reason: 'published' },
    ])
    expect(f.publish).toHaveBeenCalledTimes(1)
    expect(f.publish.mock.calls[0][2]).toEqual({ id: 'draft1', rev: 'rev-draft1', mode: 'keep' })
  })
  it('restore: only archived courses', async () => {
    const f = fake()
    const r = await bulkUpdateCourses(ctx(), PID, { ids: ['old', 'live'], op: 'restore' }, f.deps)
    expect(r.changed).toEqual(['old'])
    expect(r.skipped).toEqual([{ id: 'live', reason: 'not_archived' }])
  })
})

describe('bulkUpdateCourses — delete', () => {
  it('only never-published drafts and archived courses; published ones are skipped and never reach the service', async () => {
    const f = fake()
    const r = await bulkUpdateCourses(ctx(), PID, { ids: ['draft1', 'live', 'old'], op: 'delete' }, f.deps)
    expect(r.changed).toEqual(['draft1', 'old'])
    expect(r.skipped).toEqual([{ id: 'live', reason: 'has_been_published' }])
    expect(f.lifecycle.mock.calls.map((c) => [c[2].id, c[2].op])).toEqual([
      ['draft1', 'deleteDraft'],
      ['old', 'deletePermanently'],
    ])
  })
  it('the classes go too: they are ended after the course is deleted', async () => {
    const s = series({ ownerPublicId: pub(1) })
    const f = fake({ series: { [pub(1)]: [s, series({ id: '99999999-9999-4999-8999-999999999992', ownerPublicId: pub(1) })] } })
    const order: string[] = []
    f.lifecycle.mockImplementation(async () => (order.push('delete'), { rev: null }))
    ;(f.store.endSeries as ReturnType<typeof vi.fn>).mockImplementation(async () => (order.push('end'), 3))
    const r = await bulkUpdateCourses(ctx(), PID, { ids: ['draft1'], op: 'delete' }, f.deps)
    expect(r).toMatchObject({ changed: ['draft1'], classesEnded: 2, classesLeft: 0 })
    expect(order).toEqual(['delete', 'end', 'end'])
    expect(f.store.endSeries).toHaveBeenCalledWith(PID, s.id, 4)
    // the "has classes" refusal is replaced by ending them
    const sdeps = (f.lifecycle.mock.calls[0] as unknown[])[3] as { hasSchedule?: () => Promise<boolean> }
    await expect(sdeps.hasSchedule?.()).resolves.toBe(false)
  })
  it('a course that is still used elsewhere is not deleted and keeps its classes', async () => {
    const f = fake({ series: { [pub(1)]: [series({ ownerPublicId: pub(1) })] } })
    f.lifecycle.mockRejectedValue(new CourseError('in_use', 'used', { usedIn: [{ kind: 'page', id: 'p1', title: 'Timetable' }] }))
    const r = await bulkUpdateCourses(ctx(), PID, { ids: ['draft1'], op: 'delete' }, f.deps)
    expect(r.changed).toEqual([])
    expect(r.failed).toEqual([{ id: 'draft1', code: 'in_use', usedIn: [{ kind: 'page', id: 'p1', title: 'Timetable' }] }])
    expect(f.store.endSeries).not.toHaveBeenCalled()
  })
  it('without schedule permission a course with classes is left as it was', async () => {
    const f = fake({ series: { [pub(1)]: [series({ ownerPublicId: pub(1) })] } })
    const r = await bulkUpdateCourses(ctx(['courses.course.read', 'courses.course.delete']), PID, { ids: ['draft1'], op: 'delete' }, f.deps)
    expect(r.failed).toEqual([{ id: 'draft1', code: 'forbidden' }])
    expect(f.lifecycle).not.toHaveBeenCalled()
  })
})

describe('setClassesLastDate', () => {
  const live = () => fake({ series: { [pub(3)]: [series()] } })
  it('needs schedule write and a real date, before reading anything', async () => {
    const f = live()
    await expect(setClassesLastDate(ctx(['courses.course.read', 'courses.course.write']), PID, { ids: ['live'], endsOn: '2026-12-18' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    for (const endsOn of ['', '2026-02-30', 'soon']) await expect(setClassesLastDate(ctx(), PID, { ids: ['live'], endsOn }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.list).not.toHaveBeenCalled()
  })
  it('snaps to the last class day on or before the chosen day (Friday → Wednesday)', async () => {
    const f = live()
    const r = await setClassesLastDate(ctx(), PID, { ids: ['live'], endsOn: '2026-12-18' }, f.deps)
    expect(r.changed).toEqual([{ courseId: 'live', classId: series().id, from: null, to: '2026-12-16' }])
    const saved = f.saveClass.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(saved[0]).toBe('cyce')
    expect(saved[1]).toMatchObject({ seriesId: series().id, endsOn: '2026-12-16', startsOn: '2026-09-07', startTime: '18:00', endTime: '19:00', expectedVersion: 4, editionId: null })
  })
  it('a class day itself is kept; a class that already ends then is left; one that starts later or does not repeat is skipped', async () => {
    const f = fake({
      series: {
        [pub(3)]: [
          series({ id: '99999999-9999-4999-8999-999999999991' }),
          series({ id: '99999999-9999-4999-8999-999999999992', endsOn: '2026-12-16' }),
          series({ id: '99999999-9999-4999-8999-999999999993', startsOn: '2027-01-11', startLocal: '2027-01-11T18:00' }),
          series({ id: '99999999-9999-4999-8999-999999999994', rule: 'FREQ=DAILY;COUNT=1', endsOn: '2026-09-07' }),
        ],
      },
    })
    const r = await setClassesLastDate(ctx(), PID, { ids: ['live'], endsOn: '2026-12-16' }, f.deps)
    expect(r.changed.map((x) => [x.classId.slice(-1), x.to])).toEqual([['1', '2026-12-16']])
    expect(r.skipped.map((x) => [x.classId.slice(-1), x.reason])).toEqual([
      ['2', 'unchanged'],
      ['3', 'before_first'],
      ['4', 'once'],
    ])
    expect(f.saveClass).toHaveBeenCalledTimes(1)
  })
  it('archived courses and courses without classes are skipped; a failing class does not stop the others', async () => {
    const f = fake({
      courses: [...COURSES, course('live2', 5, 'published')],
      series: { [pub(3)]: [series()], [pub(5)]: [series({ id: '99999999-9999-4999-8999-999999999995', ownerPublicId: pub(5) })] },
    })
    f.saveClass.mockImplementationOnce(async () => {
      throw new CourseError('conflict', 'changed')
    })
    const r = await setClassesLastDate(ctx(), PID, { ids: ['live', 'old', 'draft1', 'live2'], endsOn: '2026-12-18' }, f.deps)
    expect(r.failed).toEqual([{ courseId: 'live', classId: series().id, code: 'conflict' }])
    expect(r.changed.map((x) => x.courseId)).toEqual(['live2'])
    expect(r.skipped).toEqual([
      { courseId: 'old', classId: '', reason: 'archived' },
      { courseId: 'draft1', classId: '', reason: 'no_classes' },
    ])
  })
})
