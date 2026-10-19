/**
 * ADR-037 D5/D6 — FAQ placements server-render their answers (rich text,
 * links resolved, unavailable links as text), head groups with set titles only
 * when several sets show, and a post shows its FAQs after the gallery with the
 * localized default heading — and nothing when the FAQ module is off.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))

import { FaqPlacement } from '@/components/faq/FaqPlacement'
import { FAQSection } from '@/components/sections/FAQSection'
import { PostArticle } from '@/components/blog/PostArticle'
import { placementFaqGroups } from '@/lib/faq/items'
import type { FAQSection as FAQSectionType, FaqSetData, Post, PortableTextBlock } from '@/lib/sanity/types'

const block = (text: string, extra: Partial<PortableTextBlock> = {}, marks: string[] = []) =>
  ({ _type: 'block', _key: text, style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's', text, marks }], ...extra }) as PortableTextBlock

const setA: FaqSetData = {
  _id: 'a', projectSlug: 'acme', title: 'Prenotazioni',
  items: [
    { _key: 'q1', question: 'Come prenoto?', answer: [block('Online, dal sito.'), block('Oppure al telefono.', { listItem: 'bullet' })] },
    {
      _key: 'q2', question: 'Dove trovo il menu?',
      answer: [block('Il menu', { markDefs: [{ _type: 'link', _key: 'l', internal: { _ref: 'x' }, internalTarget: { _type: 'page', projectSlug: 'acme', slug: 'menu', live: true } }] }, ['l']),
        block('Archivio', { markDefs: [{ _type: 'link', _key: 'm', internal: { _ref: 'y' }, internalTarget: { _type: 'post', projectSlug: 'acme', slug: 'z', live: false } }] }, ['m'])],
    },
  ],
}
const setB: FaqSetData = { _id: 'b', projectSlug: 'acme', title: 'Pagamenti', items: [{ _key: 'q3', question: 'Accettate carte?', answer: [block('Sì.')] }] }

describe('FaqPlacement', () => {
  const html = renderToStaticMarkup(
    <FaqPlacement groups={placementFaqGroups({ faqSets: [setA, setB], faqSetCount: 2 })} siteBase="/it/acme" designSystem={null} />,
  )

  it('server-renders every rich answer, lists included', () => {
    expect(html).toContain('<p class="mb-3 last:mb-0">Online, dal sito.</p>')
    expect(html).toMatch(/<ul[^>]*><li>Oppure al telefono.<\/li><\/ul>/)
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3)
  })

  it('resolves internal links and renders an unavailable one as plain text', () => {
    expect(html).toMatch(/<a href="\/it\/acme\/menu"[^>]*>Il menu<\/a>/)
    expect(html).toContain('Archivio')
    expect(html).not.toMatch(/<a[^>]*>Archivio<\/a>/)
  })

  it('heads each group with its set title when several sets show', () => {
    expect(html).toContain('Prenotazioni</h3>')
    expect(html).toContain('Pagamenti</h3>')
    const off = renderToStaticMarkup(
      <FaqPlacement groups={placementFaqGroups({ faqSets: [setA, setB], faqSetCount: 2 })} showSetTitles={false} siteBase="/it/acme" designSystem={null} />,
    )
    expect(off).not.toContain('</h3>')
    const one = renderToStaticMarkup(<FaqPlacement groups={placementFaqGroups({ faqSets: [setA], faqSetCount: 1 })} siteBase="" designSystem={null} />)
    expect(one).not.toContain('</h3>')
  })

  it('renders nothing for no groups', () => {
    expect(renderToStaticMarkup(<FaqPlacement groups={[]} siteBase="" designSystem={null} />)).toBe('')
  })
})

describe('FAQ section', () => {
  const section = { _type: 'faqSection', _key: 's', title: 'Domande', subtitle: 'Le risposte rapide', faqSets: [setA], faqSetCount: 1, items: [{ _key: 'old', question: 'Vecchia?', answer: 'Nascosta.' }] } as unknown as FAQSectionType

  it('renders its sets with title and subtitle, never the legacy items once a set is chosen', () => {
    const html = renderToStaticMarkup(<FAQSection section={section} surface={'transparent' as never} designSystem={null} siteBase="/it/acme" />)
    expect(html).toContain('Le risposte rapide')
    expect(html).toContain('Come prenoto?')
    expect(html).not.toContain('Vecchia?')
  })

  it('renders nothing when no question is visible', () => {
    const empty = { ...section, faqSets: [null], faqSetCount: 1 } as unknown as FAQSectionType
    expect(renderToStaticMarkup(<FAQSection section={empty} surface={'transparent' as never} designSystem={null} />)).toBe('')
  })
})

describe('PostArticle FAQs', () => {
  const base = {
    _id: 'p1', projectSlug: 'acme', title: 'Titolo',
    body: [block('Testo del corpo.')],
    faqSets: [setB], faqSetCount: 1,
  } as unknown as Post
  const render = (post: Post, showFaq: boolean) =>
    renderToStaticMarkup(
      <PostArticle post={post} relatedPosts={[]} designSystem={null} locale="it" siteBase="/it/acme" backLabel="Back" backUrl="/it/acme" showGallery showFaq={showFaq} />,
    )

  it('shows the FAQs after the body with the localized default heading', () => {
    const html = render(base, true)
    expect(html).toContain('Domande frequenti</h2>')
    expect(html.indexOf('Testo del corpo.')).toBeLessThan(html.indexOf('Accettate carte?'))
  })

  it('uses the post’s own title and subtitle when set', () => {
    const html = render({ ...base, faqTitle: 'Chiedimi', faqSubtitle: 'Due righe' } as Post, true)
    expect(html).toContain('Chiedimi</h2>')
    expect(html).toContain('Due righe')
  })

  it('shows nothing when the FAQ module is not installed', () => {
    const html = render(base, false)
    expect(html).not.toContain('Accettate carte?')
    expect(html).not.toContain('Domande frequenti')
  })
})
