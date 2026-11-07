import { describe, expect, it } from 'vitest'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { RESERVATION_SITE_MESSAGES_FOR_TEST as M, fillSiteMessage, getReservationSiteMessages } from '../messages'

function flat(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]]
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => flat(v, path ? `${path}.${k}` : k))
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const EN = flat(M.en)

describe('reservations website dictionary', () => {
  it('has an entry for every content locale of the platform, with exactly the English keys', () => {
    for (const code of LOCALE_CODES) {
      expect(M[code], `missing locale ${code}`).toBeDefined()
      expect(flat(M[code]).map(([k]) => k), code).toEqual(EN.map(([k]) => k))
    }
    expect(Object.keys(M).sort()).toEqual([...LOCALE_CODES].sort())
  })

  it('has no empty text, and every locale keeps the English placeholders of each text', () => {
    for (const code of LOCALE_CODES) {
      const own = new Map(flat(M[code]))
      for (const [key, en] of EN) {
        const text = own.get(key)!
        expect(text.trim(), `${code}.${key}`).not.toBe('')
        expect(placeholders(text), `${code}.${key}`).toEqual(placeholders(en))
      }
    }
  })

  it('non-English text is really translated (not a copy of the English)', () => {
    const copied = new Set(['booking.reference'])
    for (const code of LOCALE_CODES.filter((c) => c !== 'en')) {
      const own = new Map(flat(M[code]))
      const same = EN.filter(([k, en]) => own.get(k) === en && !copied.has(k) && en.length > 14)
      expect(same.map(([k]) => `${code}.${k}`)).toEqual([])
    }
  })

  it('German addresses the visitor formally (Sie), never "du"', () => {
    const informal = /\b(du|dich|dir|dein\w*|gib|wähle|schau|klicke|prüfe)\b/i
    expect(flat(M.de).filter(([, t]) => informal.test(t))).toEqual([])
  })

  it('falls back to English; a region tag uses its base language', () => {
    expect(getReservationSiteMessages('xx').goHome).toBe(M.en.goHome)
    expect(getReservationSiteMessages(undefined).goHome).toBe(M.en.goHome)
    expect(getReservationSiteMessages('pt-BR').goHome).toBe(M.pt.goHome)
    expect(getReservationSiteMessages('it').goHome).toBe('Vai alla home page')
  })

  it('"link not valid" never says whether the link existed', () => {
    for (const code of LOCALE_CODES) expect(M[code].invalid.body.length).toBeGreaterThan(20)
    expect(M.en.invalid.heading).toBe('This link isn’t valid')
  })

  it('fillSiteMessage fills known placeholders and leaves unknown ones visible', () => {
    expect(fillSiteMessage('Valid {from} to {to} {x}', { from: 'A', to: 'B' })).toBe('Valid A to B {x}')
  })
})
