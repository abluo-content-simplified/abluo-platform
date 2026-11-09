import { describe, it, expect } from 'vitest'
import {
  DIGITAL_CARDS_MESSAGES_FOR_TEST,
  DIGITAL_CARDS_MESSAGE_LOCALES,
  digitalCardErrorText,
  digitalCardSourceName,
  formatDigitalCardsMessage,
  getDigitalCardsMessages,
} from '../digital-cards-messages'
import { DIGITAL_CARD_REFERRER_SOURCES } from '@/lib/modules/digital-cards/model'

function flatten(o: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else Object.assign(out, flatten(v, key))
  }
  return out
}

describe('digital cards dashboard messages', () => {
  const en = flatten(DIGITAL_CARDS_MESSAGES_FOR_TEST.en)

  it('covers every dashboard language with every key, none empty', () => {
    for (const code of DIGITAL_CARDS_MESSAGE_LOCALES) {
      const m = DIGITAL_CARDS_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      const flat = flatten(m)
      expect(Object.keys(flat).sort()).toEqual(Object.keys(en).sort())
      for (const [k, v] of Object.entries(flat)) expect(v.trim(), `${code}.${k}`).not.toBe('')
    }
  })

  it('keeps the same placeholders in every language', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const code of DIGITAL_CARDS_MESSAGE_LOCALES) {
      const flat = flatten(DIGITAL_CARDS_MESSAGES_FOR_TEST[code])
      for (const [k, v] of Object.entries(en)) expect(ph(flat[k]), `${code}.${k}`).toBe(ph(v))
    }
  })

  it('the navigation label matches the contract (Title Case in English)', () => {
    expect(getDigitalCardsMessages('en').nav).toBe('Digital Cards')
    expect(getDigitalCardsMessages('it').nav).toBe('Biglietti digitali')
    expect(getDigitalCardsMessages('de').nav).toBe('Digitale Karten')
  })

  it('says "visits", never "people", in the statistics (D11)', () => {
    for (const code of DIGITAL_CARDS_MESSAGE_LOCALES) {
      const e = DIGITAL_CARDS_MESSAGES_FOR_TEST[code].editor
      for (const key of ['visits', 'ctrSub', 'statsNoData', 'statsUnavailable'] as const) {
        expect(e[key].toLowerCase(), `${code}.${key}`).not.toMatch(/\b(people|persone|personen|visitors|visitatori|besucher)\b/)
      }
    }
  })

  it('names every referrer source and the tagged-link sources', () => {
    const m = getDigitalCardsMessages('en')
    for (const [, source] of DIGITAL_CARD_REFERRER_SOURCES) expect(Object.keys(m.sources), source).toContain(source)
    for (const s of ['direct', 'qr', 'instagram', 'linkedin', 'facebook', 'whatsapp', 'email', 'print']) expect(Object.keys(m.sources)).toContain(s)
    expect(digitalCardSourceName(m, 'newsletter-nov')).toBe('newsletter-nov')
  })

  it('falls back to English, fills placeholders, maps unknown error codes to "failed"', () => {
    expect(getDigitalCardsMessages('xx').nav).toBe('Digital Cards')
    expect(getDigitalCardsMessages('de-CH').nav).toBe('Digitale Karten')
    expect(getDigitalCardsMessages(undefined).screen.cancel).toBe('Cancel')
    expect(formatDigitalCardsMessage(getDigitalCardsMessages('it').screen.showing, { shown: 2, total: 5 })).toBe('2 di 5')
    const m = getDigitalCardsMessages('en')
    expect(digitalCardErrorText(m, 'site_exists')).toBe(m.errors.site_exists)
    expect(digitalCardErrorText(m, 'nope')).toBe(m.errors.failed)
  })
})
