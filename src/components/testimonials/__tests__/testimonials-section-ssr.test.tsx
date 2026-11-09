/**
 * ADR-048 D5/D6/D7 — the testimonials section server-renders short cards
 * (3-line clamp, "Read more" only when there is more), names or the localized
 * "Anonymous", the language notes, the disclosure line (on by default), the
 * carousel semantics, and nothing at all without testimonials. Never JSON-LD.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TestimonialsSection } from '@/components/sections/TestimonialsSection'
import { normalizeTestimonial, type TestimonialRaw } from '@/lib/modules/testimonials/projection'
import type { TestimonialsSection as Section } from '@/lib/sanity/types'

type Opts = Omit<Partial<TestimonialRaw>, 'body' | 'abstract' | 'context'> & { body?: string; abstract?: string; context?: string; locale?: string; machine?: boolean }
const raw = (id: string, o: Opts = {}): TestimonialRaw => ({
  publicId: id,
  displayName: o.displayName === undefined ? `Person ${id}` : o.displayName,
  anonymous: o.anonymous ?? false,
  rating: o.rating ?? null,
  givenOn: o.givenOn ?? null,
  source: o.source ?? null,
  sourceUrl: o.sourceUrl ?? null,
  age: o.age ?? null,
  originalLocale: o.originalLocale ?? 'en',
  context: o.context ? { text: o.context, locale: o.locale ?? 'en', machine: false } : null,
  abstract: o.abstract ? { text: o.abstract, locale: o.locale ?? 'en', machine: false } : null,
  body: { text: o.body ?? 'Short and sweet.', locale: o.locale ?? 'en', machine: o.machine ?? false },
})

const LONG = 'A very long testimonial. '.repeat(20)

function section(items: TestimonialRaw[], over: Partial<Section> = {}, pageLocale = 'en'): Section {
  return {
    _type: 'testimonialsSection',
    _key: 'k',
    title: 'Kind words',
    testimonialItems: items.flatMap((r) => {
      const t = normalizeTestimonial(r, pageLocale)
      return t ? [t] : []
    }),
    ...over,
  }
}
const render = (s: Section, locale = 'en') => renderToStaticMarkup(<TestimonialsSection section={s} surface="surface1" designSystem={null} locale={locale} />)

describe('TestimonialsSection', () => {
  it('renders nothing without testimonials', () => {
    expect(render(section([]))).toBe('')
    expect(render({ _type: 'testimonialsSection', _key: 'k' })).toBe('')
  })

  it('renders clamped cards with name and context, as a carousel by default', () => {
    const html = render(section([raw('a', { body: LONG, context: 'Hatha course' }), raw('b'), raw('c')]))
    expect(html).toContain('Kind words')
    expect(html).toContain('line-clamp-3')
    expect(html).toContain('Person a')
    expect(html).toContain('Hatha course')
    expect(html).toContain('aria-roledescription="carousel"')
    expect(html).toContain('aria-roledescription="slide"')
    expect(html).toContain('aria-label="2 of 3"')
    expect(html).toContain('aria-label="Previous testimonials"')
    expect(html).toContain('aria-label="Next testimonials"')
  })

  it('offers "Read more" only when the card can cut the text', () => {
    const long = render(section([raw('a', { body: LONG })]))
    expect(long).toContain('>Read more<')
    const short = render(section([raw('a')]))
    expect(short).not.toContain('Read more')
    const withAbstract = render(section([raw('a', { abstract: 'Gist.', body: 'Gist, and a bit more.' })]))
    expect(withAbstract).toContain('>Read more<')
    expect(withAbstract).toContain('Gist.')
  })

  it('renders the grid layout without carousel semantics', () => {
    const html = render(section([raw('a'), raw('b')], { layout: 'grid' }))
    expect(html).toContain('<ul')
    expect(html).not.toContain('aria-roledescription="carousel"')
  })

  it('uses the localized label for anonymous testimonials and never prints a name', () => {
    const html = render(section([raw('a', { anonymous: true, displayName: null })], {}, 'it'), 'it')
    expect(html).toContain('Anonimo')
    expect(html).not.toContain('Person a')
  })

  it('shows the disclosure by default, hides it when switched off', () => {
    expect(render(section([raw('a')]))).toContain('Selected testimonials, published with permission.')
    expect(render(section([raw('a')], { showDisclosure: true }))).toContain('published with permission')
    expect(render(section([raw('a')], { showDisclosure: false }))).not.toContain('published with permission')
    expect(render(section([raw('a')], {}, 'it'), 'it')).toContain('Testimonianze selezionate')
  })

  it('shows rating, date and source only when the section asks for them', () => {
    const r = raw('a', { rating: 4, givenOn: '2026-03-05', source: 'google', sourceUrl: 'https://g.page/x' })
    const off = render(section([r]))
    expect(off).not.toContain('4 out of 5 stars')
    expect(off).not.toContain('on Google')
    const on = render(section([r], { showRating: true, showDate: true, showSource: true }))
    expect(on).toContain('aria-label="4 out of 5 stars"')
    expect(on).toContain('5 March 2026')
    expect(on).toMatch(/<a href="https:\/\/g\.page\/x"[^>]*rel="noopener noreferrer"[^>]*>on Google<\/a>/)
    expect(on).not.toMatch(/verified/i)
  })

  it('does not link an unsafe source address', () => {
    const html = render(section([raw('a', { source: 'google', sourceUrl: 'javascript:alert(1)' })], { showSource: true }))
    expect(html).toContain('on Google')
    expect(html).not.toContain('javascript:')
  })

  it('words the language notes in the visitor language', () => {
    const translated = render(section([raw('a', { locale: 'en', machine: true, originalLocale: 'fr' })]))
    expect(translated).toContain('Translated from French')
    const other = render(section([raw('a', { locale: 'fr', originalLocale: 'fr' })], {}, 'en'))
    expect(other).toContain('(in French)')
    expect(other).toContain('lang="fr"')
    const plain = render(section([raw('a')]))
    expect(plain).not.toContain('Translated')
    expect(plain).not.toContain('(in ')
  })

  it('emits no structured data (D7)', () => {
    const html = render(section([raw('a', { rating: 5 })], { showRating: true }))
    expect(html).not.toContain('application/ld+json')
    expect(html).not.toContain('schema.org')
  })
})
