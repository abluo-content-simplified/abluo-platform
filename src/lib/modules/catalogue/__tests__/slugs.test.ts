import { describe, it, expect } from 'vitest'
import {
  normalise,
  slugConflicts,
  segmentIssues,
  applySegmentChange,
  reservedSegments,
  resolveSegment,
  publicPath,
  DEFAULT_RESERVED_SEGMENTS,
  type SlugOwner,
  type SegmentState,
} from '../slugs'

const owner = (over: Partial<SlugOwner> & { id: string }): SlugOwner => ({
  type: 'item',
  hasPage: true,
  slugs: {},
  ...over,
})

describe('normalise', () => {
  it('trims, strips slashes, lowercases', () => {
    expect(normalise('  /Menu/ ')).toBe('menu')
    expect(normalise('PIZZA')).toBe('pizza')
  })

  it('folds Unicode to NFC so the same word is the same slug', () => {
    const composed = 'caffè' // è
    const decomposed = 'caffè' // e + combining grave
    expect(normalise(composed)).toBe(normalise(decomposed))
  })

  it('is total for missing values', () => {
    expect(normalise(undefined)).toBe('')
    expect(normalise(null)).toBe('')
    expect(normalise('   ')).toBe('')
  })
})

describe('slugConflicts — one namespace for items and collections (D11)', () => {
  const existing = [
    owner({ id: 'item-pizza', type: 'item', slugs: { it: 'pizza-margherita', en: 'margherita' } }),
    owner({ id: 'coll-natale', type: 'collection', slugs: { it: 'menu-di-natale' } }),
  ]

  it('finds no conflict for a free slug', () => {
    expect(slugConflicts({ id: 'new', slugs: { it: 'calzone' } }, existing)).toEqual([])
  })

  it('finds a collision between an item and a collection', () => {
    const conflicts = slugConflicts({ id: 'new-coll', slugs: { it: 'pizza-margherita' } }, existing)
    expect(conflicts).toEqual([
      { locale: 'it', slug: 'pizza-margherita', owner: { id: 'item-pizza', type: 'item' } },
    ])
  })

  it('finds a collision in the other direction too', () => {
    const conflicts = slugConflicts({ id: 'new-item', slugs: { it: 'menu-di-natale' } }, existing)
    expect(conflicts[0].owner).toEqual({ id: 'coll-natale', type: 'collection' })
  })

  it('is locale-independent — the same slug in two locales is two URLs', () => {
    // 'margherita' is taken in en but free in it.
    expect(slugConflicts({ id: 'new', slugs: { it: 'margherita' } }, existing)).toEqual([])
    expect(slugConflicts({ id: 'new', slugs: { en: 'margherita' } }, existing)).toHaveLength(1)
  })

  it('does not report a document against itself', () => {
    expect(slugConflicts({ id: 'item-pizza', slugs: { it: 'pizza-margherita' } }, existing)).toEqual([])
  })

  it('ignores documents without a public page', () => {
    const hidden = [owner({ id: 'x', hasPage: false, slugs: { it: 'pizza-margherita' } })]
    expect(slugConflicts({ id: 'new', slugs: { it: 'pizza-margherita' } }, hidden)).toEqual([])
  })

  it('compares normalised values', () => {
    expect(slugConflicts({ id: 'new', slugs: { it: ' /Pizza-Margherita/ ' } }, existing)).toHaveLength(1)
  })

  it('skips empty slugs rather than matching them to each other', () => {
    const blanks = [owner({ id: 'a', slugs: { it: '' } })]
    expect(slugConflicts({ id: 'new', slugs: { it: null } }, blanks)).toEqual([])
  })
})

describe('segmentIssues', () => {
  it('accepts an ordinary segment', () => {
    expect(segmentIssues('menu')).toEqual([])
    expect(segmentIssues('wine-list')).toEqual([])
  })

  it('rejects an empty one', () => {
    expect(segmentIssues('  ')).toEqual([{ kind: 'empty' }])
  })

  it('rejects characters that would not survive a URL', () => {
    expect(segmentIssues('Menu Di Natale')).toContainEqual({
      kind: 'invalidCharacters',
      value: 'menu di natale',
    })
  })

  it('refuses a reserved platform route', () => {
    for (const r of DEFAULT_RESERVED_SEGMENTS) {
      expect(segmentIssues(r)).toContainEqual({ kind: 'reservedRoute', value: r })
    }
  })

  it('refuses a segment that would shadow a page slug, naming the locale', () => {
    const issues = segmentIssues('about', { pageSlugs: { en: ['about', 'contact'] } })
    expect(issues).toContainEqual({ kind: 'pageSlugCollision', value: 'about', locale: 'en' })
  })

  it('checks every locale’s page slugs', () => {
    const issues = segmentIssues('chi-siamo', { pageSlugs: { en: ['about'], it: ['chi-siamo'] } })
    expect(issues).toContainEqual({ kind: 'pageSlugCollision', value: 'chi-siamo', locale: 'it' })
  })

  it('takes the reserved list as an argument rather than owning it', () => {
    expect(segmentIssues('events', { reserved: [] })).toEqual([])
  })
})

describe('applySegmentChange — history is a list (D11)', () => {
  it('records the replaced segment', () => {
    const next = applySegmentChange({ current: 'menu', history: [] }, 'carta')
    expect(next).toEqual({ current: 'carta', history: ['menu'] })
  })

  it('keeps every historic segment across successive renames', () => {
    let state: SegmentState = { current: 'menu', history: [] }
    state = applySegmentChange(state, 'carta')
    state = applySegmentChange(state, 'menu-2026')
    expect(state.current).toBe('menu-2026')
    expect([...state.history].sort()).toEqual(['carta', 'menu'])
  })

  it('removes a segment from history when reverting to it', () => {
    let state: SegmentState = { current: 'menu', history: [] }
    state = applySegmentChange(state, 'carta')
    state = applySegmentChange(state, 'menu')
    expect(state.current).toBe('menu')
    expect(state.history).toEqual(['carta'])
  })

  it('is a no-op when the segment does not change', () => {
    expect(applySegmentChange({ current: 'menu', history: ['carta'] }, 'menu')).toEqual({
      current: 'menu',
      history: ['carta'],
    })
  })

  it('ignores an empty new value', () => {
    expect(applySegmentChange({ current: 'menu', history: [] }, '  ')).toEqual({
      current: 'menu',
      history: [],
    })
  })

  it('deduplicates normalised history rather than reserving a name twice', () => {
    let state: SegmentState = { current: 'Menu', history: ['/menu/', 'MENU'] }
    state = applySegmentChange(state, 'carta')
    expect(state.history).toEqual(['menu'])
  })
})

describe('reservedSegments / resolveSegment', () => {
  const state = { current: 'menu-2026', history: ['menu', 'carta'] }

  it('reserves the live segment and every historic one', () => {
    expect(reservedSegments(state).sort()).toEqual(['carta', 'menu', 'menu-2026'])
  })

  it('serves the live segment', () => {
    expect(resolveSegment(state, 'menu-2026')).toEqual({ kind: 'serve' })
  })

  it('redirects every historic segment to the current one', () => {
    expect(resolveSegment(state, 'menu')).toEqual({ kind: 'redirect', to: 'menu-2026' })
    expect(resolveSegment(state, 'carta')).toEqual({ kind: 'redirect', to: 'menu-2026' })
  })

  it('leaves anything else alone so the route can fall through', () => {
    expect(resolveSegment(state, 'events')).toEqual({ kind: 'unknown' })
    expect(resolveSegment(state, '')).toEqual({ kind: 'unknown' })
  })

  it('stops redirecting a segment once it has been reverted to', () => {
    const reverted = applySegmentChange(state, 'menu')
    expect(resolveSegment(reverted, 'menu')).toEqual({ kind: 'serve' })
    expect(resolveSegment(reverted, 'menu-2026')).toEqual({ kind: 'redirect', to: 'menu' })
  })

  it('normalises the request before deciding', () => {
    expect(resolveSegment(state, ' /Menu/ ')).toEqual({ kind: 'redirect', to: 'menu-2026' })
  })
})

describe('publicPath', () => {
  it('builds the canonical path', () => {
    expect(publicPath({ locale: 'it', tenant: 'damario', segment: 'menu', slug: 'pizza' })).toBe(
      '/it/damario/menu/pizza',
    )
  })

  it('normalises the parts it is given', () => {
    expect(publicPath({ locale: 'it', tenant: 'damario', segment: '/Menu/', slug: ' Pizza ' })).toBe(
      '/it/damario/menu/pizza',
    )
  })
})
