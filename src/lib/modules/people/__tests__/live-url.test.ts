/** "View on website": only a published, non-archived person with visibility "page", a profile segment and a slug in THIS language. */
import { describe, it, expect } from 'vitest'
import { personLiveUrl, type PersonLiveInfo } from '../live-url'

const live = (o: Partial<PersonLiveInfo> = {}): PersonLiveInfo => ({
  origin: 'https://www.cyce.info',
  published: true,
  archived: false,
  anonymised: false,
  visibility: 'page',
  slugs: { it: 'anna-rossi', en: 'anna-rossi-en' },
  segments: { it: 'insegnanti', en: 'teachers' },
  ...o,
})

describe('personLiveUrl', () => {
  it('builds the canonical profile URL in the language asked', () => {
    expect(personLiveUrl(live(), 'it')).toBe('https://www.cyce.info/it/insegnanti/anna-rossi')
    expect(personLiveUrl(live(), 'en')).toBe('https://www.cyce.info/en/teachers/anna-rossi-en')
  })
  it('tolerates stray slashes', () => {
    expect(personLiveUrl(live({ origin: 'https://www.cyce.info/', segments: { it: '/insegnanti/' }, slugs: { it: '/anna/' } }), 'it')).toBe('https://www.cyce.info/it/insegnanti/anna')
  })
  it.each([
    ['not published', { published: false }],
    ['archived', { archived: true }],
    ['anonymised', { anonymised: true }],
    ['visibility listed', { visibility: 'listed' as const }],
    ['visibility off', { visibility: 'off' as const }],
    ['no custom domain', { origin: null }],
  ])('no link when %s', (_n, o) => {
    expect(personLiveUrl(live(o), 'it')).toBeNull()
  })
  it('no link without a segment or a slug in that language (no fallback)', () => {
    expect(personLiveUrl(live({ segments: { en: 'teachers' } }), 'it')).toBeNull()
    expect(personLiveUrl(live({ slugs: { en: 'x' } }), 'it')).toBeNull()
    expect(personLiveUrl(live(), 'de')).toBeNull()
    expect(personLiveUrl(null, 'it')).toBeNull()
  })
})
