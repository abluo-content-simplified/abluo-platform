import { describe, it, expect } from 'vitest'
import { getBlogModuleMessages, formatBlogDate } from '@/lib/i18n/blog-module-messages'
import { LOCALE_CODES } from '@/lib/i18n/locales'

// An Italian reader on an Italian page saw "Feb 12, 2026 · 2 min read".

describe('blog module messages', () => {
  it('covers every locale in the platform registry', () => {
    for (const code of LOCALE_CODES) {
      const msg = getBlogModuleMessages(code)
      expect(msg.readingTime(2), code).toContain('2')
      expect(msg.blogListLabel, code).toBeTruthy()
      // Only English may say "min read"; any other locale doing so is a gap
      // silently falling through to the English dictionary.
      if (code !== 'en') expect(msg.readingTime(2), code).not.toContain('min read')
    }
  })

  it('reads Italian in Italian', () => {
    expect(getBlogModuleMessages('it').readingTime(2)).toBe('2 min di lettura')
    expect(getBlogModuleMessages('de').readingTime(2)).toBe('2 Min. Lesezeit')
  })

  it('falls back to English for an unknown locale rather than throwing', () => {
    expect(getBlogModuleMessages('xx').readingTime(5)).toBe('5 min read')
    expect(getBlogModuleMessages(undefined).readingTime(5)).toBe('5 min read')
  })

  it('formats the date in the reader’s locale, not always English', () => {
    const it = formatBlogDate('2026-02-12T00:00:00Z', 'it')
    const en = formatBlogDate('2026-02-12T00:00:00Z', 'en')
    expect(it).not.toBe(en)
    expect(it).toContain('2026')
  })

  it('returns the raw value rather than crashing on a bad date', () => {
    expect(formatBlogDate('not-a-date', 'it')).toBe('not-a-date')
  })
})
