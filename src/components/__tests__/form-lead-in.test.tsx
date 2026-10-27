/** Form presentation additions: formDefinition.intro (inline + overlay host) and the overlay button's lead-in. */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useParams: () => ({}), useRouter: () => ({ push: () => {} }), usePathname: () => '/' }))

import { FormSection } from '@/components/sections/FormSection'
import { FormOverlayButtonSection } from '@/components/sections/FormOverlayButtonSection'
import type { FormOverlayButtonSection as ButtonSection, FormSection as InlineSection, RenderableFormDefinition } from '@/lib/sanity/types'

const def = (extra: Partial<RenderableFormDefinition> = {}): RenderableFormDefinition => ({
  _id: 'f',
  formId: 'book-recommendation',
  formType: 'single-step',
  title: 'A book that stayed with you?',
  steps: [{ key: 'book', fields: [{ id: 'book_title', type: 'text', required: true, label: 'Book title' }] }] as never,
  ...extra,
})

describe('FormSection — intro', () => {
  const section = (d: RenderableFormDefinition) => ({ _type: 'formSection', _key: 'k', definition: d }) as unknown as InlineSection
  it('renders the intro under the eyebrow when set', () => {
    const html = renderToStaticMarkup(<FormSection section={section(def({ eyebrow: 'Write to us', intro: 'We read every message.' }))} surface={'transparent' as never} designSystem={null} locale="en" tenantSlug={'cyce' as never} />)
    expect(html).toContain('Write to us')
    expect(html).toContain('We read every message.')
    expect(html.indexOf('Write to us')).toBeLessThan(html.indexOf('We read every message.'))
  })
  it('renders no intro paragraph for a form without one (unchanged)', () => {
    const html = renderToStaticMarkup(<FormSection section={section(def())} surface={'transparent' as never} designSystem={null} locale="en" tenantSlug={'cyce' as never} />)
    expect(html).not.toContain('whitespace-pre-line text-base leading-relaxed text-[var(--color-text-secondary)]')
  })
})

describe('FormOverlayButtonSection — lead-in', () => {
  const base = { _type: 'formOverlayButtonSection', _key: 'k', definition: def(), buttonLabel: 'Recommend a book', buttonAlign: 'center' }
  it('renders eyebrow, heading and text above the button, aligned with it', () => {
    const html = renderToStaticMarkup(
      <FormOverlayButtonSection
        section={{ ...base, eyebrow: 'Community', title: 'Want to recommend a book?', body: 'Tell us about it.' } as unknown as ButtonSection}
        surface={'transparent' as never}
        designSystem={null}
        locale="en"
        tenantSlug={'cyce' as never}
      />,
    )
    expect(html).toContain('text-center')
    expect(html).toContain('<h2')
    expect(html).toContain('Want to recommend a book?')
    expect(html.indexOf('Tell us about it.')).toBeLessThan(html.indexOf('Recommend a book<'))
  })
  it('renders only the button without a lead-in (unchanged)', () => {
    const html = renderToStaticMarkup(<FormOverlayButtonSection section={base as unknown as ButtonSection} surface={'transparent' as never} designSystem={null} locale="en" tenantSlug={'cyce' as never} />)
    expect(html).not.toContain('<h2')
    expect(html).toContain('Recommend a book')
  })
})
