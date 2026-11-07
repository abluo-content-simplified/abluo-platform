/** schema.org Course for a course page (ADR-045 D5): only authored facts, one CourseInstance per weekly class. */
import { describe, expect, it } from 'vitest'
import { buildCourseSchema, courseScheduleOf, type CourseSchemaClass } from '../structured'

const cls = (o: Partial<CourseSchemaClass> = {}): CourseSchemaClass => ({
  rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE',
  anchor: '2026-09-07',
  start: '12:30',
  end: '13:30',
  startsOn: null,
  endsOn: null,
  mode: 'inPerson',
  place: { name: 'BREY', lines: ['Avenue d’Auderghem 45', '1040 Etterbeek'] },
  teachers: [{ name: 'Anna Rossi', url: 'https://www.cyce.info/en/team/anna-rossi' }],
  languages: ['fr', 'en'],
  ...o,
})

const base = { origin: 'https://www.cyce.info', locale: 'en', pathSegments: ['courses', 'iyengar-yoga'], title: 'Iyengar Yoga', timeZone: 'Europe/Brussels' }

describe('buildCourseSchema', () => {
  it('describes the course, its provider and each class as a CourseInstance', () => {
    const s = buildCourseSchema({ ...base, description: 'A calm class.', imageUrl: 'https://cdn/x.jpg', classes: [cls(), cls({ mode: 'online', place: null, teachers: [{ name: 'Sabrina', url: null }], languages: ['en'] })] })!
    expect(s).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Course',
      '@id': 'https://www.cyce.info/en/courses/iyengar-yoga#course',
      url: 'https://www.cyce.info/en/courses/iyengar-yoga',
      name: 'Iyengar Yoga',
      description: 'A calm class.',
      image: 'https://cdn/x.jpg',
      inLanguage: 'en',
      provider: { '@id': 'https://www.cyce.info#organization' },
    })
    const [onsite, online] = s.hasCourseInstance as Record<string, unknown>[]
    expect(onsite).toEqual({
      '@type': 'CourseInstance',
      courseMode: 'onsite',
      location: { '@type': 'Place', name: 'BREY', address: 'Avenue d’Auderghem 45, 1040 Etterbeek' },
      instructor: { '@type': 'Person', name: 'Anna Rossi', url: 'https://www.cyce.info/en/team/anna-rossi' },
      inLanguage: ['fr', 'en'],
      courseSchedule: {
        '@type': 'Schedule',
        startTime: '12:30',
        endTime: '13:30',
        scheduleTimezone: 'Europe/Brussels',
        repeatFrequency: 'P1W',
        byDay: ['https://schema.org/Monday', 'https://schema.org/Wednesday'],
        startDate: '2026-09-07',
      },
    })
    expect(online).toMatchObject({ courseMode: 'online', location: { '@type': 'VirtualLocation', url: 'https://www.cyce.info/en/courses/iyengar-yoga' }, instructor: { '@type': 'Person', name: 'Sabrina' }, inLanguage: 'en' })
    expect((online.instructor as Record<string, unknown>).url).toBeUndefined()
  })

  it('a blended class has both locations', () => {
    const s = buildCourseSchema({ ...base, classes: [cls({ mode: 'mixed' })] })!
    const [i] = s.hasCourseInstance as Record<string, unknown>[]
    expect(i.courseMode).toBe('blended')
    expect(i.location).toEqual([expect.objectContaining({ '@type': 'Place' }), expect.objectContaining({ '@type': 'VirtualLocation' })])
  })

  it('asserts nothing that is not authored', () => {
    const s = buildCourseSchema({ ...base, timeZone: null, classes: [cls({ place: null, teachers: [], languages: [], end: null })] })!
    expect(s.description).toBeUndefined()
    expect(s.image).toBeUndefined()
    const [i] = s.hasCourseInstance as Record<string, unknown>[]
    expect(i.location).toBeUndefined()
    expect(i.instructor).toBeUndefined()
    expect(i.inLanguage).toBeUndefined()
    expect(i.courseSchedule).not.toHaveProperty('endTime')
    expect(i.courseSchedule).not.toHaveProperty('scheduleTimezone')
    expect(buildCourseSchema({ ...base, classes: [] })!.hasCourseInstance).toBeUndefined()
  })

  it('emits nothing without a title or a canonical address', () => {
    expect(buildCourseSchema({ ...base, title: ' ', classes: [] })).toBeNull()
    expect(buildCourseSchema({ ...base, origin: null, classes: [] })).toBeNull()
  })
})

describe('courseScheduleOf', () => {
  it('maps every repeat kind', () => {
    expect(courseScheduleOf(cls({ rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH', startsOn: '2027-01-07', endsOn: '2027-06-24' }))).toMatchObject({ repeatFrequency: 'P2W', byDay: ['https://schema.org/Thursday'], startDate: '2027-01-07', endDate: '2027-06-24' })
    expect(courseScheduleOf(cls({ rule: 'FREQ=DAILY;COUNT=1', anchor: '2026-12-12' }))).toMatchObject({ startDate: '2026-12-12', endDate: '2026-12-12', repeatCount: 1 })
    expect(courseScheduleOf(cls({ rule: 'FREQ=MONTHLY;BYDAY=-1SU' }))).toMatchObject({ repeatFrequency: 'P1M', byDay: ['https://schema.org/Sunday'] })
    expect(courseScheduleOf(cls({ rule: 'FREQ=MONTHLY;BYMONTHDAY=15' }))).toMatchObject({ repeatFrequency: 'P1M', byMonthDay: 15 })
    expect(courseScheduleOf(cls({ rule: 'nonsense' }))).toBeNull()
  })
})
