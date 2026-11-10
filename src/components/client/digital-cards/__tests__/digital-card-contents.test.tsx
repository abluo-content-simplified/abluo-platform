// @vitest-environment jsdom
/** "What's on your card": the business-name row says when the logo already contains the name. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DigitalCardSnapshot } from '@/lib/api/digital-cards'
import { mount, type Mounted } from '@/components/app/ui/__tests__/intl-dom'
import { getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { DigitalCardContents } from '../DigitalCardContents'

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

const snapshot = (av: Record<string, unknown>) =>
  ({
    kind: 'site',
    person: null,
    pages: [],
    files: {},
    availability: { siteName: 'CYCE', logo: true, businessName: true, phone: false, email: false, whatsapp: false, values: { phone: '', email: '', whatsapp: '', role: '' }, socials: [], locations: [], ...av },
  }) as unknown as DigitalCardSnapshot

function render(av: Record<string, unknown>, show: Record<string, unknown>) {
  m = mount(
    <DigitalCardContents
      snapshot={snapshot(av)}
      show={{ socials: [], ...show } as never}
      links={[]}
      lang="en"
      defaultLocale="en"
      editable
      projectSlug="cyce"
      descriptionText=""
      onSwitch={() => {}}
      onSocial={() => {}}
      onLocation={() => {}}
      onLinkShown={() => {}}
      onEditButtons={() => {}}
      descriptionField={null}
    />,
  )
  return m.host.textContent ?? ''
}

const NOTE = 'Not shown: the logo already contains the name.'

describe('business name row (logo contains the name)', () => {
  it('shows the note when the flag is on and the Logo switch is on', () => {
    expect(render({ logoIncludesName: true }, { logo: true, businessName: true })).toContain(NOTE)
  })
  it('no note when the Logo switch is off, the logo is missing, or the flag is off', () => {
    expect(render({ logoIncludesName: true }, { logo: false, businessName: true })).not.toContain(NOTE)
    m?.unmount()
    expect(render({ logoIncludesName: true, logo: false }, { logo: true, businessName: true })).not.toContain(NOTE)
    m?.unmount()
    expect(render({ logoIncludesName: false }, { logo: true, businessName: true })).not.toContain(NOTE)
  })
  it('is localized', () => {
    expect(getDigitalCardsMessages('it').card.nameInLogoNote).toBe('Non mostrato: il logo contiene già il nome.')
    expect(getDigitalCardsMessages('de').card.nameInLogoNote).toBe('Nicht angezeigt: Das Logo enthält den Namen bereits.')
  })
})
