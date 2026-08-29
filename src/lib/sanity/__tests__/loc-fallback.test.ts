import { describe, expect, it } from 'vitest'
import {
  pageBySlugQuery,
  siteConfigQuery,
} from '../queries'

/**
 * Regression guard for the `loc()` GROQ helper.
 *
 * `loc()` used to end with a bare `${field}` fallback so that legacy documents
 * storing a plain string where the schema now declares a localizedString would
 * still resolve. The side effect: a localized object with NO usable locale
 * (e.g. `{_type: 'localizedString'}`, which Sanity Studio leaves behind when an
 * editor clears every language) fell through to that fallback and handed the
 * raw object to React, which throws:
 *
 *   Objects are not valid as a React child (found: object with keys {_type})
 *
 * and 500s the whole page. The fallback is now guarded by
 * `select(!defined(field._type) => field)`: plain strings have no `_type` and
 * still resolve; localized objects always carry `_type` and resolve to null.
 */
describe('loc() locale fallback chain', () => {
  const queries = [
    ['pageBySlugQuery', pageBySlugQuery],
    ['siteConfigQuery', siteConfigQuery],
  ] as const

  for (const [name, query] of queries) {
    it(`${name} never falls back to a raw localized object`, () => {
      // Every coalesce chain emitted by loc() must end with the guard, never a
      // bare field reference.
      const bareFallback = /coalesce\([^()]*?\[\$locale\][^()]*?\.en,\s*[A-Za-z_][\w.[\]"$]*\s*\)/g
      expect(query.match(bareFallback)).toBeNull()
    })

    it(`${name} still resolves plain-string legacy fields`, () => {
      expect(query).toContain('select(!defined(')
    })
  }

  it('resolves the locale chain in priority order', () => {
    // $locale wins, then $defaultLocale, then hardcoded English.
    const idx = (needle: string) => pageBySlugQuery.indexOf(needle)
    expect(idx('[$locale]')).toBeGreaterThan(-1)
    expect(idx('[$locale]')).toBeLessThan(idx('[$defaultLocale]'))
  })
})
