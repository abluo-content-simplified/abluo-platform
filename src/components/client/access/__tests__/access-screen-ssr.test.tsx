/**
 * ADR-040 B2.5 — the Access screen as the server renders it: the three tabs,
 * read-only for support visits and people without "Manage access", the
 * "almost ready" state while the tables are not installed, never a password
 * or a hash, and every message present in English, Italian and German.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlMessageFormat } from 'intl-messageformat'
import en from '../../../../../messages/en.json'
import it_ from '../../../../../messages/it.json'
import de from '../../../../../messages/de.json'

const BUNDLES: Record<string, unknown> = { en, it: it_, de }
const state = vi.hoisted(() => ({ locale: 'en', used: new Set<string>() }))

vi.mock('next-intl', () => ({
  useLocale: () => state.locale,
  useTranslations: (ns: string) => (key: string, args: Record<string, unknown> = {}) => {
    const full = `${ns}.${key}`
    state.used.add(full)
    const msg = full.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], BUNDLES[state.locale])
    if (typeof msg !== 'string') throw new Error(`missing message ${state.locale}:${full}`)
    return String(new IntlMessageFormat(msg, state.locale).format(args as never))
  },
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/[locale]/(client)/[tenant]/access/actions', () => ({}))

import { AccessScreen } from '../AccessScreen'
import type { AccessDashboardData } from '@/lib/access/dashboard'

const G1 = '11111111-1111-4111-8111-111111111111'
const G2 = '22222222-2222-4222-8222-222222222222'
const data: AccessDashboardData = {
  notReady: false,
  site: { defaultLocale: 'it', locales: ['it', 'en'], url: 'https://example.org' },
  groups: [
    { id: G1, name: 'Genitori', archived: false, passwords: [{ id: 'c1', label: 'Genitori', inUse: true, changedAt: '2026-10-01T10:00:00Z' }], signedIn: 3 },
    { id: G2, name: 'Consiglio', archived: false, passwords: [], signedIn: 0 },
  ],
  documents: [
    { id: 'd1', title: 'Orario', archived: false, groupIds: [G1], files: [{ locale: 'it', sizeBytes: 2_400_000, filename: 'orario.pdf', uploadedAt: '2026-10-02T10:00:00Z' }], link: 'https://example.org/it/site-access/documents/d1' },
  ],
  pages: [
    { id: 'home', title: 'Home', path: '', isHome: true, visibility: 'public', groupIds: [], navigation: 'hidden', hasFileDownload: false, closedBy: null, rev: 'r', draftRev: null },
    { id: 'p1', title: 'Area genitori', path: 'genitori', isHome: false, visibility: 'restricted', groupIds: [G1], navigation: 'locked', hasFileDownload: false, closedBy: null, rev: 'r', draftRev: null },
  ],
  signedInTotal: 3,
  limits: { fileBytesMax: 20 * 1024 * 1024, passwordMinLength: 10, passwordMaxLength: 200, nameMax: 80 },
}

const render = (over: Partial<Parameters<typeof AccessScreen>[0]> = {}) =>
  renderToStaticMarkup(<AccessScreen projectSlug="site-a" data={data} canManage supportVisit={false} initialTab={null} {...over} />)

describe('the Access screen', () => {
  it('opens on Groups with counts, the signed-in line and the actions an administrator needs', () => {
    state.locale = 'en'
    const html = render()
    expect(html).toContain('Access')
    expect(html).toMatch(/role="tablist"/)
    expect(html).toContain('Groups')
    expect(html).toContain('Genitori')
    expect(html).toContain('3 visitors are signed in right now.')
    expect(html).toMatch(/>Sign out everyone<\/button>/)
    expect(html).toContain('New group')
    expect(html).toContain('No password') // Consiglio
    expect(html).toContain('Set a password')
  })

  it('never renders a password or a hash', () => {
    const html = render()
    expect(html).not.toMatch(/scrypt\$|passwordHash/)
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/)
  })

  it('Documents and Pages tabs', () => {
    const docs = render({ initialTab: 'documents' })
    expect(docs).toContain('Orario')
    expect(docs).toContain('Add document')
    const pages = render({ initialTab: 'pages' })
    expect(pages).toContain('Always public')
    expect(pages).toContain('Members: Genitori')
    expect(pages).toContain('/genitori')
  })

  it('a support visit is read-only and says why', () => {
    const html = render({ canManage: false, supportVisit: true })
    expect(html).toContain('You are visiting as Abluo support')
    expect(html).not.toContain('New group')
    expect(html).not.toMatch(/>Sign out everyone<\/button>/)
    expect(html).not.toContain('Set a password')
  })

  it('without Manage access: read-only, with who to ask', () => {
    const html = render({ canManage: false })
    expect(html).toContain('needs the Manage access permission')
    expect(html).not.toContain('New group')
  })

  it('while the tables are not installed: a calm "almost ready" notice and nothing else', () => {
    const html = render({ data: { notReady: true, site: data.site } })
    expect(html).toContain('Access is almost ready')
    expect(html).not.toMatch(/role="tablist"/)
  })

  it('every message it uses exists in English, Italian and German', () => {
    for (const locale of ['en', 'it', 'de']) {
      state.locale = locale
      for (const tab of ['groups', 'documents', 'pages']) {
        expect(() => render({ initialTab: tab })).not.toThrow()
        expect(() => render({ initialTab: tab, canManage: false, supportVisit: true })).not.toThrow()
      }
      expect(() => render({ data: { notReady: true, site: data.site } })).not.toThrow()
    }
    state.locale = 'en'
  })

  it('the three bundles carry exactly the same Access keys', () => {
    const keys = (o: unknown, p = ''): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
    const access = (b: unknown) => keys((b as { clientDashboard: { access: unknown } }).clientDashboard.access).sort()
    expect(access(it_)).toEqual(access(en))
    expect(access(de)).toEqual(access(en))
  })
})

describe('a document whose PDF never finished uploading', () => {
  const ready = data as Extract<AccessDashboardData, { notReady: false }>
  const withEmpty = (archived = false): AccessDashboardData => ({
    ...ready,
    documents: [...ready.documents, { id: 'd2', title: 'Senza PDF', archived, groupIds: [G1], files: [], link: 'https://example.org/it/site-access/documents/d2' }],
  })
  it('is marked "not available", offers Add the PDF and Remove, and never a link', () => {
    state.locale = 'en'
    const html = render({ initialTab: 'documents', data: withEmpty() })
    const card = html.slice(html.indexOf('Senza PDF'))
    expect(card).toContain('Not available yet')
    expect(card).toContain('its PDF hasn’t finished uploading')
    expect(card).toMatch(/>Add the PDF<\/button>/)
    expect(card).toMatch(/>Remove<\/button>/)
    expect(card).not.toContain('Copy link')
    // the complete document still has its link
    expect(html.slice(0, html.indexOf('Senza PDF'))).toContain('Copy link')
  })
  it('read-only: the same notice, no buttons', () => {
    const card = (h: string) => h.slice(h.indexOf('Senza PDF'))
    const html = render({ initialTab: 'documents', data: withEmpty(), canManage: false })
    expect(card(html)).toContain('Not available yet')
    expect(card(html)).not.toMatch(/>(Add the PDF|Remove)<\/button>/)
  })
  it('once removed (archived without ever having a PDF) it leaves the list', () => {
    expect(render({ initialTab: 'documents', data: withEmpty(true) })).not.toContain('Senza PDF')
  })
})
