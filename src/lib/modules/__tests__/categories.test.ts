import { describe, it, expect } from 'vitest'
import { resolveCategories } from '../categories'

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
