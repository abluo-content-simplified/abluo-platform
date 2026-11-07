import { describe, it, expect } from 'vitest'
import { courseSitemapEntries } from '../sitemap-courses'
import { SITEMAP_COURSES_QUERY, COURSE_VISIBLE } from '@/lib/modules/courses/queries'

const row = (slugs: Record<string, string>, updated = '2026-11-01T10:00:00Z') => ({
  slugMap: Object.fromEntries(Object.entries(slugs).map(([l, s]) => [l, { current: s }])),
  _updatedAt: updated,
})
const base = { origin: 'https://www.cyce.info', locales: ['fr', 'en', 'de'], primaryLocale: 'fr' }

describe('course pages in the sitemap', () => {
  it('one URL per locale where both the slug and the segment exist', () => {
    const out = courseSitemapEntries({ ...base, rows: [row({ fr: 'yoga-iyengar', en: 'iyengar-yoga', de: 'iyengar' })], courseSegment: { _type: 'localizedString', fr: 'cours', en: 'classes' } })
    expect(out.map((e) => e.url)).toEqual(['https://www.cyce.info/fr/cours/yoga-iyengar', 'https://www.cyce.info/en/classes/iyengar-yoga'])
    expect(out[0]).toMatchObject({ priority: 0.6, changeFrequency: 'weekly', lastModified: new Date('2026-11-01T10:00:00Z') })
    expect(out[1].priority).toBe(0.5)
  })
  it('nothing without a (valid) segment or without rows', () => {
    expect(courseSitemapEntries({ ...base, rows: [row({ fr: 'a' })], courseSegment: undefined })).toEqual([])
    expect(courseSitemapEntries({ ...base, rows: [row({ fr: 'a' })], courseSegment: { fr: 'blog' } })).toEqual([])
    expect(courseSitemapEntries({ ...base, rows: [row({ fr: 'a' })], courseSegment: { fr: 'a/b' } })).toEqual([])
    expect(courseSitemapEntries({ ...base, rows: null, courseSegment: { fr: 'cours' } })).toEqual([])
  })
  it('the rows are only courses on the website, of one project', () => {
    expect(SITEMAP_COURSES_QUERY).toContain(COURSE_VISIBLE)
    expect(SITEMAP_COURSES_QUERY).toContain('projectSlug == $projectSlug')
  })
})
