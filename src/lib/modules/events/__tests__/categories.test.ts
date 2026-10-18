import { describe, expect, it } from 'vitest'
import { EVENT_VOCABULARY_PUBLIC_QUERY, EVENT_VOCABULARY_QUERY, eventCategoryOptions, resolveEventCategories } from '../categories'

const terms = [
  { key: 'workshops', label: 'Workshops', order: 2000 },
  { key: 'talks', label: 'Talks', color: '#e94e1b', order: 1000 },
]
const config = [{ value: 'old', label: 'Old one', color: '#111' }, { value: 'older', label: 'Older' }]

describe('resolveEventCategories (website dual-read)', () => {
  it('uses the term records, in their order, and ignores the config list entirely', () => {
    expect(resolveEventCategories(['workshops', 'talks', 'old'], { terms, config })).toEqual([
      { key: 'talks', title: 'Talks', color: '#e94e1b' },
      { key: 'workshops', title: 'Workshops' },
    ])
  })
  it('falls back to the config list when the project has no terms', () => {
    expect(resolveEventCategories(['older', 'old'], { terms: [], config })).toEqual([
      { key: 'old', title: 'Old one', color: '#111' },
      { key: 'older', title: 'Older' },
    ])
    expect(resolveEventCategories(['old'], { config })).toHaveLength(1)
  })
  it('drops unknown keys and legacy reference entries; nothing stored means nothing shown', () => {
    expect(resolveEventCategories(['nope', { _ref: 'x' }, null], { terms, config })).toEqual([])
    expect(resolveEventCategories(undefined, { terms })).toEqual([])
    expect(resolveEventCategories(['talks'], null)).toEqual([])
  })
  it('a term without a label shows its key', () => {
    expect(resolveEventCategories(['x'], { terms: [{ key: 'x', label: null }] })).toEqual([{ key: 'x', title: 'x' }])
  })
})

describe('eventCategoryOptions (dashboard)', () => {
  it('keeps whole label maps and drops bookkeeping keys', () => {
    expect(eventCategoryOptions({ terms: [{ key: 'a', label: { _type: 'localizedString', en: 'A', it: ' ', translationStatus: { it: 'x' } }, order: 1 }] })).toEqual([
      { value: 'a', label: { en: 'A' }, color: null },
    ])
  })
  it('reads the config list when there are no terms', () => {
    expect(eventCategoryOptions({ terms: [], config: [{ value: 'old', label: { en: 'Old' }, color: '#111' }, null, { label: {} }] })).toEqual([{ value: 'old', label: { en: 'Old' }, color: '#111' }])
  })
})

describe('queries', () => {
  it('are scoped to the project and the events module', () => {
    for (const q of [EVENT_VOCABULARY_QUERY, EVENT_VOCABULARY_PUBLIC_QUERY]) {
      expect(q).toContain('projectSlug == $projectSlug')
      expect(q).toContain('module == "events"')
      expect(q).toContain('moduleId == "events"')
    }
  })
})
