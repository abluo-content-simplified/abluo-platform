import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TextSection } from '@/components/sections/TextSection'
import type { TextSection as TextSectionType } from '@/lib/sanity/types'

/**
 * textSection — optional image beside the text (CYCE "Yoga, all week long").
 *
 * Without an image the markup must be byte-for-byte what the section rendered
 * before the field existed: BASELINE below was captured from the pre-change
 * component with the same fixture.
 */

const content = [
  { _type: 'block', _key: 'b1', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's1', text: 'Hello', marks: [] }] },
]

const base = { _type: 'textSection', _key: 'k', eyebrow: 'E', title: 'Yoga', content } as unknown as TextSectionType

const image = {
  asset: { _ref: 'image-364d66c939d3243a1c318e50e3e277f6057fe018-1677x2400-jpg', _type: 'reference' },
  hotspot: { x: 0.3, y: 0.25, height: 0.5, width: 0.5 },
  crop: { top: 0, bottom: 0, left: 0, right: 0 },
}

const BASELINE = "<section class=\"px-6 py-[calc(var(--section-padding-y,120px)*0.6)] md:px-10 md:py-[calc(var(--section-padding-y,120px)*0.8)] lg:px-16 lg:py-[var(--section-padding-y,120px)]\"><div class=\"mx-auto w-full\" style=\"max-width:var(--layout-max-content-width, 1120px)\"><div class=\"max-w-[680px]\"><div style=\"opacity:0;transform:translateY(40px)\"><p class=\"mb-4 text-xs font-medium uppercase tracking-[0.2em]\" style=\"color:var(--color-text-muted);font-family:var(--font-body)\">E</p><h2 class=\"mb-10 [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]\" style=\"color:var(--color-text-primary);font-family:var(--font-heading);font-size:var(--font-size-h2, var(--fs-h2));font-weight:var(--font-weight-h2, 600);line-height:var(--line-height-h2, 1.375);letter-spacing:var(--letter-spacing-h2, -0.025em)\">Yoga</h2></div><div style=\"opacity:0;transform:translateY(40px)\"><div class=\"space-y-4\"><p class=\"text-base leading-relaxed\" style=\"color:var(--color-text-secondary)\">Hello</p></div></div></div></div></section>"

const render = (s: TextSectionType) =>
  renderToStaticMarkup(<TextSection section={s} surface={'transparent' as never} designSystem={null} />)

describe('textSection without an image', () => {
  it('renders byte-for-byte as before the image field existed', () => {
    expect(render(base)).toBe(BASELINE)
  })

  it('an image object with no asset is treated as no image', () => {
    expect(render({ ...base, image: {} as never, mediaPosition: 'left' })).toBe(BASELINE)
  })
})

describe('textSection with an image', () => {
  it('renders text then image in a two-column grid (image right by default)', () => {
    const html = render({ ...base, image: image as never, imageAlt: 'Yoga practice' })
    expect(html).toContain('md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]')
    expect(html).not.toContain('md:order-first')
    // Phone order: the text comes before the image in the DOM.
    expect(html.indexOf('Hello')).toBeLessThan(html.indexOf('<img'))
    expect(html).toContain('alt="Yoga practice"')
    expect(html).toContain('364d66c939d3243a1c318e50e3e277f6057fe018-1677x2400.jpg')
    // Hotspot becomes the object-position so the cover crop keeps the subject.
    expect(html).toContain('object-position:30% 25%')
    expect(html).toContain('rounded-[var(--radius-lg)]')
  })

  it('imagePosition "left" (projected as mediaPosition) moves the image first on desktop only', () => {
    const html = render({ ...base, image: image as never, mediaPosition: 'left' })
    expect(html).toContain('md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')
    expect(html).toContain('md:order-first')
    // DOM order unchanged → on phones the image still follows the text.
    expect(html.indexOf('Hello')).toBeLessThan(html.indexOf('<img'))
  })

  it('reads the raw imagePosition when mediaPosition is absent', () => {
    const html = render({ ...base, image: image as never, imagePosition: 'left' })
    expect(html).toContain('md:order-first')
  })

  it('explicit "right" matches the default', () => {
    const def = render({ ...base, image: image as never })
    const right = render({ ...base, image: image as never, mediaPosition: 'right' })
    expect(right).toBe(def)
  })

  it('respects the authored crop (Sanity rect in the URL)', () => {
    const cropped = { ...image, crop: { top: 0.1, bottom: 0, left: 0, right: 0 } }
    expect(render({ ...base, image: cropped as never })).toContain('rect=0,240,1677,2160')
  })

  it('no authored alt renders an empty alt', () => {
    expect(render({ ...base, image: image as never })).toContain('alt=""')
  })
})
