import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { timetableForSection, withPreviewCourse, type TimetableDeps } from '../timetable.server'
import { COURSES, COURSE_A, CLOSURES, OCCURRENCES, SERIES, LOCATIONS, PEOPLE, series, ROOMS } from '@/lib/modules/courses/__tests__/timetable-fixtures'

vi.mock('@/lib/sanity/client', () => ({ tenantClient: () => ({ fetchForTenant: () => Promise.reject(new Error('no network in tests')) }) }))
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: () => Promise.reject(new Error('no db in tests')) }))

const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const opts = { from: '2026-12-01', to: '2026-12-31', locale: 'fr', defaultLocale: 'en', includeOnlineDetails: false }

function deps() {
  const owners: string[][] = []
  const newSeries = series({ id: '33333333-3333-4333-8333-333333333399', ownerPublicId: NEW })
  const d: TimetableDeps = {
    resolveProject: async () => '11111111-1111-4111-8111-111111111111',
    store: {
      occurrencesInWindow: vi.fn(async (_p: string, q: { ownerPublicIds?: string[] }) => {
        owners.push(q.ownerPublicIds ?? [])
        return OCCURRENCES
      }),
      listSeries: async (_p: string, q: { ownerPublicIds?: string[] }) => [...SERIES, newSeries].filter((s) => q.ownerPublicIds?.includes(s.ownerPublicId)),
      listClosures: async () => CLOSURES,
      meetingRoomsById: vi.fn(async () => new Map(ROOMS.map((r) => [r.id, r]))),
    } as never,
    fetchForTenant: (async (query: string) => {
      if (query.includes('_type == "course"')) return COURSES
      if (query.includes('_type == "person"')) return PEOPLE
      if (query.includes('"siteConfig"')) return { timeZone: 'Europe/Brussels', locations: LOCATIONS }
      return []
    }) as TimetableDeps['fetchForTenant'],
  }
  return { d, owners }
}

describe('previewCourse seam', () => {
  it('without it, an unpublished course is not in the timetable', async () => {
    const { d, owners } = deps()
    const data = await timetableForSection('cyce', opts, d)
    expect(owners[0]).not.toContain(NEW)
    expect(data.courses[NEW]).toBeUndefined()
  })

  it('adds the preview course (draft title/colour) and reads its classes; the others stay', async () => {
    const { d, owners } = deps()
    const data = await timetableForSection('cyce', { ...opts, previewCourse: { publicId: NEW, title: 'Draft yoga', color: 'accent' } }, d)
    expect(owners[0]).toContain(NEW)
    expect(owners[0]).toContain(COURSE_A)
    expect(data.courses[NEW]).toMatchObject({ title: 'Draft yoga', color: 'accent' })
    expect(data.series.some((s) => s.courseId === NEW || (s as never as { ownerPublicId?: string }).ownerPublicId === NEW) || Object.keys(data.courses).includes(NEW)).toBe(true)
    expect(data.courses[COURSE_A]).toBeTruthy()
  })

  it('replaces the published version of the same course with its draft fields', () => {
    const merged = withPreviewCourse(COURSES, { publicId: COURSE_A, title: 'New title', color: 'muted' })
    expect(merged.filter((c) => c.publicId === COURSE_A)).toEqual([{ publicId: COURSE_A, title: 'New title', color: 'muted' }])
    expect(merged).toHaveLength(COURSES.length)
  })

  it('ignores a preview without a publicId', () => {
    expect(withPreviewCourse(COURSES, { publicId: '' })).toEqual(COURSES)
  })

  it('never exposes meeting rooms in the preview (online details off)', async () => {
    const { d } = deps()
    await timetableForSection('cyce', { ...opts, previewCourse: { publicId: NEW, title: 'x' } }, d)
    expect(d.store!.meetingRoomsById).not.toHaveBeenCalled()
  })

  it('only the verified-token preview route sets previewCourse (nothing a browser sends can)', () => {
    const root = path.join(process.cwd(), 'src')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p) }
        else if (/\.(ts|tsx)$/.test(name) && !p.includes('__tests__') && readFileSync(p, 'utf8').includes('previewCourse')) hits.push(path.relative(root, p))
      }
    }
    walk(root)
    expect(hits.sort()).toEqual([
      'app/[locale]/(website)/[tenant]/preview/course/[id]/page.tsx',
      'lib/modules/courses/preview-query.ts',
      'lib/modules/courses/timetable-section.server.ts',
      'lib/scheduling/timetable.server.ts',
    ])
  })
})
