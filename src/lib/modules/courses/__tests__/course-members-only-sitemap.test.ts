/**
 * Members-only course pages never reach the sitemap: a course shown only by
 * members-only timetable pages takes their access (course-gate.ts). Evaluated
 * by groq-js on the real query.
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { SITEMAP_COURSES_QUERY } from '../queries'
import { courseSitemapEntries } from '@/lib/seo/sitemap-courses'

const course = (id: string) => ({ _id: id, _type: 'course', projectSlug: 'cyce', slug: { en: { _type: 'slug', current: id } } })
const timetablePage = (id: string, access: unknown, section: Record<string, unknown> = { courseScope: 'all' }) => ({
  _id: id,
  _type: 'page',
  projectSlug: 'cyce',
  slug: { en: { current: id } },
  ...(access ? { access } : {}),
  sections: [{ _type: 'timetableSection', ...section }],
})
const MEMBERS = { visibility: 'restricted', groups: ['g'] }

async function rows(dataset: unknown[]) {
  const params = { projectSlug: 'cyce' }
  return (await (await evaluate(parse(SITEMAP_COURSES_QUERY, { params }), { dataset, params })).get()) as Array<{ slugMap: unknown; membersOnly: boolean }>
}

describe('sitemap: members-only course pages are left out', () => {
  it('only members-only timetables show it → membersOnly; a public one or none → listed', async () => {
    const members = await rows([course('a'), timetablePage('timetable', MEMBERS)])
    expect(members[0].membersOnly).toBe(true)
    const mixed = await rows([course('a'), timetablePage('timetable', MEMBERS), timetablePage('open', null)])
    expect(mixed[0].membersOnly).toBe(false)
    const none = await rows([course('a')])
    expect(none[0].membersOnly).toBe(false)
    // A members-only page that picks OTHER courses does not make this one members only.
    const other = await rows([course('a'), timetablePage('timetable', MEMBERS, { courseScope: 'pick', courses: [{ _ref: 'b' }] })])
    expect(other[0].membersOnly).toBe(false)
  })

  it('courseSitemapEntries skips them', () => {
    const out = courseSitemapEntries({
      rows: [{ slugMap: { en: { current: 'a' } }, membersOnly: true }, { slugMap: { en: { current: 'b' } }, membersOnly: false }],
      courseSegment: { en: 'classes' },
      origin: 'https://www.example.com',
      locales: ['en'],
      primaryLocale: 'en',
    })
    expect(out.map((e) => e.url)).toEqual(['https://www.example.com/en/classes/b'])
  })
})
