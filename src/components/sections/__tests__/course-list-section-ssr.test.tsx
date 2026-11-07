/**
 * Course List section (ADR-045 D5) through SectionRenderer: module-gated by
 * `courses`, renders nothing without hydrated courses, cards link to the
 * course page only where the course has one in this language; and the
 * hydration (picked courses in order, else all by title).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SectionRenderer } from '@/components/sections/SectionRenderer'
import { CoursePage } from '@/components/courses/CoursePage'
import type { CourseListSection, PageSection } from '@/lib/sanity/types'
import { courseListIds, hydrateCourseListSection, orderCourses } from '@/lib/modules/courses/course-list-section'
import { COURSES_BY_PUBLIC_IDS_QUERY, COURSES_LISTING_QUERY } from '@/lib/modules/courses/queries'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const section = (over: Partial<CourseListSection> = {}): CourseListSection => ({
  _type: 'courseListSection',
  _key: 'cl1',
  eyebrow: 'Programme',
  title: 'Nos cours',
  intro: 'Pour tous les niveaux.',
  courseList: [
    { publicId: A, title: 'Iyengar Yoga', shortDescription: 'Un cours calme.', slug: 'yoga-iyengar', image: { asset: { _ref: 'image-abc123-800x600-jpg' } as never, hotspot: { x: 0.2, y: 0.8 } as never, alt: 'Une salle' } },
    { publicId: B, title: 'Méditation', shortDescription: null, slug: null, image: null },
  ],
  ...over,
})

const moduleConfig = [{ moduleId: 'courses', enabled: true, config: { courseSegment: { fr: 'cours', en: 'courses' } } }]

const render = (s: CourseListSection, o: { locale?: string; enabled?: string[] | null; config?: unknown } = {}) =>
  renderToStaticMarkup(
    <SectionRenderer
      section={s as unknown as PageSection}
      siteConfig={null}
      designSystem={null}
      backgroundPattern={undefined}
      sectionIndex={1}
      locale={o.locale ?? 'fr'}
      tenantSlug={'cyce' as never}
      enabledModuleIds={o.enabled === undefined ? ['courses'] : o.enabled}
      moduleConfig={(o.config ?? moduleConfig) as never}
    />,
  )

describe('courseListSection — through SectionRenderer', () => {
  it('renders the header and one card per course; a course with a page links to it', () => {
    const out = render(section())
    expect(out).toContain('Nos cours</h2>')
    expect(out).toContain('Pour tous les niveaux.')
    expect(out).toContain('Iyengar Yoga')
    expect(out).toContain('Un cours calme.')
    expect(out).toContain('href="/fr/cyce/cours/yoga-iyengar"')
    expect(out).toContain('Découvrir le cours')
    // Media Library image with its focal point.
    expect(out).toContain('abc123')
    expect(out).toContain('object-position:20% 80%')
    expect(out).toContain('alt="Une salle"')
    // Méditation has no page in French: a card without a link.
    expect(out).toContain('Méditation')
    expect(out.match(/<a /g)?.length).toBe(1)
  })

  it('no course segment in this language → no links at all', () => {
    const out = render(section(), { locale: 'de' })
    expect(out).toContain('Iyengar Yoga')
    expect(out).not.toContain('<a ')
  })

  it('is gated by the courses module and renders nothing without hydrated courses', () => {
    expect(render(section(), { enabled: ['people'] })).toBe('')
    expect(render(section({ courseList: undefined }))).toBe('')
    expect(render(section({ courseList: [] }))).toBe('')
  })
})

describe('course list hydration', () => {
  it('picked courses keep the editor’s order; unknown or hidden ones are dropped', () => {
    expect(courseListIds({ courseCount: 0, courseIds: [] })).toBeUndefined()
    expect(courseListIds({ courseCount: 2, courseIds: [B, A, B, null] })).toEqual([B, A])
    // Picked courses that are all drafts / archived: nothing, never "all".
    expect(courseListIds({ courseCount: 1, courseIds: [] })).toEqual([])
    expect(orderCourses([{ publicId: A, title: 'A' }, { publicId: B, title: 'B' }], [B, A]).map((c) => c.publicId)).toEqual([B, A])
    expect(orderCourses([{ publicId: A, title: ' ' }, { publicId: B, title: 'B' }], undefined).map((c) => c.publicId)).toEqual([B])
  })

  it('reads picked courses by publicId, else every visible course by title', async () => {
    const fetchForTenant = vi.fn(async (q: string) => (q === COURSES_LISTING_QUERY ? [{ publicId: A, title: 'A' }] : [{ publicId: B, title: 'B' }, { publicId: A, title: 'A' }])) as never
    const all = section({ courseList: undefined, courseCount: 0 })
    await hydrateCourseListSection(all, { locale: 'fr', defaultLocale: 'fr', fetchForTenant })
    expect(all.courseList?.map((c) => c.publicId)).toEqual([A])
    const picked = section({ courseList: undefined, courseCount: 2, courseIds: [A, B] })
    await hydrateCourseListSection(picked, { locale: 'fr', defaultLocale: 'fr', fetchForTenant })
    expect(picked.courseList?.map((c) => c.publicId)).toEqual([A, B])
    const calls = (fetchForTenant as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls[0]).toEqual([COURSES_LISTING_QUERY, { locale: 'fr', defaultLocale: 'fr' }])
    expect(calls[1]).toEqual([COURSES_BY_PUBLIC_IDS_QUERY, { locale: 'fr', defaultLocale: 'fr', publicIds: [A, B] }])
    const none = section({ courseList: undefined, courseCount: 1, courseIds: [] })
    await hydrateCourseListSection(none, { locale: 'fr', defaultLocale: 'fr', fetchForTenant })
    expect(none.courseList).toEqual([])
    expect(calls).toHaveLength(2)
  })
})

describe('CoursePage (course page body)', () => {
  const page = (o: Partial<Parameters<typeof CoursePage>[0]> = {}) =>
    renderToStaticMarkup(
      <CoursePage
        locale="en"
        title="Iyengar Yoga"
        description="A calm class."
        image={{ src: 'https://cdn/x.jpg', alt: 'The room', position: '20% 80%' }}
        timeZone="Europe/Brussels"
        timetableHref="/en/cyce/timetable"
        classes={[
          {
            id: 's1', rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', anchor: '2026-09-07', weekdays: [1], interval: 1, start: '12:30', end: '13:30', startsOn: null, endsOn: '2027-06-28', mode: 'mixed',
            place: { key: 'brey', name: 'BREY', short: null, lines: ['Avenue d’Auderghem 45'], mapsUrl: 'https://maps.google.com/?q=x' },
            teachers: [{ id: 't1', name: 'Anna Rossi', href: '/en/cyce/team/anna-rossi', photo: null }, { id: 't2', name: 'Sabrina', href: null, photo: null }],
            languages: ['fr', 'en'], nextDate: '2026-12-14',
          },
        ]}
        {...o}
      />,
    ).replace(/[  ]/g, ' ')

  it('shows title, image, description, the timetable link and each weekly class', () => {
    const out = page()
    expect(out).toContain('<h1')
    expect(out).toContain('Iyengar Yoga</h1>')
    expect(out).toContain('A calm class.')
    expect(out).toContain('object-position:20% 80%')
    expect(out).toContain('href="/en/cyce/timetable"')
    expect(out).toContain('See the full timetable')
    expect(out).toContain('When</h2>')
    expect(out).toContain('Every Monday')
    expect(out).toContain('12:30–13:30')
    expect(out).toContain('Next class: December 14')
    expect(out).toContain('Until June 28, 2027')
    expect(out).toContain('href="/en/cyce/team/anna-rossi"')
    expect(out).toContain('Sabrina')
    expect(out).toContain('BREY')
    expect(out).toContain('In person and online')
    expect(out).toContain('French, English')
    expect(out).not.toMatch(/zoom|passcode/i)
  })

  it('in another language, and without classes, image or timetable', () => {
    const out = page({ locale: 'fr', image: null, timetableHref: null, classes: [] })
    expect(out).toContain('Quand</h2>')
    expect(out).toContain('Aucun cours n’est prévu pour le moment.')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('Voir tout l’horaire')
  })
})
