import { describe, it, expect, vi } from 'vitest'
import {
  cardShareMeta,
  createFixedWindowLimiter,
  isBotUserAgent,
  linkView,
  linkViews,
  loadPersonCard,
  loadSiteCard,
  personCardOutcome,
  personCardView,
  personVCardInput,
  siteCardOutcome,
  siteCardView,
  siteVCardInput,
  vcardDecision,
  vcardFileName,
  withSource,
  type CardFetch,
} from '../website'
import { buildVCard, decodeContact } from '../model'
import {
  DIGITAL_CARD_BY_RETIRED_NAME_QUERY,
  DIGITAL_CARD_PERSON_QUERY,
  DIGITAL_CARD_ROUTE_STATE_QUERY,
  DIGITAL_CARD_SITE_QUERY,
} from '../queries'
import type { DigitalCardPersonResult, DigitalCardSiteResult } from '../projection'
import type { PersonPublic } from '@/lib/modules/people/projection'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'

const messages = getDigitalCardSiteMessages('en')
const ctx = { locale: 'en', siteBase: '/en', messages }
const img = (ref: string) => ({ asset: { _ref: ref, _type: 'reference' }, hotspot: { x: 0.3, y: 0.2, width: 1, height: 1 } }) as never

const site = (over: Partial<DigitalCardSiteResult> = {}): DigitalCardSiteResult => ({
  publicId: 'card-site-1',
  kind: 'site',
  description: null,
  links: [
    { _key: 'k1', kind: 'url', label: 'Shop', primary: false, url: 'https://shop.example.com' },
    { _key: 'k2', kind: 'phone', label: null, primary: true, value: '+39 0332 123 456' },
    { _key: 'k3', kind: 'booking', label: null, primary: false, page: { pageType: 'landing', slug: 'prenota', title: 'Prenota' } },
    { _key: 'k4', kind: 'url', label: 'Bad', primary: false, url: 'javascript:alert(1)' },
  ],
  background: img('image-bg-1'),
  show: null,
  site: {
    siteName: 'Studio Rossi',
    tagline: 'Calm care',
    logo: img('image-logo-1'),
    phone: '+39 0332 123 456',
    email: 'info@studio.example',
    whatsappNumber: '+39 333 1234567',
    socialLinks: [
      { _key: 's1', platform: 'instagram', url: 'https://instagram.com/studio' },
      { _key: 's2', platform: 'facebook', url: 'https://facebook.com/studio' },
    ],
    locations: [
      { _key: 'l1', name: 'Varese', address: { street: 'Via Roma 1', postalCode: '21100', city: 'Varese', country: 'Italia' }, mapsUrl: 'https://maps.google.com/?q=x' },
      { _key: 'l2', name: 'Milano', address: { street: 'Via Po 2', city: 'Milano' } },
    ],
  },
  project: { customDomain: 'studio.example', enabledModules: ['digital-cards'] },
  ...over,
})

const person = (over: Partial<PersonPublic> = {}): PersonPublic =>
  ({
    publicId: 'p1',
    firstName: 'Sofia',
    lastName: 'Rossi',
    jobTitle: 'Yoga teacher',
    shortBio: 'Teaches hatha.',
    photo: img('image-photo-1'),
    contacts: [
      { _key: 'c1', kind: 'email', value: 'sofia@studio.example' },
      { _key: 'c2', kind: 'phone', value: '+41 79 123 45 67' },
      { _key: 'c3', kind: 'instagram', value: '@sofia.yoga' },
      { _key: 'c4', kind: 'website', value: 'https://sofia.example' },
    ],
    visibility: 'page',
    archived: false,
    hasPage: true,
    slug: { current: 'sofia-rossi' },
    ...over,
  }) as PersonPublic

const personCard = (over: Partial<DigitalCardPersonResult> = {}): DigitalCardPersonResult & { person: PersonPublic } =>
  ({
    publicId: 'card-p-1',
    kind: 'person',
    urlName: 'sofia-rossi',
    links: [],
    background: null,
    show: null,
    person: person(),
    siteCard: { background: img('image-bg-site') },
    site: { siteName: 'Studio Rossi' },
    project: { customDomain: 'studio.example', enabledModules: ['digital-cards', 'people'], peopleProfileSegment: { en: 'team', it: 'chi-siamo' } },
    ...over,
  }) as DigitalCardPersonResult & { person: PersonPublic }

describe('route outcomes (D6)', () => {
  it('site card: module off → 404; live → render; offline → homepage; none → 404', () => {
    const card = site()
    expect(siteCardOutcome({ moduleOn: false, card, state: null, siteBase: '/it' }).kind).toBe('not-found')
    expect(siteCardOutcome({ moduleOn: true, card, state: null, siteBase: '/it' })).toEqual({ kind: 'render', card })
    expect(siteCardOutcome({ moduleOn: true, card: null, state: { kind: 'site', live: false }, siteBase: '/it/hoffmann' })).toEqual({
      kind: 'redirect',
      to: '/it/hoffmann',
      permanent: false,
    })
    expect(siteCardOutcome({ moduleOn: true, card: null, state: null, siteBase: '/it' }).kind).toBe('not-found')
  })

  it('person card: render, person offline → /link, retired name → 308, offline card → /link, else 404', () => {
    const base = { moduleOn: true, urlName: 'sofia', retired: null, state: null, siteBase: '/en/cyce' }
    expect(personCardOutcome({ ...base, card: personCard() }).kind).toBe('render')
    expect(personCardOutcome({ ...base, card: personCard({ person: null }) })).toEqual({ kind: 'redirect', to: '/en/cyce/link', permanent: false })
    expect(personCardOutcome({ ...base, card: null, retired: { urlName: 'sofia-rossi' } })).toEqual({
      kind: 'redirect',
      to: '/en/cyce/link/sofia-rossi',
      permanent: true,
    })
    expect(personCardOutcome({ ...base, card: null, state: { kind: 'person', urlName: 'sofia', live: false } })).toEqual({
      kind: 'redirect',
      to: '/en/cyce/link',
      permanent: false,
    })
    expect(personCardOutcome({ ...base, card: null }).kind).toBe('not-found')
    expect(personCardOutcome({ ...base, urlName: 'Not_Valid', card: personCard() }).kind).toBe('not-found')
    expect(personCardOutcome({ ...base, moduleOn: false, card: personCard() }).kind).toBe('not-found')
  })

  it('keeps an allow-listed ?src= across a redirect only', () => {
    expect(withSource('/en/link', 'qr')).toBe('/en/link?src=qr')
    expect(withSource('/en/link', 'QR')).toBe('/en/link?src=qr')
    expect(withSource('/en/link', '<script>')).toBe('/en/link')
    expect(withSource('/en/link', ['qr', 'x'])).toBe('/en/link')
  })

  it('loaders read only what the decision needs, in the queries.ts order', async () => {
    const calls: string[] = []
    const fake = (answers: Map<string, unknown>): CardFetch =>
      (async (q: string) => {
        calls.push(q)
        return answers.get(q) ?? null
      }) as CardFetch
    const p = { locale: 'en', defaultLocale: 'en', enabledModuleIds: ['digital-cards'], siteBase: '/en' }

    expect((await loadSiteCard(fake(new Map([[DIGITAL_CARD_SITE_QUERY, site()]])), p)).kind).toBe('render')
    expect(calls).toEqual([DIGITAL_CARD_SITE_QUERY])

    calls.length = 0
    const out = await loadPersonCard(fake(new Map([[DIGITAL_CARD_BY_RETIRED_NAME_QUERY, { urlName: 'sofia-rossi' }]])), { ...p, urlName: 'sofia' })
    expect(out).toEqual({ kind: 'redirect', to: '/en/link/sofia-rossi', permanent: true })
    expect(calls).toEqual([DIGITAL_CARD_PERSON_QUERY, DIGITAL_CARD_BY_RETIRED_NAME_QUERY])

    calls.length = 0
    expect((await loadPersonCard(fake(new Map()), { ...p, urlName: 'nobody' })).kind).toBe('not-found')
    expect(calls).toEqual([DIGITAL_CARD_PERSON_QUERY, DIGITAL_CARD_BY_RETIRED_NAME_QUERY, DIGITAL_CARD_ROUTE_STATE_QUERY])

    const none = vi.fn()
    expect((await loadSiteCard(none as unknown as CardFetch, { ...p, enabledModuleIds: ['people'] })).kind).toBe('not-found')
    expect((await loadSiteCard(none as unknown as CardFetch, { ...p, enabledModuleIds: null })).kind).toBe('not-found')
    expect(none).not.toHaveBeenCalled()
  })
})

describe('site card view (D7, D8, D9)', () => {
  it('shows everything that exists by default, never a plain contact', () => {
    const view = siteCardView(site(), ctx)
    expect(view.name).toBe('Studio Rossi')
    expect(view.description).toBe('Calm care')
    expect(view.logo?.dark.alt).toBe('Studio Rossi')
    expect(view.contacts.map((c) => c.kind)).toEqual(['phone', 'email', 'whatsapp'])
    expect(view.socials.map((s) => s.icon)).toEqual(['instagram', 'facebook'])
    expect(view.locations.map((l) => l.key)).toEqual(['l1', 'l2'])
    expect(view.saveContactHref).toBe('/en/link/contact.vcf')
    // D9: nothing scrapeable in what reaches the HTML
    const html = JSON.stringify(view)
    expect(html).not.toContain('@studio.example')
    expect(html).not.toMatch(/0332|1234567|tel:|mailto:/)
    expect(decodeContact(view.contacts[1].textEnc)).toBe('info@studio.example')
    expect(decodeContact(view.contacts[1].hrefEnc)).toBe('mailto:info@studio.example')
    expect(decodeContact(view.contacts[2].hrefEnc)).toBe('https://wa.me/393331234567')
  })

  it('follows the switches', () => {
    const view = siteCardView(site({ show: { phone: false, email: false, logo: false, hiddenSocials: ['instagram'], locations: ['l2'], saveContact: false } }), ctx)
    expect(view.contacts.map((c) => c.kind)).toEqual(['whatsapp'])
    expect(view.logo).toBeNull()
    expect(view.socials.map((s) => s.icon)).toEqual(['facebook'])
    expect(view.locations.map((l) => l.key)).toEqual(['l2'])
    expect(view.saveContactHref).toBeNull()
  })

  it('links: one primary apart, contacts encoded, unsafe and module-less targets dropped', () => {
    const view = siteCardView(site(), ctx)
    expect(view.primary?.key).toBe('k2')
    expect(view.primary?.label).toBe('Call')
    expect(view.primary?.href).toBeUndefined()
    expect(decodeContact(view.primary!.hrefEnc!)).toBe('tel:+390332123456')
    // booking needs Reservations; javascript: never renders
    expect(view.links.map((l) => l.key)).toEqual(['k1'])
    const withReservations = linkViews(site().links, { ...ctx, enabledModules: ['reservations'] })
    expect(withReservations.links.find((l) => l.key === 'k3')).toMatchObject({ href: '/en/prenota', label: 'Book now', external: false })
  })

  it('a link one-liner is passed through trimmed, empty means none, and never reaches the vCard', () => {
    const links = [
      { _key: 'k1', kind: 'url' as const, label: 'Shop', description: '  Orari   e prezzi ', primary: false, url: 'https://shop.example.com' },
      { _key: 'k2', kind: 'url' as const, label: 'Blog', description: '', primary: false, url: 'https://blog.example.com' },
    ]
    const v = linkViews(links, { ...ctx, enabledModules: [] })
    expect(v.links[0]).toMatchObject({ key: 'k1', label: 'Shop', description: 'Orari e prezzi' })
    expect(v.links[1]).not.toHaveProperty('description')
    const card = site()
    card.links = links
    expect(buildVCard(siteVCardInput(card, 'https://www.studio.example'))).not.toContain('Orari')
  })

  it('share preview never carries contact data', () => {
    const share = cardShareMeta(siteCardView(site(), ctx), 'Studio Rossi', messages)
    expect(share.title).toBe('Studio Rossi')
    expect(share.description).toBe('Calm care')
    expect(JSON.stringify(share)).not.toMatch(/@|0332/)
  })
})

describe('person card view (D2, D7)', () => {
  it('defaults: photo, name, role and social profiles on; contacts and Save contact off', () => {
    const view = personCardView(personCard(), ctx)
    expect(view.name).toBe('Sofia Rossi')
    expect(view.role).toBe('Yoga teacher')
    expect(view.description).toBe('Teaches hatha.')
    expect(view.photo?.alt).toBe('Sofia Rossi')
    expect(view.contacts).toEqual([])
    expect(view.socials.map((x) => x.key)).toEqual(['c3', 'c4'])
    expect(view.saveContactHref).toBeNull()
    expect(view.business).toEqual({ name: 'Studio Rossi', href: '/en/link' })
    expect(view.profile).toEqual({ href: '/en/team/sofia-rossi', label: 'More about Sofia' })
    // inherits the site card's background (D4)
    expect((view.background as { asset: { _ref: string } }).asset._ref).toBe('image-bg-site')
  })

  it('switches on: contacts, socials, first name only, Save contact', () => {
    const view = personCardView(personCard({ show: { phone: true, email: true, nameMode: 'first', saveContact: true } }), ctx)
    expect(view.name).toBe('Sofia')
    expect(view.contacts.map((c) => c.kind)).toEqual(['phone', 'email'])
    expect(view.socials.map((s) => s.href)).toEqual(['https://www.instagram.com/sofia.yoga/', 'https://sofia.example'])
    expect(view.saveContactHref).toBe('/en/link/sofia-rossi/contact.vcf')
    expect(JSON.stringify(view)).not.toContain('sofia@studio.example')
  })

  it('no profile link without People, without a page or with the switch off; no business link without a live site card', () => {
    expect(personCardView(personCard({ project: { enabledModules: ['digital-cards'] } }), ctx).profile).toBeNull()
    expect(personCardView(personCard({ person: person({ hasPage: false }) }), ctx).profile).toBeNull()
    expect(personCardView(personCard({ show: { profileLink: false } }), ctx).profile).toBeNull()
    expect(personCardView(personCard({ siteCard: null }), ctx).business).toEqual({ name: 'Studio Rossi', href: null })
  })

  it('share preview: name · business, role, photo', () => {
    const share = cardShareMeta(personCardView(personCard(), ctx), 'Studio Rossi', messages)
    expect(share.title).toBe('Sofia Rossi · Studio Rossi')
    expect(share.description).toBe('Yoga teacher')
    expect((share.image as { asset: { _ref: string } }).asset._ref).toBe('image-photo-1')
  })
})

describe('vCard (D9)', () => {
  it('site: business, shown phone / email, FIRST shown location, website', () => {
    const input = siteVCardInput(site({ show: { locations: ['l2', 'l1'], email: false } }), 'https://www.studio.example')
    const v = buildVCard(input)
    expect(v).toContain('ORG:Studio Rossi')
    expect(v).toContain('TEL;TYPE=VOICE:+390332123456')
    expect(v).not.toContain('EMAIL')
    expect(v).toContain('ADR;TYPE=WORK:;;Via Po 2;Milano;;;')
    expect(v).toContain('URL:https://www.studio.example')
  })

  it('person: follows the switches (nothing private, first name only)', () => {
    const off = buildVCard(personVCardInput(personCard()))
    expect(off).not.toMatch(/TEL|EMAIL/)
    const on = buildVCard(personVCardInput(personCard({ show: { email: true, nameMode: 'first', role: false } })))
    expect(on).toContain('FN:Sofia')
    expect(on).toContain('N:;Sofia;;;')
    expect(on).toContain('EMAIL;TYPE=INTERNET:sofia@studio.example')
    expect(on).not.toContain('TITLE')
  })

  it('decision: bot 403 first, then 404 rules, then the rate limit', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    const ok = { userAgent: ua, moduleOn: true, saveContact: true, hasContent: true, withinRateLimit: true }
    expect(vcardDecision(ok).kind).toBe('serve')
    expect(vcardDecision({ ...ok, userAgent: 'Googlebot/2.1' }).kind).toBe('forbidden')
    expect(vcardDecision({ ...ok, userAgent: null }).kind).toBe('forbidden')
    expect(vcardDecision({ ...ok, saveContact: false }).kind).toBe('not-found')
    expect(vcardDecision({ ...ok, saveContact: null }).kind).toBe('not-found')
    expect(vcardDecision({ ...ok, hasContent: false }).kind).toBe('not-found')
    expect(vcardDecision({ ...ok, moduleOn: false }).kind).toBe('not-found')
    expect(vcardDecision({ ...ok, withinRateLimit: false }).kind).toBe('rate-limited')
  })

  it('file name is ASCII and never empty', () => {
    expect(vcardFileName('Sofía Rossi')).toBe('sofia-rossi.vcf')
    expect(vcardFileName('')).toBe('contact.vcf')
    expect(vcardFileName(null)).toBe('contact.vcf')
  })

  it('bots', () => {
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true)
    expect(isBotUserAgent('WhatsApp/2.23.20.0 A')).toBe(true)
    expect(isBotUserAgent('curl/8.4.0')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe(false)
  })
})

describe('fixed-window limiter (no IP)', () => {
  it('limits per key and resets each window', () => {
    const l = createFixedWindowLimiter({ limit: 2, windowMs: 1000 })
    expect([l.take('a', 0), l.take('a', 10), l.take('a', 20), l.take('b', 20)]).toEqual([true, true, false, true])
    expect(l.take('a', 1000)).toBe(true)
  })
  it('stays bounded', () => {
    const l = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 })
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(l.take(k, 0)).toBe(true)
  })
})

describe('Show QR code (Amendment A)', () => {
  it('encodes the card’s canonical address with ?src=qr', () => {
    expect(siteCardView(site(), ctx).qr).toEqual({ url: 'https://www.studio.example/link?src=qr', address: 'www.studio.example/link' })
    expect(personCardView(personCard(), ctx).qr).toEqual({ url: 'https://www.studio.example/link/sofia-rossi?src=qr', address: 'www.studio.example/link/sofia-rossi' })
  })

  it('is absent without a domain of its own (a preview host is never printed)', () => {
    expect(siteCardView(site({ project: { enabledModules: ['digital-cards'] } }), ctx).qr).toBeNull()
    expect(personCardView(personCard({ project: { customDomain: null, enabledModules: ['digital-cards'] } }), ctx).qr).toBeNull()
  })
})

describe('vCard follows hidden social profiles (Amendment A)', () => {
  it('a hidden website contact is not in the vCard; the others are', () => {
    const input = personVCardInput(personCard({ show: { saveContact: true, hiddenSocials: ['c3'] } }))
    expect(input.urls).toEqual(['https://sofia.example'])
  })
})

describe('link logo on its tile (Amendment A, 10)', () => {
  const lctx = { ...ctx, enabledModules: [] as string[] }
  const base = { _key: 'k9', kind: 'url' as const, label: 'Shop', primary: false, url: 'https://shop.example.com' }

  it('no logo → no logo in the view', () => {
    expect(linkView(base, lctx)).not.toHaveProperty('logo')
    expect(linkView({ ...base, logo: null }, lctx)).not.toHaveProperty('logo')
    expect(linkView({ ...base, logo: { asset: null, url: null } }, lctx)).not.toHaveProperty('logo')
  })

  it('a raster logo is requested 72 px high (3x), never cropped, width from its proportions capped at 48', () => {
    const wide = linkView({ ...base, logo: { asset: { _ref: 'image-abc123-400x100-png', _type: 'reference' }, url: 'https://cdn.sanity.io/images/p/d/abc123-400x100.png', mime: 'image/png', dimensions: { width: 400, height: 100 } } }, lctx)!
    expect(wide.logo?.src).toContain('h=72')
    expect(wide.logo?.src).toContain('fit=max')
    expect(wide.logo?.width).toBe(48)
    const square = linkView({ ...base, logo: { asset: { _ref: 'image-abc123-100x100-png', _type: 'reference' }, mime: 'image/png', dimensions: { width: 100, height: 100 } } }, lctx)!
    expect(square.logo?.width).toBe(24)
  })

  it('an SVG logo is served as stored', () => {
    const v = linkView({ ...base, logo: { asset: { _ref: 'image-svg1-80x20-svg', _type: 'reference' }, url: 'https://cdn.sanity.io/images/p/d/svg1-80x20.svg', mime: 'image/svg+xml', dimensions: { width: 80, height: 20 } } }, lctx)!
    expect(v.logo?.src).toBe('https://cdn.sanity.io/images/p/d/svg1-80x20.svg')
  })

  it('the view renders the tile only on links that have a logo, decorative, in the card background colour', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { DigitalCardView } = await import('@/components/digital-cards/DigitalCardView')
    const withLogo = linkView({ ...base, _key: 'with', logo: { asset: { _ref: 'image-abc123-100x100-png', _type: 'reference' }, mime: 'image/png', dimensions: { width: 100, height: 100 } } }, lctx)!
    const without = linkView({ ...base, _key: 'without', label: 'Plain' }, lctx)!
    const view = { ...siteCardView(site({ links: [], background: null, site: { ...site().site, logo: null } as never }), ctx), primary: null, links: [withLogo, without] }
    const html = renderToStaticMarkup(createElement(DigitalCardView, { view, messages, legalLinks: [], projectSlug: 'p', countable: false, motion: null, preview: true }))
    expect(html.match(/data-card-link-logo/g)).toHaveLength(1)
    const tile = html.slice(html.indexOf('data-card-link-logo'), html.indexOf('</span>', html.indexOf('data-card-link-logo')))
    expect(tile).toContain('aria-hidden="true"')
    expect(tile).toContain('var(--color-background)')
    expect(tile).toContain('alt=""')
    expect(tile).toContain('object-contain')
    expect(html.indexOf('Plain')).toBeGreaterThan(html.indexOf('data-card-link-logo'))
    // the without-logo button carries no tile
    const plain = html.slice(html.indexOf('data-card-link="without"'))
    expect(plain.slice(0, plain.indexOf('</a>'))).not.toContain('data-card-link-logo')
  })
})

// ── Amendment B: "Page on this website" reaches what the navigation reaches ──
describe('page links resolve through the navigation resolver (Amendment B)', () => {
  const tmzProject = {
    enabledModules: ['digital-cards', 'catalogue', 'blog'],
    moduleSegments: [{ moduleId: 'catalogue', segment: 'books' }, { moduleId: 'blog', segment: null }],
  }
  const lctx = (siteBase: string) => ({ locale: 'en', siteBase, messages, ...tmzProject })
  const page = (over: Record<string, unknown>) => ({ _key: 'p', kind: 'page' as const, label: null, primary: false, ...over })
  const landing = { type: 'cataloguePage', hasPage: null, slug: null, segment: 'books', title: 'Between the Lines' }
  const collection = { type: 'catalogueCollection', hasPage: true, slug: 'douglas-adams', segment: 'books', title: 'Douglas Adams' }

  it('catalogue landing page, collection, item, built-in section and module page — on the own host and path-based', () => {
    for (const [siteBase, pre] of [['/en', '/en'], ['/en/tmz', '/en/tmz']] as const) {
      expect(linkView(page({ hasPageRef: true, catalogue: landing }), lctx(siteBase))).toMatchObject({ href: `${pre}/books`, label: 'Between the Lines', external: false })
      expect(linkView(page({ hasPageRef: true, catalogue: collection }), lctx(siteBase))).toMatchObject({ href: `${pre}/books/douglas-adams`, label: 'Douglas Adams' })
      expect(linkView(page({ hasPageRef: true, catalogue: { ...collection, type: 'catalogueItem', slug: 'good-omens', title: 'Good Omens' } }), lctx(siteBase))).toMatchObject({ href: `${pre}/books/good-omens` })
      expect(linkView(page({ internalPage: 'blog' }), lctx(siteBase))).toMatchObject({ href: `${pre}/blog`, label: 'Blog' })
      expect(linkView(page({ internalPage: 'homepage' }), lctx(siteBase))).toMatchObject({ href: pre, label: 'Home' })
      expect(linkView(page({ moduleId: 'catalogue' }), lctx(siteBase))).toMatchObject({ href: `${pre}/books`, label: 'Catalogue' })
    }
    // A typed label wins over the target's title.
    expect(linkView(page({ label: 'Books', hasPageRef: true, catalogue: landing }), lctx('/en'))!.label).toBe('Books')
  })

  it('page references stored before Amendment B work as before (home → site base, others → slug)', () => {
    expect(linkView(page({ hasPageRef: true, page: { pageType: 'home', slug: 'home', title: 'Home' } }), lctx('/it/hoffmann'))!.href).toBe('/it/hoffmann')
    expect(linkView(page({ page: { pageType: 'standard', slug: 'contatti', title: 'Contatti' } }), lctx('/it'))).toMatchObject({ href: '/it/contatti', label: 'Contatti' })
  })

  it('omits a link whose target is not public: no page, no slug in this language, catalogue or section module off, restricted page', () => {
    // a reference that resolved to nothing (draft, archived, another project, not public)
    expect(linkView(page({ hasPageRef: true, catalogue: null, page: null }), lctx('/en'))).toBeNull()
    // a collection without a page / without a slug in the visitor's language
    expect(linkView(page({ hasPageRef: true, catalogue: { ...collection, hasPage: false } }), lctx('/en'))).toBeNull()
    expect(linkView(page({ hasPageRef: true, catalogue: { ...collection, slug: null } }), lctx('/en'))).toBeNull()
    // catalogue not installed → no segment
    expect(linkView(page({ hasPageRef: true, catalogue: { ...landing, segment: null } }), lctx('/en'))).toBeNull()
    expect(linkView(page({ moduleId: 'catalogue' }), { ...lctx('/en'), moduleSegments: [] })).toBeNull()
    // a section whose module is off
    expect(linkView(page({ internalPage: 'events' }), lctx('/en'))).toBeNull()
    expect(linkView(page({ internalPage: 'blog' }), { ...lctx('/en'), enabledModules: [] })).toBeNull()
    // a members-only page (ADR-040: hidden by default, like in the menu)
    expect(linkView(page({ page: { pageType: 'standard', slug: 'soci', title: 'Soci', access: { visibility: 'members' } } }), lctx('/en'))).toBeNull()
    // nothing chosen
    expect(linkView(page({}), lctx('/en'))).toBeNull()
  })

  it('the site card passes the project’s module segments through (catalogue landing on the live card)', () => {
    const card = site()
    card.project = { customDomain: 'tmz.it', ...tmzProject }
    card.links = [page({ _key: 'b', hasPageRef: true, catalogue: landing }), page({ _key: 'c', moduleId: 'catalogue' })]
    expect(siteCardView(card, ctx).links.map((l) => l.href)).toEqual(['/en/books', '/en/books'])
  })
})

