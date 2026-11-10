// @vitest-environment jsdom
/**
 * The Digital Card links editor, rendered (round 4, Tom 2026-11-09: "Add a
 * link → Page on this website, then a label field that says 'Page on this
 * website', then pick the page…"). Drives the real component with Claudia
 * Hoffmann's pages: Add link → Type (page first) → the page → Label (its
 * placeholder is the page title, what the card shows when left empty) →
 * one-liner; the list shows each link as it will look; reorder by the grip's
 * arrow keys; the ⋯ menu has no Move up / Move down any more.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { DigitalCardLinkValue, DigitalCardTargetOption } from '@/lib/api/digital-cards'
import { byName, click, key, mount, typeInto, type Mounted } from '@/components/app/ui/__tests__/intl-dom'
import { DigitalCardLinks, linksPayload } from '../DigitalCardLinks'

vi.mock('next-intl', async () => {
  const u = await import('use-intl')
  return { ...u, NextIntlClientProvider: u.IntlProvider }
})
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/client/media/MediaLibraryPicker', () => ({ MediaLibraryPicker: () => null }))
vi.mock('@/components/client/media/PhotoSource', () => ({ PhotoSource: () => null }))

beforeAll(() => {
  // jsdom has no modal dialogs: the picker's BottomSheet only needs open / close.
  const proto = HTMLDialogElement.prototype as unknown as { showModal: () => void; close: () => void }
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never
})

/** The open picker sheet (portalled to the document body). */
const sheet = () => document.querySelector('dialog[open]') as HTMLDialogElement
/** Opens the page picker of the link being edited and picks the option with this title. */
function pick(host: HTMLElement, title: string) {
  click(host.querySelector('button[aria-haspopup="dialog"]'))
  const option = [...sheet().querySelectorAll<HTMLElement>('li button')].find((b) => b.querySelector('span span')?.textContent === title)
  click(option ?? null)
}

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

const PAGES = [
  { id: 'hoffmann-page-home', title: 'Home' },
  { id: 'hoffmann-page-contatti', title: 'Contatti e appuntamenti' },
]
const link = (over: Partial<DigitalCardLinkValue>): DigitalCardLinkValue => ({ key: 'k', kind: 'page', label: {}, description: {}, url: '', page: null, file: null, logo: null, value: '', hidden: false, primary: false, ...over })

function Harness({ initial, onLinks, lang = 'it', pages = PAGES }: { initial: DigitalCardLinkValue[]; onLinks: (l: DigitalCardLinkValue[]) => void; lang?: string; pages?: DigitalCardTargetOption[] }) {
  const [links, setLinks] = useState(initial)
  return (
    <DigitalCardLinks
      projectSlug="hoffmann"
      links={links}
      onChange={(next) => {
        setLinks(next)
        onLinks(next)
      }}
      onRemove={() => {}}
      lang={lang}
      defaultLocale="it"
      editable
      pages={pages}
      files={{}}
      reservations={false}
    />
  )
}

describe('Digital Card links editor', () => {
  it('Add link → type → page → label defaults to the page title → one-liner', () => {
    let last: DigitalCardLinkValue[] = []
    m = mount(<Harness initial={[]} onLinks={(l) => (last = l)} />, 'en')
    click(byName(m.host, 'button', 'Add link'))
    expect(last).toHaveLength(1)
    // The new link opens for editing: Type first (a page of this website by default).
    const type = m.host.querySelector('select') as HTMLSelectElement
    expect(type.value).toBe('page')
    // The page: one searchable list in a sheet (Amendment B).
    expect(byName(m.host, 'button', 'Choose a page')).toBeTruthy()
    pick(m.host, 'Contatti e appuntamenti')
    expect(last[0].page).toBe('hoffmann-page-contatti')
    expect(sheet()).toBeNull()
    // The label is optional; its placeholder is what the card shows: the page title, not the type name.
    const label = [...m.host.querySelectorAll('input')].find((i) => i.placeholder === 'Contatti e appuntamenti')
    expect(label).toBeTruthy()
    expect(m.host.textContent).toContain('Optional. Left empty, the card shows “Contatti e appuntamenti”.')
    expect([...m.host.querySelectorAll('input')].some((i) => i.placeholder === 'Page of this website')).toBe(false)
    // The list row already shows the link as it will look.
    expect(m.host.querySelector('li p')?.textContent).toBe('Contatti e appuntamenti')
    typeInto(label!, 'Prenota un colloquio')
    const inputs = m.host.querySelectorAll('input')
    typeInto(inputs[inputs.length - 1], 'Varese e online')
    expect(last[0].label).toEqual({ it: 'Prenota un colloquio' })
    expect(last[0].description).toEqual({ it: 'Varese e online' })
    expect(m.host.querySelector('li p')?.textContent).toBe('Prenota un colloquio')
    expect(m.host.textContent).toContain('Varese e online')
    // Done closes the editing part.
    click(byName(m.host, 'button', 'Done'))
    expect(m.host.querySelector('select')).toBeNull()
  })

  it('an optional logo: hint, choose, Remove; sent with the link', () => {
    let last: DigitalCardLinkValue[] = []
    m = mount(<Harness initial={[link({ key: 'a1', kind: 'url', url: 'https://a.example', logo: 'img-9' })]} onLinks={(l) => (last = l)} />, 'en')
    click(byName(m.host, 'button', /Edit/))
    expect(m.host.textContent).toContain('Optional small logo. Best: SVG or a PNG with transparent background, at least 96 px high.')
    expect(byName(m.host, 'button', 'Change logo')).toBeTruthy()
    expect(linksPayload(last.length ? last : [link({ key: 'a1', kind: 'url', url: 'https://a.example', logo: 'img-9' })])[0].logo).toBe('img-9')
    click(byName(m.host, 'button', 'Remove logo'))
    expect(last[0].logo).toBeNull()
    expect(linksPayload(last)[0].logo).toBeNull()
    expect(byName(m.host, 'button', 'Choose a logo from Media Library')).toBeTruthy()
  })

  it('Hoffmann’s stored links: the unlabelled one shows its page title; reorder with the grip keys', () => {
    let last: DigitalCardLinkValue[] = []
    const home = link({ key: 'cbfdf6bf94e1', page: 'hoffmann-page-home', label: { de: 'Homepage' } })
    const contatti = link({ key: 'b6791e1598d8', page: 'hoffmann-page-contatti' })
    m = mount(<Harness initial={[home, contatti]} onLinks={(l) => (last = l)} lang="de" />, 'en')
    const rows = [...m.host.querySelectorAll('ol > li')]
    expect(rows.map((r) => r.querySelector('p')?.textContent)).toEqual(['Homepage', 'Contatti e appuntamenti'])
    const grip = byName(m.host, 'button', /^Move Contatti e appuntamenti, position 2 of 2/)
    expect(grip).toBeTruthy()
    key(grip, 'ArrowUp')
    expect(last.map((l) => l.key)).toEqual(['b6791e1598d8', 'cbfdf6bf94e1'])
  })

  it('Amendment B — tmz: the picker lists Between the Lines, collections and items under Catalogue, and the sections; search narrows it', () => {
    const TMZ: DigitalCardTargetOption[] = [
      { id: 'tmz-page-home', title: 'Home', group: 'pages', type: 'page', path: '' },
      { id: 'tmz-page-downloads', title: 'Downloads', group: 'pages', type: 'page', path: 'downloads' },
      { id: 'tmz-page-cookie', title: 'Cookie Policy', group: 'pages', type: 'page', path: 'cookie-policy' },
      { id: 'tmz-catalogue-page', title: 'Between the Lines', group: 'catalogue', type: 'cataloguePage', path: 'books' },
      { id: 'tmz-collection-douglas-adams', title: 'Douglas Adams', group: 'catalogue', type: 'catalogueCollection', path: 'books/douglas-adams' },
      { id: 'section:blog', title: 'Blog', group: 'sections', type: 'section' },
    ]
    let last: DigitalCardLinkValue[] = []
    m = mount(<Harness initial={[link({ key: 'n1' })]} onLinks={(l) => (last = l)} pages={TMZ} lang="en" />, 'en')
    click(byName(m.host, 'button', /^Edit/))
    click(m.host.querySelector('button[aria-haspopup="dialog"]'))
    const headings = [...sheet().querySelectorAll('h3')].map((h) => h.textContent)
    expect(headings).toEqual(['Pages', 'Catalogue', 'Sections'])
    expect(sheet().textContent).toContain('Between the Lines')
    expect(sheet().textContent).toContain('Catalogue page · /books')
    expect(sheet().textContent).toContain('Collection · /books/douglas-adams')
    // Search: word prefix, accents and case ignored.
    typeInto(sheet().querySelector('input[type="search"]'), 'betw')
    expect([...sheet().querySelectorAll('li button')].map((b) => b.querySelector('span span')?.textContent)).toEqual(['Between the Lines'])
    typeInto(sheet().querySelector('input[type="search"]'), 'zzz')
    expect(sheet().textContent).toContain('Nothing matches “zzz”.')
    typeInto(sheet().querySelector('input[type="search"]'), '')
    click([...sheet().querySelectorAll<HTMLElement>('li button')].find((b) => b.querySelector('span span')?.textContent === 'Between the Lines')!)
    expect(last[0]).toMatchObject({ page: 'tmz-catalogue-page', internalPage: null, moduleId: null })
    // The label left empty shows the target's title.
    expect([...m.host.querySelectorAll('input')].some((i) => i.placeholder === 'Between the Lines')).toBe(true)
    // A built-in section: stored as internalPage, the page cleared; sent so.
    pick(m.host, 'Blog')
    expect(last[0]).toMatchObject({ page: null, internalPage: 'blog', moduleId: null })
    expect(linksPayload(last)[0]).toMatchObject({ page: null, internalPage: 'blog', moduleId: null })
    expect(m.host.querySelector('li p')?.textContent).toBe('Blog')
    // Switching to Contact form (a page only) clears the section.
    typeInto(m.host.querySelector('select'), 'form')
    expect(last[0]).toMatchObject({ kind: 'form', page: null, internalPage: null, moduleId: null })
  })
})
