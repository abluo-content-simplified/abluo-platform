import { describe, it, expect } from 'vitest'
import {
  applyChangeToRows,
  changeAffects,
  cleanChange,
  countAffected,
  countTags,
  countsFromNames,
  internalTagScopes,
  renameCollision,
  resolveTagSpelling,
  rewriteTags,
  suggestTags,
  tagMatchKey,
  topTags,
  type TagChange,
  type TagRow,
} from '../internal-tags'
import { addTags, editorOffers } from '../tag-editor-model'

describe('internalTagScopes', () => {
  it('media for people who may manage the library, no module needed', () => {
    expect(internalTagScopes({ permissions: ['media.library.manage'], enabledModuleIds: [] })).toEqual([{ scope: 'media', canWrite: true }])
    expect(internalTagScopes({ permissions: [], enabledModuleIds: [] })).toEqual([])
  })
  it('galleries need the module and read; write is separate', () => {
    expect(internalTagScopes({ permissions: ['gallery.gallery.read'], enabledModuleIds: ['gallery'] })).toEqual([{ scope: 'galleries', canWrite: false }])
    expect(internalTagScopes({ permissions: ['gallery.gallery.read', 'gallery.gallery.write'], enabledModuleIds: ['gallery'] })).toEqual([{ scope: 'galleries', canWrite: true }])
    expect(internalTagScopes({ permissions: ['gallery.gallery.read'], enabledModuleIds: [] })).toEqual([])
  })
  it('both, media first', () => {
    const s = internalTagScopes({ permissions: ['media.library.manage', 'gallery.gallery.read'], enabledModuleIds: ['gallery'] })
    expect(s.map((x) => x.scope)).toEqual(['media', 'galleries'])
  })
})

describe('tagMatchKey / resolveTagSpelling', () => {
  it('folds case, accents and spaces', () => {
    expect(tagMatchKey('  Café   Bar ')).toBe('cafe bar')
    expect(tagMatchKey('città')).toBe(tagMatchKey('CITTA'))
  })
  it('uses the existing spelling for a near-duplicate', () => {
    expect(resolveTagSpelling('Cafe', ['café', 'bar'])).toBe('café')
    expect(resolveTagSpelling('CAFÉ ', ['café'])).toBe('café')
  })
  it('normalises new tags the way the server does', () => {
    expect(resolveTagSpelling('Café & Bar!', [])).toBe('café bar')
    expect(resolveTagSpelling('!!!', ['x'])).toBe('')
    expect(resolveTagSpelling('a'.repeat(60), [])).toHaveLength(40)
  })
})

const ROWS: TagRow[] = [
  { id: '1', tags: ['sea', 'sunset'] },
  { id: '2', tags: ['sea'] },
  { id: '3', tags: ['sunset', 'sea', 'sunsets'] },
  { id: '4', tags: ['città'] },
]

describe('counts and suggestions', () => {
  it('counts once per item, most used then A–Z', () => {
    expect(countTags([...ROWS, { id: '5', tags: ['x', 'x'] }])).toEqual([
      { tag: 'sea', count: 3 },
      { tag: 'sunset', count: 2 },
      { tag: 'città', count: 1 },
      { tag: 'sunsets', count: 1 },
      { tag: 'x', count: 1 },
    ])
  })
  it('top tags skip the excluded', () => {
    expect(topTags(countTags(ROWS), 2, ['sea'])).toEqual(['sunset', 'città'])
  })
  it('typing: accent-insensitive, prefix matches first, chosen left out', () => {
    const c = countTags([...ROWS, { id: '6', tags: ['pizza city'] }])
    expect(suggestTags(c, 'citta')).toEqual(['città'])
    expect(suggestTags(c, 'ity')).toEqual(['pizza city'])
    expect(suggestTags(c, 'SUN', ['sunset'])).toEqual(['sunsets'])
    expect(suggestTags(countTags([{ id: 'a', tags: ['big sea', 'sea'] }, { id: 'b', tags: ['big sea'] }]), 'sea')).toEqual(['sea', 'big sea'])
    expect(suggestTags(c, '  ')).toEqual([])
  })
  it('names-only suggestions keep their order', () => {
    expect(countsFromNames(['b', 'a', 'b']).map((x) => x.tag)).toEqual(['b', 'a'])
  })
})

describe('rewriteTags', () => {
  it('rename puts the new name where the old stood', () => {
    expect(rewriteTags(['a', 'b', 'c'], { op: 'merge', from: ['b'], to: 'x' })).toEqual(['a', 'x', 'c'])
  })
  it('merge keeps one copy, even when the target is already there', () => {
    expect(rewriteTags(['a', 'b', 'c'], { op: 'merge', from: ['a', 'c'], to: 'b' })).toEqual(['b'])
    expect(rewriteTags(['a', 'c'], { op: 'merge', from: ['a', 'c'], to: 'z' })).toEqual(['z'])
  })
  it('never ends with more tags than before (cap of 10 holds)', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const out = rewriteTags(ten, { op: 'merge', from: ['t0', 't1'], to: 't9' })
    expect(out.length).toBeLessThanOrEqual(10)
    expect(new Set(out).size).toBe(out.length)
    expect(rewriteTags(ten, { op: 'merge', from: ['t0'], to: 'new' })).toHaveLength(10)
  })
  it('delete removes the tag', () => {
    expect(rewriteTags(['a', 'b'], { op: 'delete', tags: ['a'] })).toEqual(['b'])
    expect(rewriteTags(['a'], { op: 'delete', tags: ['a'] })).toEqual([])
  })
  it('untouched items stay the same', () => {
    expect(changeAffects(['a'], { op: 'delete', tags: ['b'] })).toBe(false)
    expect(rewriteTags(['a'], { op: 'delete', tags: ['b'] })).toEqual(['a'])
  })
})

describe('changes on a list, and undo', () => {
  it('applies to rows and counts what changed', () => {
    const change: TagChange = { op: 'merge', from: ['sunset', 'sunsets'], to: 'sunset' }
    const next = applyChangeToRows(ROWS, change)
    expect(next.find((r) => r.id === '3')!.tags).toEqual(['sunset', 'sea'])
    expect(countAffected(ROWS, change)).toBe(2)
    expect(countTags(next).find((c) => c.tag === 'sunset')!.count).toBe(2)
  })
  it('undo = the previous rows, exactly (nothing is mutated)', () => {
    const before = JSON.parse(JSON.stringify(ROWS)) as TagRow[]
    const after = applyChangeToRows(ROWS, { op: 'delete', tags: ['sea'] })
    expect(after).not.toEqual(before)
    expect(ROWS).toEqual(before)
  })
})

describe('cleanChange / renameCollision', () => {
  it('rejects empty and no-op changes', () => {
    expect(cleanChange({ op: 'delete', tags: [] })).toBeNull()
    expect(cleanChange({ op: 'merge', from: [], to: 'x' })).toBeNull()
    expect(cleanChange({ op: 'merge', from: ['x'], to: ' X ' })).toBeNull()
    expect(cleanChange({ op: 'merge', from: ['a', 'a'], to: 'B!' })).toEqual({ op: 'merge', from: ['a'], to: 'b' })
  })
  it('finds the tag a rename would run into, ignoring case and accents', () => {
    const c = countTags(ROWS)
    expect(renameCollision(c, 'sea', 'Citta')).toBe('città')
    expect(renameCollision(c, 'sea', 'SEA')).toBeNull()
    expect(renameCollision(c, 'sea', 'ocean')).toBeNull()
  })
})

describe('tag box model', () => {
  const known = countTags(ROWS)
  it('shows the 8 most used while empty, without the chosen ones', () => {
    const many = countTags(Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, tags: [`tag${String(i).padStart(2, '0')}`, 'common'] })))
    const offers = editorOffers(['common'], many, '')
    expect(offers).toHaveLength(8)
    expect(offers).not.toContain('common')
    expect(editorOffers([], many, '')[0]).toBe('common')
  })
  it('shows matches while typing and nothing when full', () => {
    expect(editorOffers([], known, 'sun')).toEqual(['sunset', 'sunsets'])
    expect(editorOffers(Array.from({ length: 10 }, (_, i) => `x${i}`), known, '')).toEqual([])
  })
  it('adds with the existing spelling, never a near-duplicate, never past 10', () => {
    expect(addTags([], ['Citta'], known)).toEqual(['città'])
    expect(addTags(['città'], ['CITTA'], known)).toEqual(['città'])
    expect(addTags(['a'], ['brand new'], known)).toEqual(['a', 'brand new'])
    const ten = Array.from({ length: 10 }, (_, i) => `x${i}`)
    expect(addTags(ten, ['more'], known)).toBe(ten)
    expect(addTags(['a'], [' ', '!!'], known)).toEqual(['a'])
  })
})
