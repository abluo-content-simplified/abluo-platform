import { describe, it, expect } from 'vitest'
import { resolveCategories, resolveCategoriesFor, categoryKeysOf } from '../categories'

// ── Dual-read during the blogCategory retirement ─────────────────────────────
//
// Content migrated to module-config categories stores a stable key. Content not
// yet migrated stores a reference, which GROQ resolves to the category's English
// title. resolveCategories must accept either, so that a deploy and a data
// migration landing seconds apart cannot blank out every badge on the site.
//
// This is the same class of bug as the 2026-08-14 outage, inverted: there, data
// moved ahead of code; here, code would move ahead of data. Reading both shapes
// makes the ordering stop mattering.

describe('resolveCategories — legacy reference shape', () => {
  const modules = [
    {
      moduleId: 'blog',
      enabled: true,
      config: {
        categories: [
          { _key: 'a', value: 'dental-health', label: { en: 'Dental Health', it: 'Salute Dentale' } },
          { _key: 'b', value: 'insights', label: { en: 'Insights', it: 'Approfondimenti' } },
        ],
      },
    },
  ] as unknown as Parameters<typeof resolveCategories>[1]

  it('resolves content that stores the new stable key', () => {
    const out = resolveCategories(['dental-health'], modules, 'blog', 'en')
    expect(out.map((c) => c.title)).toEqual(['Dental Health'])
  })

  it('resolves content that still stores a reference, via the English title', () => {
    const out = resolveCategories(['Dental Health'], modules, 'blog', 'en')
    expect(out.map((c) => c.key)).toEqual(['dental-health'])
  })

  it('returns the requested locale even when matched by the English title', () => {
    // The match is on English because that is what GROQ resolves the reference
    // to; the label shown must still follow the visitor's locale.
    const out = resolveCategories(['Dental Health'], modules, 'blog', 'it')
    expect(out.map((c) => c.title)).toEqual(['Salute Dentale'])
  })

  it('handles a mix of migrated and unmigrated entries', () => {
    const out = resolveCategories(['insights', 'Dental Health'], modules, 'blog', 'en')
    expect(out.map((c) => c.key).sort()).toEqual(['dental-health', 'insights'])
  })

  it('still drops keys that match nothing', () => {
    expect(resolveCategories(['no-such-category'], modules, 'blog', 'en')).toEqual([])
  })

  it('does not match an empty or missing label by accident', () => {
    // A config entry with no English label must not swallow an empty key.
    const bare = [
      { moduleId: 'blog', enabled: true, config: { categories: [{ _key: 'x', value: 'x', label: {} }] } },
    ] as unknown as Parameters<typeof resolveCategories>[1]
    expect(resolveCategories([''], bare, 'blog', 'en')).toEqual([])
  })
})

// ── categoryKeysOf — the merge GROQ cannot express ───────────────────────────
//
// The previous attempt did this in GROQ with `categories[]{ "k": ... }`, which
// object-projects over the array. That yields [null] when the elements are
// plain strings, so the moment content was migrated to stable keys every badge
// silently vanished — and the bug survived review because it was only ever
// tested against the reference shape. These tests exercise BOTH shapes, and a
// document caught mid-migration with one of each.

describe('categoryKeysOf', () => {
  it('reads stable keys from migrated content', () => {
    expect(categoryKeysOf({ categoryKeys: ['dental-health'], categoryTitles: [null] }))
      .toEqual(['dental-health'])
  })

  it('reads the resolved title from unmigrated reference content', () => {
    expect(categoryKeysOf({
      categoryKeys: [{ _ref: '44f4b856', _type: 'reference' }],
      categoryTitles: ['Dental Health'],
    })).toEqual(['Dental Health'])
  })

  it('handles a document holding one of each shape, positionally', () => {
    // The two arrays are projected from the same source array, so index i of
    // one must line up with index i of the other.
    expect(categoryKeysOf({
      categoryKeys: [{ _ref: 'x', _type: 'reference' }, 'insights'],
      categoryTitles: ['Events', null],
    })).toEqual(['Events', 'insights'])
  })

  it('drops a reference whose title did not resolve', () => {
    // A dangling reference must not emit an empty badge.
    expect(categoryKeysOf({
      categoryKeys: [{ _ref: 'deleted', _type: 'reference' }],
      categoryTitles: [null],
    })).toEqual([])
  })

  it('survives missing, null, and empty inputs', () => {
    expect(categoryKeysOf(null)).toEqual([])
    expect(categoryKeysOf({})).toEqual([])
    expect(categoryKeysOf({ categoryKeys: null, categoryTitles: null })).toEqual([])
    expect(categoryKeysOf({ categoryKeys: [], categoryTitles: [] })).toEqual([])
  })

  it('ignores empty strings and null entries rather than emitting blanks', () => {
    expect(categoryKeysOf({ categoryKeys: ['', null, 'events'], categoryTitles: [] }))
      .toEqual(['events'])
  })

  it('tolerates a titles array shorter than the keys array', () => {
    expect(categoryKeysOf({
      categoryKeys: ['insights', { _ref: 'y', _type: 'reference' }],
      categoryTitles: [null],
    })).toEqual(['insights'])
  })
})

describe('resolveCategoriesFor — both shapes reach a badge', () => {
  const modules = [
    {
      moduleId: 'blog',
      enabled: true,
      config: {
        categories: [
          { _key: 'a', value: 'dental-health', label: { en: 'Dental Health', it: 'Salute Dentale' } },
        ],
      },
    },
  ] as unknown as Parameters<typeof resolveCategoriesFor>[1]

  it('renders the Italian badge for migrated content', () => {
    const out = resolveCategoriesFor(
      { categoryKeys: ['dental-health'], categoryTitles: [null] }, modules, 'blog', 'it'
    )
    expect(out.map((c) => c.title)).toEqual(['Salute Dentale'])
  })

  it('renders the Italian badge for unmigrated reference content', () => {
    // This is the exact case that broke: same visible output must come out of
    // either shape, so a migration cannot change what a visitor sees.
    const out = resolveCategoriesFor(
      { categoryKeys: [{ _ref: 'x', _type: 'reference' }], categoryTitles: ['Dental Health'] },
      modules, 'blog', 'it'
    )
    expect(out.map((c) => c.title)).toEqual(['Salute Dentale'])
  })
})
