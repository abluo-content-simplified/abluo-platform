import { describe, it, expect } from 'vitest'
import { TESTIMONIAL_MESSAGES_FOR_TEST, getTestimonialMessages, formatTestimonialMessage } from '../testimonials-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

describe('testimonials messages', () => {
  it('covers every platform locale with every key', () => {
    const keys = Object.keys(TESTIMONIAL_MESSAGES_FOR_TEST.en).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = TESTIMONIAL_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      expect(Object.keys(m).sort()).toEqual(keys)
      for (const k of keys) expect((m as unknown as Record<string, string>)[k], `${code}.${k}`).toBeTruthy()
    }
  })
  it('keeps the same placeholders in every locale', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const [k, v] of Object.entries(TESTIMONIAL_MESSAGES_FOR_TEST.en)) {
      for (const code of Object.keys(PLATFORM_LOCALES)) {
        const t = (TESTIMONIAL_MESSAGES_FOR_TEST[code] as unknown as Record<string, string>)[k]
        expect(ph(t), `${code}.${k}`).toBe(ph(v))
      }
    }
  })
  it('falls back to English and fills placeholders', () => {
    expect(getTestimonialMessages('xx').close).toBe('Close')
    expect(getTestimonialMessages(undefined).anonymous).toBe('Anonymous')
    expect(formatTestimonialMessage(getTestimonialMessages('it').slideLabel, { n: 2, total: 5 })).toBe('2 di 5')
  })
})
