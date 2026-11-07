import { describe, expect, it } from 'vitest'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { DICTIONARIES, EMAIL_LOCALES, type Messages } from '../templates/dictionaries'
import { chooseEmailLocale, formatAmount, formatDateTime, formatTime, pickLocalized } from '../templates/format'
import { INTENTS, renderReservationEmail, type RenderInput } from '../templates/render'

const base: RenderInput = {
  intent: 'booking.confirmed', locale: 'en', siteName: 'Yoga Club', firstName: 'Anna', reference: 'CYCE-7K2MQ',
  sessions: [{ startsAt: '2026-11-12T17:30:00Z', timeZone: 'Europe/Rome' }, { startsAt: '2026-11-19T17:30:00Z' }],
  siteTimeZone: 'Europe/Rome', totalCents: 12500,
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const leaves = (o: unknown, path = ''): Array<[string, string]> =>
  typeof o === 'string' ? [[path, o]] : Object.entries(o as object).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))

describe('dictionaries', () => {
  it('cover every platform locale, no more', () => {
    expect([...EMAIL_LOCALES].sort()).toEqual([...LOCALE_CODES].sort())
  })
  it('every locale has the same keys and the same placeholders per text as English', () => {
    const en = leaves(DICTIONARIES.en)
    for (const l of EMAIL_LOCALES) {
      const other = new Map(leaves(DICTIONARIES[l as keyof typeof DICTIONARIES] as Messages))
      expect([...other.keys()].sort()).toEqual(en.map(([k]) => k).sort())
      for (const [k, v] of en) {
        expect(other.get(k)!.trim().length, `${l}.${k}`).toBeGreaterThan(0)
        expect(placeholders(other.get(k)!), `${l}.${k}`).toBe(placeholders(v))
      }
    }
  })
})

describe('render: every intent in every locale', () => {
  for (const locale of EMAIL_LOCALES) {
    for (const intent of INTENTS) {
      it(`${intent} / ${locale}`, () => {
        const m = renderReservationEmail({
          ...base, locale, intent, holdExpiresAt: '2026-11-10T21:59:00Z', paymentInstructions: 'Pay by transfer', bankDetails: 'IBAN IT00 X',
          manageUrl: 'https://www.x.it/it/booking/tok', passLinks: [{ url: 'https://www.x.it/it/my-pass/p1' }], outcome: 'credit',
          customSubject: 'Room changed', customBody: 'Hi Anna\n\nNew room: 2',
        })
        expect(m.subject.length).toBeGreaterThan(0)
        expect(m.subject).not.toMatch(/[\r\n]/)
        for (const out of [m.subject, m.html, m.text]) expect(out, 'unfilled placeholder').not.toMatch(/\{\w+\}/)
        expect(m.html).toContain(`lang="${locale}"`)
        expect(m.text).toContain('Yoga Club')
      })
    }
  }
})

describe('render details', () => {
  it('sessions are shown as European date + 24-hour time in the site zone', () => {
    const m = renderReservationEmail({ ...base, locale: 'it' })
    expect(m.text).toContain('18:30') // 17:30Z = 18:30 CET
    expect(m.text).toMatch(/12 novembre 2026/)
    expect(m.text).not.toMatch(/\b(AM|PM)\b/i)
    expect(formatTime('2026-07-01T13:05:00Z', 'en', 'Europe/Rome')).toBe('15:05')
    expect(formatDateTime('2026-11-12T17:30:00Z', 'en', 'Europe/Rome')).toMatch(/12 November 2026, 18:30/)
  })
  it('a session with its own zone beats the site zone', () => {
    const m = renderReservationEmail({ ...base, sessions: [{ startsAt: '2026-11-12T17:30:00Z', timeZone: 'Europe/London' }] })
    expect(m.text).toContain('17:30')
  })
  it('amount is EUR formatted for the language', () => {
    expect(formatAmount(12500, 'it').replace(/\s/g, ' ')).toBe('125,00 €')
    expect(formatAmount(12500, 'en')).toBe('€125.00')
    expect(renderReservationEmail({ ...base, locale: 'de' }).text).toMatch(/125,00/)
  })
  it('free bookings show no amount', () => {
    expect(renderReservationEmail({ ...base, totalCents: 0 }).text).not.toContain('€')
  })
  it('payment block, deadline and bank details only on awaiting_payment', () => {
    const awaiting = renderReservationEmail({ ...base, intent: 'booking.awaiting_payment', holdExpiresAt: '2026-11-10T21:59:00Z', paymentInstructions: 'Use the reference', bankDetails: 'IBAN IT00 X' })
    expect(awaiting.text).toContain('IBAN IT00 X')
    expect(awaiting.text).toContain('Use the reference')
    expect(awaiting.text).toContain('10 November 2026, 22:59')
    const confirmed = renderReservationEmail({ ...base, paymentInstructions: 'Use the reference', bankDetails: 'IBAN IT00 X' })
    expect(confirmed.text).not.toContain('IBAN')
  })
  it('management and My-pass links are rendered; several passes are numbered', () => {
    const m = renderReservationEmail({ ...base, manageUrl: 'https://www.x.it/en/booking/abc', passLinks: [{ url: 'https://www.x.it/en/my-pass/1' }, { url: 'https://www.x.it/en/my-pass/2' }] })
    expect(m.text).toContain('https://www.x.it/en/booking/abc')
    expect(m.text).toContain('Open My pass 2: https://www.x.it/en/my-pass/2')
    expect(m.html).toContain('href="https://www.x.it/en/my-pass/1"')
  })
  it('escapes site name, name, reference, tenant texts and change-notice text; no markup can be injected', () => {
    const evil = '<script>alert(1)</script>'
    const m = renderReservationEmail({
      ...base, intent: 'booking.awaiting_payment', siteName: `Club ${evil}`, firstName: evil, reference: evil,
      paymentInstructions: evil, bankDetails: evil, manageUrl: 'https://x.it/"><script>',
    })
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;')
    const n = renderReservationEmail({ ...base, intent: 'change.notice', customSubject: `Hi ${evil}`, customBody: `${evil}\n\nline2` })
    expect(n.html).not.toContain('<script>')
  })
  it('subject cannot carry a line break (header injection)', () => {
    const m = renderReservationEmail({ ...base, siteName: 'A\r\nBcc: x@y.z' })
    expect(m.subject).not.toMatch(/[\r\n]/)
  })
  it('change.notice uses the tenant subject and body, in the booking language wrapper', () => {
    const m = renderReservationEmail({ ...base, locale: 'fr', intent: 'change.notice', customSubject: 'Salle modifiée', customBody: 'Bonjour Anna\n\nNouvelle salle' })
    expect(m.subject).toBe('Salle modifiée')
    expect(m.html).toContain('Nouvelle salle')
    expect(m.text).toContain('Vous recevez cet e-mail')
  })
  it('logo only over https; test banner marks redirected mail', () => {
    expect(renderReservationEmail({ ...base, logoUrl: 'javascript:alert(1)' }).html).not.toContain('<img')
    expect(renderReservationEmail({ ...base, logoUrl: 'https://cdn.x.it/l.png' }).html).toContain('<img')
    const t = renderReservationEmail({ ...base, testBanner: true })
    expect(t.subject.startsWith('[TEST]')).toBe(true)
    expect(t.text).toContain(DICTIONARIES.en.testBanner)
  })
})

describe('language choice and fallbacks (D16.13)', () => {
  it('booking language, else site default, else English; region tags use the base', () => {
    expect(chooseEmailLocale({ bookingLocale: 'de', siteDefaultLocale: 'it' })).toBe('de')
    expect(chooseEmailLocale({ bookingLocale: 'pt-BR', siteDefaultLocale: 'it' })).toBe('pt')
    expect(chooseEmailLocale({ bookingLocale: 'ja', siteDefaultLocale: 'it' })).toBe('it')
    expect(chooseEmailLocale({ bookingLocale: 'ja', siteDefaultLocale: 'ko' })).toBe('en')
    expect(chooseEmailLocale({})).toBe('en')
    expect(chooseEmailLocale({ bookingLocale: '__proto__' })).toBe('en')
  })
  it('tenant-written texts: email language → site default → English → any', () => {
    const v = { en: 'EN', it: 'IT', de: '  ' }
    expect(pickLocalized(v, 'it', 'en')).toBe('IT')
    expect(pickLocalized(v, 'de', 'it')).toBe('IT')
    expect(pickLocalized(v, 'fr', 'es')).toBe('EN')
    expect(pickLocalized({ ja: 'JA' }, 'fr', 'es')).toBe('JA')
    expect(pickLocalized('plain', 'fr')).toBe('plain')
    expect(pickLocalized(null, 'fr')).toBeNull()
  })
})
