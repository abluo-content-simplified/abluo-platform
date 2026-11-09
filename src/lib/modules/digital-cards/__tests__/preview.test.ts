import { describe, it, expect } from 'vitest'
import { previewCardView, previewLink, type PreviewLinkValue } from '../preview'
import { cardPreviewTheme, cssValue } from '../preview-theme'
import { decodeContact } from '../model'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import type { DigitalCardPreviewBase } from '@/lib/api/digital-card-preview'

const messages = getDigitalCardSiteMessages('en')
const img = (ref: string) => ({ asset: { _ref: ref, _type: 'reference' }, hotspot: { x: 0.3, y: 0.2, width: 1, height: 1 } }) as never

const base = (over: Partial<DigitalCardPreviewBase> = {}): DigitalCardPreviewBase => ({
  locale: 'it',
  defaultLocale: 'en',
  site: {
    siteName: 'Studio Rossi',
    phone: '+39 0332 1234567',
    email: 'info@studio.example',
    socialLinks: [
      { _key: 's1', platform: 'instagram', url: 'https://instagram.com/studio' },
      { _key: 's2', platform: 'facebook', url: 'https://facebook.com/studio' },
    ],
    locations: [],
  },
  project: { customDomain: 'studio.example', enabledModules: ['digital-cards'] },
  person: null,
  siteCard: null,
  pages: { 'page-1': { pageType: 'standard', slug: 'orari', title: 'Orari' } },
  files: { 'file-1': { mediaType: 'pdf', url: 'https://cdn.sanity.io/files/x/menu.pdf', title: 'Menu' } },
  background: img('image-bg'),
  theme: { css: '', fontsUrl: '' },
  motion: null,
  ...over,
})

const link = (over: Partial<PreviewLinkValue>): PreviewLinkValue => ({
  key: 'k',
  kind: 'url',
  label: {},
  description: {},
  url: '',
  page: null,
  file: null,
  value: '',
  hidden: false,
  primary: false,
  ...over,
})

describe('live preview view model (Amendment A)', () => {
  it('renders what is on screen with the website’s own view model', () => {
    const view = previewCardView(
      'site',
      'pub-1',
      {
        description: { en: 'Calm care', it: 'Cura serena' },
        links: [
          link({ key: 'a', kind: 'page', page: 'page-1', label: { en: 'Timetable' } }),
          link({ key: 'b', kind: 'phone', value: '+39 333 1234567', primary: true }),
          link({ key: 'c', kind: 'url', url: 'https://example.org', hidden: true }),
          link({ key: 'd', kind: 'file', file: 'file-1' }),
        ],
        backgroundId: 'bg',
        show: { hiddenSocials: ['facebook'] },
        urlName: '',
      },
      base(),
      messages,
    )!
    expect(view.description).toBe('Cura serena')
    expect(view.primary?.key).toBe('b')
    expect(decodeContact(view.primary!.hrefEnc!)).toBe('tel:+393331234567')
    // hidden link left out; label falls back to the default language; page resolved for the language
    expect(view.links.map((l) => [l.key, l.label, l.href])).toEqual([
      ['a', 'Timetable', '/orari'],
      ['d', 'Menu', 'https://cdn.sanity.io/files/x/menu.pdf'],
    ])
    expect(view.socials.map((s) => s.icon)).toEqual(['instagram'])
    expect(view.background).not.toBeNull()
    expect(view.qr?.url).toBe('https://www.studio.example/link?src=qr')
  })

  it('no background when none is chosen on screen; a person card without its person renders nothing', () => {
    const values = { description: {}, links: [], backgroundId: null, show: {}, urlName: 'sofia' }
    expect(previewCardView('site', 'p', values, base(), messages)!.background).toBeNull()
    expect(previewCardView('person', 'p', values, base(), messages)).toBeNull()
  })

  it('an unfinished link has no target (it is dropped like on the website)', () => {
    expect(previewLink(link({ kind: 'page', page: 'missing' }), base()).page).toBeNull()
    expect(previewLink(link({ kind: 'url', url: 'x' }), base()).url).toBe('x')
  })
})

describe('preview design system (scoped CSS)', () => {
  it('scopes every variable to the preview frame, dark first and light under html.light', () => {
    const t = cardPreviewTheme({ colors: { darkTheme: { primary: '#123456' } } } as never, 'toggle', 'abc')
    expect(t.css).toContain('[data-card-preview="abc"] {')
    expect(t.css).toContain('html.light [data-card-preview="abc"]')
    expect(t.css).toContain('--color-primary: #123456')
    expect(t.css).not.toMatch(/:root/)
  })

  it('one palette for a site locked to one theme', () => {
    expect(cardPreviewTheme(null, 'darkOnly', 'a').css).not.toContain('html.light')
    expect(cardPreviewTheme(null, 'lightOnly', 'a').css).not.toContain('html.light')
  })

  it('a design-system value cannot close the rule or the style element', () => {
    expect(cssValue('red; } </style><script>')).toBe('red  /stylescript')
    const t = cardPreviewTheme({ colors: { darkTheme: { primary: 'red;}</style>' } } } as never, 'darkOnly', 'x"]{')
    expect(t.css).not.toContain('</style>')
    expect(t.css).toContain('[data-card-preview="x"]')
  })
})
