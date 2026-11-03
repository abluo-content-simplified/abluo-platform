import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PersonByline } from '@/components/people/PersonByline'
import { PersonContacts } from '@/components/people/PersonContacts'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { PersonProfile } from '@/components/people/PersonProfile'
import { buildPersonSchema } from '@/components/people/PersonJsonLd'
import { contactLink, decodeEmail, encodeEmail } from '@/components/people/contacts'
import { buildArticleSchema } from '@/components/JsonLd'
import { getPeopleMessages, PEOPLE_MESSAGES_FOR_TEST } from '@/lib/i18n/people-messages'
import type { PersonPublic } from '@/lib/modules/people/projection'

const person = (over: Partial<PersonPublic> & { publicId: string }): PersonPublic => ({
  firstName: 'Anna', lastName: 'Rossi', visibility: 'listed', archived: false, hasPage: false, slug: {}, ...over,
})
const links = { siteBase: '/en/studio', segment: 'team' }

describe('PersonByline', () => {
  it('first author is main; the others follow with the language\'s "and"', () => {
    const people = [person({ publicId: 'a' }), person({ publicId: 'b', firstName: 'Marco', lastName: 'Bianchi' }), person({ publicId: 'c', firstName: 'Luca', lastName: 'Neri' })]
    const en = renderToStaticMarkup(<PersonByline people={people} locale="en" variant="post" />)
    expect(en).toMatch(/Anna Rossi.*Marco Bianchi.*and.*Luca Neri/)
    expect(en.indexOf('Anna Rossi')).toBeLessThan(en.indexOf('Marco Bianchi'))
    const it = renderToStaticMarkup(<PersonByline people={people.slice(0, 2)} locale="it" variant="post" />)
    expect(it).toContain(' e ')
    const de = renderToStaticMarkup(<PersonByline people={people.slice(0, 2)} locale="de" variant="post" />)
    expect(de).toContain(' und ')
  })

  it('a single author shows the job title; several do not', () => {
    const one = renderToStaticMarkup(<PersonByline people={[person({ publicId: 'a', jobTitle: 'Dentist' })]} locale="en" variant="post" />)
    expect(one).toContain('Dentist')
    const two = renderToStaticMarkup(<PersonByline people={[person({ publicId: 'a', jobTitle: 'Dentist' }), person({ publicId: 'b' })]} locale="en" variant="post" />)
    expect(two).not.toContain('Dentist')
  })

  it('honorific prefixes the name; names link only with an own page', () => {
    const html = renderToStaticMarkup(
      <PersonByline
        people={[person({ publicId: 'a', honorific: 'Dr.', hasPage: true, slug: { current: 'anna-rossi' } }), person({ publicId: 'b', firstName: 'Marco', lastName: 'Bianchi' })]}
        locale="en"
        links={links}
      />,
    )
    expect(html).toContain('<a href="/en/studio/team/anna-rossi"')
    expect(html).toContain('Dr. Anna Rossi')
    expect(html).not.toMatch(/<a[^>]*>Marco Bianchi/)
  })

  it('inline variant carries the label; nobody renders nothing', () => {
    const html = renderToStaticMarkup(<PersonByline people={[person({ publicId: 'a' })]} locale="en" label="Hosted by" />)
    expect(html).toContain('Hosted by')
    expect(renderToStaticMarkup(<PersonByline people={[]} locale="en" />)).toBe('')
  })

  it('children (the date line) sit under the names in the post variant', () => {
    const html = renderToStaticMarkup(<PersonByline people={[person({ publicId: 'a' })]} locale="en" variant="post"><p>12 May</p></PersonByline>)
    expect(html.indexOf('Anna Rossi')).toBeLessThan(html.indexOf('12 May'))
  })
})

describe('PersonAvatar', () => {
  it('without a photo: initials on a design-system tint (no new colour)', () => {
    const html = renderToStaticMarkup(<PersonAvatar person={person({ publicId: 'a' })} />)
    expect(html).toContain('>AR<')
    expect(html).toContain('var(--color-primary)')
    expect(html).toContain('aria-hidden="true"')
  })
})

describe('email obfuscation', () => {
  const ADDRESS = 'anna.rossi@example.com'
  const contacts = [
    { _key: 'e', kind: 'email' as const, value: ADDRESS, label: 'Write to Anna' },
    { _key: 'w', kind: 'whatsapp' as const, value: '+39 333 123 4567' },
    { _key: 'p', kind: 'phone' as const, value: '+39 0544 123456' },
    { _key: 'i', kind: 'instagram' as const, value: '@anna.rossi' },
    { _key: 'l', kind: 'linkedin' as const, value: 'https://www.linkedin.com/in/anna-rossi' },
    { _key: 'u', kind: 'url' as const, value: 'https://anna.example.org/' },
  ]
  const html = renderToStaticMarkup(<PersonContacts contacts={contacts} locale="en" />)

  it('the raw address is NOT in the server HTML, nor is a mailto link', () => {
    expect(html).not.toContain(ADDRESS)
    expect(html).not.toContain('anna.rossi@')
    expect(html).not.toContain('@example.com')
    expect(html).not.toContain('mailto:')
    expect(html).toContain('Write to Anna')
    expect(html).toContain('data-obfuscated-email')
  })

  it('the encoded value round-trips in the browser', () => {
    expect(decodeEmail(encodeEmail(ADDRESS))).toBe(ADDRESS)
    expect(encodeEmail(ADDRESS)).not.toContain('@')
    expect(decodeEmail('!!not base64!!')).toBeNull()
    expect(decodeEmail(btoa('no at sign'))).toBeNull()
  })

  it('WhatsApp opens click-to-chat on digits only; phone is tel:', () => {
    expect(html).toContain('href="https://wa.me/393331234567"')
    expect(html).toContain('href="tel:+390544123456"')
  })

  it('social and website links are outbound with rel noopener', () => {
    expect(html).toContain('href="https://www.instagram.com/anna.rossi/"')
    expect(html).toContain('href="https://www.linkedin.com/in/anna-rossi"')
    expect(html).toContain('href="https://anna.example.org/"')
    expect(html.match(/rel="noopener noreferrer"/g)!.length).toBeGreaterThanOrEqual(4)
  })

  it('unsafe or malformed values are dropped', () => {
    const msg = getPeopleMessages('en')
    const c = (kind: string, value: string) => contactLink({ _key: 'k', kind: kind as Parameters<typeof contactLink>[0]['kind'], value }, msg)
    expect(c('url', 'javascript:alert(1)')).toBeNull()
    expect(c('website', 'ftp://x.org')).toBeNull()
    expect(c('email', 'not-an-email')).toBeNull()
    expect(c('whatsapp', 'abc')).toBeNull()
    expect(c('instagram', 'bad handle!')).toBeNull()
  })

  it('preferred contacts come first', () => {
    const out = renderToStaticMarkup(
      <PersonContacts locale="en" contacts={[{ _key: 'a', kind: 'phone', value: '+39 111 22 33' }, { _key: 'b', kind: 'phone', value: '+39 999 88 77', preferred: true }]} />,
    )
    expect(out.indexOf('999')).toBeLessThan(out.indexOf('111'))
  })
})

describe('PersonProfile', () => {
  const full = person({
    publicId: 'a', honorific: 'Dr.', jobTitle: 'Psychotherapist', groups: ['psy'],
    bio: [{ _type: 'block', _key: 'b1', style: 'normal', children: [{ _type: 'span', _key: 's1', text: 'A long bio paragraph.', marks: [] }], markDefs: [] }] as never,
    languages: ['it', 'en'], website: 'https://anna.example.org/',
    qualifications: [{ _key: 'q', title: 'Master in Psychotherapy', issuer: 'University of Milan', issuedOn: '2012-06-01', expiresOn: '2030-01-01' }],
    contacts: [{ _key: 'e', kind: 'email', value: 'anna@example.com' }],
  })
  const html = renderToStaticMarkup(<PersonProfile person={full} locale="en" siteBase="/en/studio" projectSlug="studio" groups={['Psychotherapist group']} />)

  it('shows name with honorific, title, group, bio, languages, qualifications', () => {
    expect(html).toContain('Dr. Anna Rossi')
    expect(html).toContain('Psychotherapist')
    expect(html).toContain('Psychotherapist group')
    expect(html).toContain('A long bio paragraph.')
    expect(html).toContain('Italian, English')
    expect(html).toContain('Master in Psychotherapy')
    expect(html).toContain('University of Milan, 2012')
    expect(html).toContain('valid until 2030')
  })
  it('never exposes the e-mail address', () => {
    expect(html).not.toContain('anna@example.com')
    expect(html).not.toContain('mailto:')
  })
  it('falls back to the short bio, and to initials without a photo', () => {
    const h = renderToStaticMarkup(<PersonProfile person={person({ publicId: 'z', shortBio: 'Short only.' })} locale="it" siteBase="/it" projectSlug="studio" />)
    expect(h).toContain('Short only.')
    expect(h).toContain('AR')
  })
})

describe('Person JSON-LD', () => {
  const p = person({ publicId: 'a', honorific: 'Dr.', jobTitle: 'Psychotherapist', shortBio: 'Bio.', languages: ['it'], website: 'https://anna.example.org/', contacts: [{ _key: 'e', kind: 'email', value: 'anna@example.com' }, { _key: 'l', kind: 'linkedin', value: 'annarossi' }] })
  it('describes the person at the profile URL without e-mail', () => {
    const s = buildPersonSchema({ origin: 'https://www.example.it', locale: 'en', pathSegments: ['team', 'anna-rossi'], person: p })!
    expect(s['@type']).toBe('Person')
    expect(s.url).toBe('https://www.example.it/en/team/anna-rossi')
    expect(s.name).toBe('Anna Rossi')
    expect(s.honorificPrefix).toBe('Dr.')
    expect(s.jobTitle).toBe('Psychotherapist')
    expect(s.sameAs).toEqual(['https://anna.example.org/', 'https://www.linkedin.com/in/annarossi/'])
    expect(JSON.stringify(s)).not.toContain('anna@example.com')
  })
  it('emits nothing without a canonical origin', () => {
    expect(buildPersonSchema({ origin: null, locale: 'en', pathSegments: ['team', 'a'], person: p })).toBeNull()
  })
})

describe('Article JSON-LD authors', () => {
  const base = { origin: 'https://www.example.it', locale: 'en', pathSegments: ['blog', 'x'], headline: 'H' }
  it('a People author is a Person with the profile url', () => {
    const s = buildArticleSchema({ ...base, authors: [{ name: 'Anna Rossi', url: 'https://www.example.it/en/team/anna-rossi' }] })!
    expect(s.author).toEqual({ '@type': 'Person', name: 'Anna Rossi', url: 'https://www.example.it/en/team/anna-rossi' })
  })
  it('several authors: main first, as an array', () => {
    const s = buildArticleSchema({ ...base, authors: [{ name: 'A' }, { name: 'B' }] })!
    expect(s.author).toEqual([{ '@type': 'Person', name: 'A' }, { '@type': 'Person', name: 'B' }])
  })
  it('no authors: the legacy authorName as before', () => {
    expect(buildArticleSchema({ ...base, authorName: 'Old' })!.author).toEqual({ '@type': 'Person', name: 'Old' })
    expect(buildArticleSchema({ ...base, authors: [], authorName: 'Old' })!.author).toEqual({ '@type': 'Person', name: 'Old' })
  })
})

describe('people messages', () => {
  it('every locale carries every key', () => {
    const keys = Object.keys(PEOPLE_MESSAGES_FOR_TEST.en).sort()
    for (const [loc, m] of Object.entries(PEOPLE_MESSAGES_FOR_TEST)) expect(Object.keys(m).sort(), loc).toEqual(keys)
  })
})
