import { describe, expect, it } from 'vitest'
import { damerau, fold, fullDateTime, highlightSegments, matchCandidate, parsePrefix, pickTopHit, rankMatches, relativeShort, typoBudget, withPrefix } from '../search-match'

describe('fold', () => {
  it('drops accents and case', () => {
    expect(fold('  Perché ÉVÉNEMENT ')).toBe('perche evenement')
  })
})

describe('damerau', () => {
  it('counts insert, delete, substitute and transposition as one', () => {
    expect(damerau('events', 'evnets')).toBe(1)
    expect(damerau('events', 'event')).toBe(1)
    expect(damerau('media', 'medya')).toBe(1)
    expect(damerau('abc', 'xyz')).toBe(3)
    expect(damerau('', 'ab')).toBe(2)
  })
  it('budget grows with word length', () => {
    expect([typoBudget(3), typoBudget(4), typoBudget(7), typoBudget(8)]).toEqual([0, 1, 1, 2])
  })
})

describe('parsePrefix', () => {
  it('reads / and + only at the very start', () => {
    expect(parsePrefix('/')).toEqual({ mode: 'goto', token: '/', text: '' })
    expect(parsePrefix('/set')).toEqual({ mode: 'goto', token: '/', text: 'set' })
    expect(parsePrefix('+ post')).toEqual({ mode: 'create', token: '+', text: 'post' })
    expect(parsePrefix('a/b')).toEqual({ mode: 'all', token: '', text: 'a/b' })
    expect(parsePrefix(' /x').mode).toBe('all')
    expect(parsePrefix('c++').mode).toBe('all')
  })
  it('chips replace an existing prefix', () => {
    expect(withPrefix('', '/')).toBe('/')
    expect(withPrefix('+ post', '/')).toBe('/post')
    expect(withPrefix('post', '+')).toBe('+post')
  })
})

describe('matchCandidate', () => {
  const events = { label: 'Events', synonyms: ['calendar', 'agenda', 'appointment', 'meeting'] }
  it('matches everything for an empty query, never strongly', () => {
    expect(matchCandidate('', events)).toEqual({ score: 1, strong: false })
  })
  it('matches word prefixes, accents and case aside', () => {
    expect(matchCandidate('eve', events)?.strong).toBe(true)
    expect(matchCandidate('EVÉ', events)?.strong).toBe(true)
    expect(matchCandidate('req', { label: 'Contact Requests' })?.strong).toBe(false)
    expect(matchCandidate('req', { label: 'Contact Requests' })).not.toBeNull()
    expect(matchCandidate('xyz', events)).toBeNull()
  })
  it('matches synonyms, strongly when they start with the query', () => {
    expect(matchCandidate('calen', events)?.strong).toBe(true)
    expect(matchCandidate('meet', events)?.strong).toBe(true)
  })
  it('tolerates typos from 4 letters on, not before', () => {
    expect(matchCandidate('evnts', events)).not.toBeNull()
    expect(matchCandidate('evnts', events)?.strong).toBe(false)
    expect(matchCandidate('calender', events)).not.toBeNull()
    expect(matchCandidate('evx', events)).toBeNull()
    expect(matchCandidate('xvents', events)).not.toBeNull()
  })
  it('every query word must match', () => {
    expect(matchCandidate('contact req', { label: 'Contact Requests' })).not.toBeNull()
    expect(matchCandidate('contact zzz', { label: 'Contact Requests' })).toBeNull()
  })
  it('exact beats prefix beats synonym beats typo', () => {
    const exact = matchCandidate('media', { label: 'Media' })!.score
    const prefix = matchCandidate('med', { label: 'Media' })!.score
    const syn = matchCandidate('photos', { label: 'Media', synonyms: ['photos'] })!.score
    const typo = matchCandidate('medya', { label: 'Media' })!.score
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(typo)
    expect(syn).toBeGreaterThan(typo)
  })
})

describe('pickTopHit', () => {
  const items = [
    { id: 'goto:events', c: { label: 'Events' } },
    { id: 'create:event', c: { label: 'Event', synonyms: ['calendar'] } },
    { id: 'goto:people', c: { label: 'People', synonyms: ['team'] } },
  ]
  const rank = (q: string) => rankMatches(items, q, (i) => i.c)
  it('takes the strongest strong match; Go To wins a tie', () => {
    expect(pickTopHit(rank('event'), 'event')?.id).toBe('create:event')
    expect(pickTopHit(rank('events'), 'events')?.id).toBe('goto:events')
    expect(pickTopHit(rank('team'), 'team')?.id).toBe('goto:people')
  })
  it('none for one character or only weak matches', () => {
    expect(pickTopHit(rank('e'), 'e')).toBeUndefined()
    expect(pickTopHit(rank('evnts'), 'evnts')).toBeUndefined()
  })
})

describe('highlightSegments', () => {
  const join = (s: { text: string; match: boolean }[]) => s.map((x) => (x.match ? `[${x.text}]` : x.text)).join('')
  it('marks word prefixes', () => {
    expect(join(highlightSegments('Contact Requests', ['req']))).toBe('Contact [Req]uests')
    expect(join(highlightSegments('Contact Requests', ['con', 'req']))).toBe('[Con]tact [Req]uests')
  })
  it('is accent- and case-insensitive and keeps the original text', () => {
    expect(join(highlightSegments('Événements du soir', ['even']))).toBe('[Évén]ements du soir')
    expect(join(highlightSegments('Perché', ['PERCHE']))).toBe('[Perché]')
  })
  it('returns the text untouched without a match', () => {
    expect(highlightSegments('Media', ['zz'])).toEqual([{ text: 'Media', match: false }])
    expect(highlightSegments('Media', [])).toEqual([{ text: 'Media', match: false }])
    expect(highlightSegments('Media', ['ia'])).toEqual([{ text: 'Media', match: false }])
  })
})

describe('relativeShort', () => {
  const now = Date.parse('2026-11-08T12:00:00Z')
  const ago = (s: number) => new Date(now - s * 1000).toISOString()
  it('reads days, weeks and months compactly', () => {
    expect(relativeShort(ago(2 * 86400), 'en', now)).toBe('2d')
    expect(relativeShort(ago(7 * 86400), 'en', now)).toBe('1w')
    expect(relativeShort(ago(95 * 86400), 'en', now)).toBe('3mo')
  })
  it('hours and minutes use their own unit; recent is "now"', () => {
    expect(relativeShort(ago(3 * 3600), 'en', now)).toMatch(/^3\s?h/)
    expect(relativeShort(ago(5), 'en', now)).toBe('now')
    expect(relativeShort(new Date(now + 99999).toISOString(), 'en', now)).toBe('now')
  })
  it('other languages and bad input', () => {
    expect(relativeShort(ago(2 * 86400), 'it', now)).toMatch(/^2\s?g/)
    expect(relativeShort('nope', 'en', now)).toBe('')
    expect(fullDateTime('nope', 'en')).toBe('')
  })
})
