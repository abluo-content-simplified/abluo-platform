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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { DigitalCardLinkValue } from '@/lib/api/digital-cards'
import { byName, click, key, mount, typeInto, type Mounted } from '@/components/app/ui/__tests__/intl-dom'
import { DigitalCardLinks } from '../DigitalCardLinks'

vi.mock('next-intl', async () => {
  const u = await import('use-intl')
  return { ...u, NextIntlClientProvider: u.IntlProvider }
})
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/client/media/MediaLibraryPicker', () => ({ MediaLibraryPicker: () => null }))

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

const PAGES = [
  { id: 'hoffmann-page-home', title: 'Home' },
  { id: 'hoffmann-page-contatti', title: 'Contatti e appuntamenti' },
]
const link = (over: Partial<DigitalCardLinkValue>): DigitalCardLinkValue => ({ key: 'k', kind: 'page', label: {}, description: {}, url: '', page: null, file: null, value: '', hidden: false, primary: false, ...over })

function Harness({ initial, onLinks, lang = 'it' }: { initial: DigitalCardLinkValue[]; onLinks: (l: DigitalCardLinkValue[]) => void; lang?: string }) {
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
      pages={PAGES}
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
    const selects = m.host.querySelectorAll('select')
    typeInto(selects[1], 'hoffmann-page-contatti')
    expect(last[0].page).toBe('hoffmann-page-contatti')
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
})
