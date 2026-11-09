import { describe, expect, it } from 'vitest'
import {
  DIGITAL_CARD_PERMISSIONS,
  DIGITAL_CARDS_MODULE_ID,
  DIGITAL_CARD_TYPE,
  buildVCard,
  cardPath,
  decodeContact,
  defaultShow,
  encodeContact,
  escapeVCardText,
  isValidUrlName,
  normalizeSource,
  primaryLinkCount,
  qrTarget,
  resolveShow,
  slugifyUrlName,
  suggestUrlName,
  taggedLink,
  takenUrlNames,
} from '../model'

describe('identifiers (CONTRACTS.md)', () => {
  it('uses the contract names', () => {
    expect(DIGITAL_CARDS_MODULE_ID).toBe('digital-cards')
    expect(DIGITAL_CARD_TYPE).toBe('digitalCard')
    expect(DIGITAL_CARD_PERMISSIONS).toEqual({
      read: 'digital-cards.read',
      write: 'digital-cards.write',
      delete: 'digital-cards.delete',
      statsRead: 'digital-cards.stats.read',
    })
  })
})

describe('URL names (D5)', () => {
  it('slugifies full names, accents and specials included', () => {
    expect(slugifyUrlName('Sofia Rossi')).toBe('sofia-rossi')
    expect(slugifyUrlName('  Sofía  Rossi-Bianchi ')).toBe('sofia-rossi-bianchi')
    expect(slugifyUrlName("Anne-Marie D'Arco")).toBe('anne-marie-darco')
    expect(slugifyUrlName('Jürgen Groß')).toBe('jurgen-gross')
    expect(slugifyUrlName('Søren Kierkegaard')).toBe('soren-kierkegaard')
    expect(slugifyUrlName('!!!')).toBe('')
    expect(slugifyUrlName('a'.repeat(80)).length).toBe(60)
  })

  it('validates the pattern and the length', () => {
    expect(isValidUrlName('sofia-rossi')).toBe(true)
    expect(isValidUrlName('sofia-rossi-2')).toBe(true)
    for (const bad of ['', 'Sofia', 'sofia--rossi', '-sofia', 'sofia-', 'sofia rossi', 'sofia.rossi', 'a'.repeat(61), null, 3]) expect(isValidUrlName(bad), String(bad)).toBe(false)
  })

  it('two people called Sofia Rossi get sofia-rossi and sofia-rossi-2, then -3', () => {
    const first = suggestUrlName('Sofia Rossi', null, new Set())
    expect(first).toBe('sofia-rossi')
    const second = suggestUrlName('Sofia Rossi', null, new Set([first]))
    expect(second).toBe('sofia-rossi-2')
    expect(suggestUrlName('Sofia Rossi', undefined, new Set([first, second]))).toBe('sofia-rossi-3')
  })

  it('reuses the People slug when it is free, else falls back to the name', () => {
    expect(suggestUrlName('Sofia Rossi', 'sofia', new Set())).toBe('sofia')
    expect(suggestUrlName('Sofia Rossi', 'sofia', new Set(['sofia']))).toBe('sofia-rossi')
    expect(suggestUrlName('Sofia Rossi', 'Not A Slug', new Set())).toBe('sofia-rossi')
    expect(suggestUrlName('', 'sofia', new Set(['sofia']))).toBe('sofia-2')
    expect(suggestUrlName('', null, new Set())).toBe('card')
  })

  it('keeps a numbered name within 60 characters', () => {
    const long = 'a'.repeat(60)
    const s = suggestUrlName(long, null, new Set([long]))
    expect(s.length).toBeLessThanOrEqual(60)
    expect(s.endsWith('-2')).toBe(true)
    expect(isValidUrlName(s)).toBe(true)
  })

  it('counts retired names as taken, and leaves out the card itself (and its draft)', () => {
    const cards = [
      { _id: 'a', urlName: 'sofia-rossi', retiredUrlNames: ['sofia'] },
      { _id: 'drafts.b', urlName: 'marco', retiredUrlNames: null },
      { _id: 'b', urlName: 'marco-b' },
    ]
    const taken = takenUrlNames(cards)
    expect([...taken].sort()).toEqual(['marco', 'marco-b', 'sofia', 'sofia-rossi'])
    expect(suggestUrlName('Sofia', 'sofia', taken)).toBe('sofia-2')
    expect([...takenUrlNames(cards, 'b')].sort()).toEqual(['sofia', 'sofia-rossi'])
    expect([...takenUrlNames(cards, 'drafts.a')].sort()).toEqual(['marco', 'marco-b'])
  })
})

describe("What's shown (D7)", () => {
  it('site card: everything on, all socials and locations', () => {
    expect(defaultShow('site', { socials: ['instagram', 'facebook'], locations: ['k1', 'k2'] })).toEqual({
      name: true,
      description: true,
      phone: true,
      email: true,
      whatsapp: true,
      saveContact: true,
      socials: ['instagram', 'facebook'],
      logo: true,
      businessName: true,
      locations: ['k1', 'k2'],
    })
  })

  it('person card: photo, name, role on; phone, email, WhatsApp, Save contact off', () => {
    const show = defaultShow('person')
    expect(show).toMatchObject({ photo: true, name: true, role: true, nameMode: 'full', businessName: true, profileLink: true })
    expect(show).toMatchObject({ phone: false, email: false, whatsapp: false, saveContact: false, socials: [] })
  })

  it('resolveShow keeps stored switches and fills the rest with defaults', () => {
    expect(resolveShow('person', null)).toEqual(defaultShow('person'))
    const s = resolveShow('person', { phone: true, nameMode: 'first', socials: ['c1', 3], photo: 'yes' })
    expect(s).toMatchObject({ phone: true, nameMode: 'first', socials: ['c1'], photo: true })
    expect(resolveShow('person', { nameMode: 'nick' }).nameMode).toBe('full')
    expect(resolveShow('site', { locations: [] }, { locations: ['k1'] }).locations).toEqual([])
    expect(resolveShow('site', {}, { locations: ['k1'] }).locations).toEqual(['k1'])
  })
})

describe('links (D8)', () => {
  it('counts only shown primary links', () => {
    expect(primaryLinkCount([{ primary: true }, { primary: true, hidden: true }, {}])).toBe(1)
    expect(primaryLinkCount([{ primary: true }, { primary: true }])).toBe(2)
    expect(primaryLinkCount(null)).toBe(0)
  })
})

describe('contact encoding (D9)', () => {
  const samples = ['sofia.rossi@example.com', '+39 335 1234567', '0039-335-1234567', 'jürgen@groß.de', '']

  it('round-trips', () => {
    for (const v of samples) expect(decodeContact(encodeContact(v))).toBe(v)
  })

  it('never contains an @, a dot or any digit', () => {
    for (const v of samples) {
      const enc = encodeContact(v)
      expect(enc).not.toContain('@')
      expect(enc).not.toContain('.')
      expect(enc).not.toMatch(/\d/)
      expect(enc).toMatch(/^[a-p]*$/)
    }
  })

  it('is not the plain text in another case or reversed', () => {
    const enc = encodeContact('info@studio.it')
    expect(enc.toLowerCase()).not.toContain('info')
    expect(enc).not.toContain('studio')
  })

  it('decodes malformed input to an empty string', () => {
    expect(decodeContact('abc')).toBe('')
    expect(decodeContact('zz')).toBe('')
    expect(decodeContact(undefined as unknown as string)).toBe('')
  })
})

describe('vCard (D9)', () => {
  it('escapes per RFC 6350', () => {
    expect(escapeVCardText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })

  it('builds a 3.0 card with CRLF and no photo', () => {
    const v = buildVCard({
      firstName: 'Sofia',
      lastName: 'Rossi',
      org: 'Yoga, Club; Brussels',
      title: 'Teacher',
      phones: ['+39 335 1234567', ''],
      emails: ['sofia@example.com'],
      address: { street: 'Rue 1', postalCode: '1000', city: 'Bruxelles', country: 'BE' },
      urls: ['https://example.com/link/sofia-rossi'],
    })
    const lines = v.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCARD')
    expect(lines[1]).toBe('VERSION:3.0')
    expect(lines).toContain('FN:Sofia Rossi')
    expect(lines).toContain('N:Rossi;Sofia;;;')
    expect(lines).toContain('ORG:Yoga\\, Club\\; Brussels')
    expect(lines).toContain('TITLE:Teacher')
    expect(lines).toContain('TEL;TYPE=VOICE:+39 335 1234567')
    expect(lines.filter((l) => l.startsWith('TEL'))).toHaveLength(1)
    expect(lines).toContain('EMAIL;TYPE=INTERNET:sofia@example.com')
    expect(lines).toContain('ADR;TYPE=WORK:;;Rue 1;Bruxelles;;1000;BE')
    expect(lines).toContain('URL:https://example.com/link/sofia-rossi')
    expect(v).not.toContain('PHOTO')
    expect(v.endsWith('END:VCARD\r\n')).toBe(true)
  })

  it('falls back to the organisation for a site card', () => {
    const v = buildVCard({ org: 'Studio Martegani' })
    expect(v).toContain('FN:Studio Martegani\r\n')
    expect(v).toContain('ORG:Studio Martegani\r\n')
  })

  it('folds long lines at 75 octets', () => {
    const v = buildVCard({ fullName: 'x', urls: [`https://example.com/${'a'.repeat(200)}`] })
    for (const line of v.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(v.replace(/\r\n /g, '')).toContain(`URL:https://example.com/${'a'.repeat(200)}`)
  })
})

describe('sources (D11)', () => {
  it('takes an allow-listed ?src= first', () => {
    expect(normalizeSource('qr', 'instagram.com')).toBe('qr')
    expect(normalizeSource(' Print ', null)).toBe('print')
    expect(normalizeSource('flyer-2026', null)).toBe('flyer-2026')
  })

  it('ignores a malformed tag and falls back to the referrer', () => {
    expect(normalizeSource('<script>', 'l.instagram.com')).toBe('instagram')
    expect(normalizeSource('a'.repeat(33), 'www.linkedin.com')).toBe('linkedin')
    expect(normalizeSource('my tag', 'lm.facebook.com')).toBe('facebook')
  })

  it('maps known referrers, else direct', () => {
    expect(normalizeSource(null, 'www.google.it')).toBe('google')
    expect(normalizeSource(null, 'google.co.uk')).toBe('google')
    expect(normalizeSource(null, 'wa.me')).toBe('whatsapp')
    expect(normalizeSource(null, 't.co')).toBe('x')
    expect(normalizeSource(null, 'www.youtube.com:443')).toBe('youtube')
    expect(normalizeSource(null, 'evil-google.com.example')).toBe('direct')
    expect(normalizeSource(null, 'notinstagram.com')).toBe('direct')
    expect(normalizeSource(undefined, undefined)).toBe('direct')
    expect(normalizeSource('', '')).toBe('direct')
  })
})

describe('paths and QR (D5, D12)', () => {
  it('cardPath', () => {
    expect(cardPath('site')).toBe('/link')
    expect(cardPath('person', 'sofia-rossi')).toBe('/link/sofia-rossi')
    expect(cardPath('person', 'Bad Name')).toBe('/link')
  })

  it('qrTarget and tagged links', () => {
    expect(qrTarget('https://www.cyce.info/', '/link/sofia-rossi')).toBe('https://www.cyce.info/link/sofia-rossi?src=qr')
    expect(qrTarget('https://www.cyce.info', 'link')).toBe('https://www.cyce.info/link?src=qr')
    expect(taggedLink('https://www.cyce.info', '/link', 'instagram')).toBe('https://www.cyce.info/link?src=instagram')
    expect(taggedLink('https://www.cyce.info', '/link', 'Bad Tag')).toBe('https://www.cyce.info/link?src=direct')
  })
})
