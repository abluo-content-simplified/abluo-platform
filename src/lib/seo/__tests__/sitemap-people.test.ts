import { describe, expect, it } from 'vitest'
import { peopleSitemapEntries } from '../sitemap-people'

const row = (slugs: Record<string, string>, updated = '2026-11-01T10:00:00Z') => ({
  slugMap: Object.fromEntries(Object.entries(slugs).map(([l, s]) => [l, { current: s }])),
  _updatedAt: updated,
})
const base = { origin: 'https://www.example.it', locales: ['en', 'it', 'de'], primaryLocale: 'en' }

describe('peopleSitemapEntries (requirement 4)', () => {
  it('one URL per locale where the slug AND the language segment are set', () => {
    const out = peopleSitemapEntries({
      ...base,
      rows: [row({ en: 'anna-rossi', it: 'anna-rossi', de: 'anna-rossi' })],
      profileSegment: { _type: 'localizedString', en: 'team', it: 'insegnanti' },
    })
    expect(out.map((e) => e.url)).toEqual([
      'https://www.example.it/en/team/anna-rossi',
      'https://www.example.it/it/insegnanti/anna-rossi',
    ])
  })
  it('skips locales without a slug', () => {
    const out = peopleSitemapEntries({ ...base, rows: [row({ it: 'anna' })], profileSegment: { en: 'team', it: 'insegnanti' } })
    expect(out.map((e) => e.url)).toEqual(['https://www.example.it/it/insegnanti/anna'])
  })
  it('no segment, invalid or reserved segment: nothing', () => {
    expect(peopleSitemapEntries({ ...base, rows: [row({ en: 'a' })], profileSegment: undefined })).toEqual([])
    expect(peopleSitemapEntries({ ...base, rows: [row({ en: 'a' })], profileSegment: { en: 'blog' } })).toEqual([])
    expect(peopleSitemapEntries({ ...base, rows: [row({ en: 'a' })], profileSegment: { en: 'a/b' } })).toEqual([])
  })
  it('no rows: nothing; lastModified comes from the document', () => {
    expect(peopleSitemapEntries({ ...base, rows: null, profileSegment: { en: 'team' } })).toEqual([])
    const [e] = peopleSitemapEntries({ ...base, rows: [row({ en: 'a' })], profileSegment: { en: 'team' } })
    expect(e.lastModified).toEqual(new Date('2026-11-01T10:00:00Z'))
  })
})
