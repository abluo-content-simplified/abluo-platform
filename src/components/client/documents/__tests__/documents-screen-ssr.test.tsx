/**
 * ADR-040 §15 (R9) — the Documents screens as the server renders them: the
 * records list (who can open each, languages, pages), the read-only Pages
 * recap, the Add / edit form in Tom's field order with pages that don't fit
 * greyed out with the reason, read-only for support visits and readers, the
 * "almost ready" state, and every message present in English, Italian and
 * German.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IntlMessageFormat } from 'intl-messageformat'
import en from '../../../../../messages/en.json'
import it_ from '../../../../../messages/it.json'
import de from '../../../../../messages/de.json'

const BUNDLES: Record<string, unknown> = { en, it: it_, de }
const state = vi.hoisted(() => ({ locale: 'en' }))

vi.mock('next-intl', () => ({
  useLocale: () => state.locale,
  useTranslations: (ns: string) => (key: string, args: Record<string, unknown> = {}) => {
    const full = `${ns}.${key}`
    const msg = full.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], BUNDLES[state.locale])
    if (typeof msg !== 'string') throw new Error(`missing message ${state.locale}:${full}`)
    return String(new IntlMessageFormat(msg, state.locale).format(args as never))
  },
}))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: unknown }) => <a href={href} {...rest}>{children as never}</a>,
}))
vi.mock('@/app/[locale]/(client)/[tenant]/document-library/actions', () => ({}))

import { DocumentsBrowser } from '../DocumentsBrowser'
import { DocumentEditor } from '../DocumentEditor'
import type { DocumentsDashboardData, DocumentView } from '@/lib/access/documents-dashboard'

const G1 = '11111111-1111-4111-8111-111111111111'
const G2 = '22222222-2222-4222-8222-222222222222'
const file = (locale: string, sha = 'a'.repeat(64)) => ({ locale, mimeType: 'application/pdf' as const, sizeBytes: 240_000, sha256: sha, originalFilename: 'listino.pdf', uploadedAt: '2026-10-02T10:00:00Z' })
const doc = (over: Partial<DocumentView>): DocumentView => ({
  id: 'd1', title: 'Listino', titles: { it: 'Listino' }, note: null, visibility: 'everyone', groupIds: [], archived: false,
  createdAt: '2026-10-02T10:00:00Z', files: [file('it'), file('en')], sharedFile: true, categoryKey: null, tagKeys: [], pageIds: [], pageOrder: {}, link: null, ...over,
})
type Ready = Extract<DocumentsDashboardData, { notReady: false }>
const data: Ready = {
  notReady: false,
  site: { defaultLocale: 'it', locales: ['it', 'en'], url: 'https://example.org' },
  documents: [
    doc({ id: 'd1', title: 'Listino', pageIds: ['contatti'], pageOrder: { contatti: 0 }, categoryKey: 'prezzi', tagKeys: ['2027'] }),
    doc({ id: 'd2', title: 'Orario', titles: { it: 'Orario' }, visibility: 'groups', groupIds: [G1], files: [file('it')], sharedFile: false, pageIds: ['genitori'], pageOrder: { genitori: 0 } }),
    doc({ id: 'd3', title: 'Bozza', titles: { it: 'Bozza' }, files: [] }),
  ],
  groups: [{ id: G1, name: 'Genitori', archived: false }, { id: G2, name: 'Consiglio', archived: false }],
  groupsAvailable: true,
  pages: [
    { id: 'contatti', title: 'Contatti', path: 'contatti', isHome: false, restricted: false, groupIds: [] },
    { id: 'genitori', title: 'Area genitori', path: 'genitori', isHome: false, restricted: true, groupIds: [G1] },
    { id: 'consiglio', title: 'Consiglio', path: 'consiglio', isHome: false, restricted: true, groupIds: [G2] },
  ],
  categories: [{ value: 'prezzi', label: { it: 'Prezzi', en: 'Prices' }, color: null }, { value: 'orari', label: { it: 'Orari', en: 'Timetables' }, color: null }],
  tags: [{ value: '2027', label: { it: '2027' }, color: null }],
  canAddTerms: true,
  limits: { titleMax: 120, noteMax: 200, types: [] },
}

const list = (over: Partial<Parameters<typeof DocumentsBrowser>[0]> = {}) =>
  renderToStaticMarkup(<DocumentsBrowser projectSlug="site-a" data={data} canManage initialTab="documents" {...over} />)
const editor = (over: Partial<Parameters<typeof DocumentEditor>[0]> = {}) =>
  renderToStaticMarkup(<DocumentEditor projectSlug="site-a" data={data} document={null} canManage {...over} />)

describe('the Documents list', () => {
  it('is a records list: search, a table and phone rows — no cards, no view switch', () => {
    state.locale = 'en'
    const html = list()
    expect(html).toContain('Add document')
    expect(html).toContain('Listino')
    expect(html).toContain('Orario')
    expect(html).toContain('Everyone')
    expect(html).toContain('Genitori')
    expect(html).toContain('All languages')
    expect(html).toContain('Contatti')
    expect(html).toContain('No file yet')
    expect(html).toMatch(/<table/)
    expect(html).toContain('Prices') // the category column, in the dashboard language
  })
  it('the Pages tab recaps each page: public or protected, and its documents in order', () => {
    const html = list({ initialTab: 'pages' })
    expect(html).toContain('Public page')
    expect(html).toContain('Protected · Genitori')
    expect(html).toContain('/genitori')
    expect(html).toContain('No documents on this page yet.') // consiglio
  })
  it('every row has its own menu, also with a single document and for readers', () => {
    expect(list()).toContain('aria-label="Actions for Listino"')
    expect(list({ data: { ...data, documents: [data.documents[0]] } })).toContain('aria-label="Actions for Listino"')
    expect(list({ canManage: false })).toContain('aria-label="Actions for Listino"')
  })
  it('rows can be selected (checkboxes) by people who may manage; readers get none', () => {
    expect(list()).toContain('aria-label="Select all documents"')
    expect(list()).toContain('aria-label="Select Listino"')
    expect(list({ canManage: false })).not.toContain('Select Listino')
  })
  it('readers and support visits: read-only, saying why; nothing to add', () => {
    expect(list({ canManage: false })).toContain('needs the Manage documents permission')
    const sup = list({ canManage: false, supportVisit: true })
    expect(sup).toContain('You are visiting as Abluo support')
    expect(sup).not.toContain('Add document')
  })
  it('while the tables are not installed: "almost ready" and nothing else', () => {
    const html = list({ data: { notReady: true, site: data.site } })
    expect(html).toContain('Documents are almost ready')
    expect(html).not.toContain('Listino')
  })
})

describe('the Add / edit form', () => {
  it('asks in Tom’s order: title, languages, file, note, who, category, tags, show on', () => {
    state.locale = 'en'
    const html = editor()
    const at = (s: string) => html.indexOf(s)
    const order = ['Title', 'Languages', 'How many files', 'Short note', 'Who can open it', '>Category<', '>Tags<', 'Show on'].map(at)
    for (const i of order) expect(i).toBeGreaterThan(-1)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
  it('a public document fits every page; a group document only pages open to its groups — the rest greyed out with the reason', () => {
    const pub = editor()
    expect(pub).not.toContain('a members-only document can’t show here')
    const grp = editor({ document: data.documents[1] })
    expect(grp).toContain('Public page — a members-only document can’t show here.')
    expect(grp).toContain('Protected for other groups')
    expect(grp).toContain('It will appear on: Area genitori.')
  })
  it('category and tags: the document’s own are chosen; existing ones are offered', () => {
    const html = editor({ document: data.documents[0] })
    expect(html).toContain('Timetables')
    expect(html).toMatch(/aria-pressed="true"[^>]*>(?:<[^>]+>)*Prices|Prices/)
  })
  it('a document with nothing to show on says so', () => {
    expect(editor({ document: data.documents[2] })).toContain('No page chosen')
  })
})

describe('every message exists in English, Italian and German', () => {
  it('renders every state in every interface language', () => {
    for (const locale of ['en', 'it', 'de']) {
      state.locale = locale
      for (const initialTab of ['documents', 'pages'] as const) {
        expect(() => list({ initialTab })).not.toThrow()
        expect(() => list({ initialTab, canManage: false, supportVisit: true })).not.toThrow()
      }
      expect(() => list({ data: { notReady: true, site: data.site } })).not.toThrow()
      expect(() => list({ data: { ...data, documents: [] } })).not.toThrow()
      for (const document of [null, ...data.documents, doc({ archived: true })]) {
        expect(() => editor({ document })).not.toThrow()
        expect(() => editor({ document, canManage: false })).not.toThrow()
      }
    }
    state.locale = 'en'
  })
})
