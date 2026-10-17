import { describe, it, expect } from 'vitest'
import { translationCoverage, summarizeCoverage } from '../coverage'

describe('translationCoverage', () => {
  it('marks complete and missing locales, default first', () => {
    const c = translationCoverage({ en: 'Fiction', it: 'Narrativa' }, ['it', 'en', 'de'], 'en')
    expect(c.perLocale).toEqual([
      { locale: 'en', complete: true },
      { locale: 'it', complete: true },
      { locale: 'de', complete: false },
    ])
    expect(c.missing).toEqual(['de'])
    expect(c.completeCount).toBe(2)
    expect(c.isComplete).toBe(false)
  })
  it('treats blank as missing; a newly enabled language shows as missing without data change', () => {
    expect(translationCoverage({ en: ' ' }, ['en'], 'en').missing).toEqual(['en'])
    expect(translationCoverage({ en: 'A' }, ['en'], 'en').isComplete).toBe(true)
    expect(translationCoverage({ en: 'A' }, ['en', 'fr'], 'en').missing).toEqual(['fr'])
  })
  it('ignores labels in disabled locales and handles empty input', () => {
    expect(translationCoverage({ en: 'A', fr: 'B' }, ['en'], 'en').isComplete).toBe(true)
    expect(translationCoverage(undefined, ['en'], 'en').total).toBe(1)
  })
  it('includes the default locale even if absent from the enabled list; no duplicates', () => {
    expect(translationCoverage({}, ['it', 'it'], 'en').perLocale.map((p) => p.locale)).toEqual(['en', 'it'])
  })
  it('summarises', () => {
    const a = translationCoverage({ en: 'A' }, ['en'], 'en')
    const b = translationCoverage({}, ['en'], 'en')
    expect(summarizeCoverage([a, b, b])).toEqual({ needTranslation: 2, total: 3 })
  })
})
