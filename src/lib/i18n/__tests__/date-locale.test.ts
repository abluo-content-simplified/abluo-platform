import { describe, expect, it } from 'vitest'
import { resolveDateLocale } from '../date-locale'

const date = new Date(Date.UTC(2026, 10, 11, 16, 0))
const day = (tag: string) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
const time = (tag: string) => new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date)

describe('resolveDateLocale', () => {
  it('English follows the Accept-Language region', () => {
    expect(resolveDateLocale('en', 'en-US,en;q=0.9')).toBe('en-US')
    expect(resolveDateLocale('en', 'en-GB,en;q=0.9')).toBe('en-GB')
    expect(resolveDateLocale('en', 'en-IE')).toBe('en-IE')
    expect(resolveDateLocale('en', 'en-AU,en;q=0.8')).toBe('en-AU')
  })

  it('falls back to European order without an English region', () => {
    expect(resolveDateLocale('en', null)).toBe('en-GB')
    expect(resolveDateLocale('en', undefined)).toBe('en-GB')
    expect(resolveDateLocale('en', '')).toBe('en-GB')
    expect(resolveDateLocale('en', 'en')).toBe('en-GB')
    expect(resolveDateLocale('en', 'it-IT,it;q=0.9')).toBe('en-GB')
    expect(resolveDateLocale('en', '*')).toBe('en-GB')
    expect(resolveDateLocale('en', 'garbage;;')).toBe('en-GB')
  })

  it('orders by q and skips q=0', () => {
    expect(resolveDateLocale('en', 'it-IT,en-US;q=0.8,en-GB;q=0.9')).toBe('en-GB')
    expect(resolveDateLocale('en', 'en-US;q=0,en-GB;q=0.5')).toBe('en-GB')
    expect(resolveDateLocale('en', 'en,en-US;q=0.9')).toBe('en-US')
  })

  it('Italian and German keep their own convention whatever the header says', () => {
    expect(resolveDateLocale('it', 'en-US')).toBe('it-IT')
    expect(resolveDateLocale('de', 'en-GB')).toBe('de-DE')
    expect(resolveDateLocale('it', null)).toBe('it-IT')
  })

  it('formats as Tom expects', () => {
    expect(day(resolveDateLocale('en', 'en-US'))).toBe('Nov 11, 2026')
    expect(day(resolveDateLocale('en', 'en-GB'))).toBe('11 Nov 2026')
    expect(day(resolveDateLocale('en', null))).toBe('11 Nov 2026')
    expect(day(resolveDateLocale('it', null))).toBe('11 nov 2026')
    expect(day(resolveDateLocale('de', null))).toMatch(/^11\. Nov\.? 2026$/)
  })

  it('times are 24-hour in every language and region when hourCycle h23 is set', () => {
    for (const [l, h] of [['en', 'en-US'], ['en', 'en-GB'], ['en', null], ['it', null], ['de', null]] as const) {
      expect(time(resolveDateLocale(l, h))).toBe('16:00')
    }
  })
})
