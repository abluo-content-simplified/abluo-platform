import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HeroSection } from '@/components/sections/HeroSection'
import type { HeroSection as HeroSectionType, DesignSystem } from '@/lib/sanity/types'

/**
 * A multi-line headline must still read as WORDS.
 *
 * Found live on tmz.it: the hero renders one block element per line, JSX strips
 * the whitespace between sibling elements, and the h1's text came out as
 * "ThomasMarcoZimmermann" — one unsplittable token where the page's strongest
 * on-page signal should be. Crawlers, screen readers and answer engines all
 * read textContent, so all three got the nonsense version.
 *
 * Same class of bug as the clients row, which rendered thirty names as one
 * 7079px-wide token for exactly the same reason.
 */

const designSystem = { layout: { accentRail: true } } as unknown as DesignSystem

function h1TextOf(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  if (!m) return ''
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

const hero = (variant: string) =>
  ({
    _type: 'heroSection',
    _key: 'hero',
    headline: 'Thomas\nMarco\nZimmermann',
    heroVariant: variant,
  }) as unknown as HeroSectionType

describe('a multi-line hero headline reads as separate words', () => {
  it.each(['display', 'standard'])('%s variant keeps the words apart', (variant) => {
    const html = renderToStaticMarkup(
      <HeroSection section={hero(variant)} surface={'transparent' as never} designSystem={designSystem} />,
    )
    const text = h1TextOf(html)
    expect(text).toBe('Thomas Marco Zimmermann')
    // The exact failure, stated so a regression names itself.
    expect(text).not.toBe('ThomasMarcoZimmermann')
  })

  it('a single-line headline is unchanged — no stray separator', () => {
    const section = { ...hero('display'), headline: 'Thomas Marco Zimmermann' } as HeroSectionType
    const html = renderToStaticMarkup(
      <HeroSection section={section} surface={'transparent' as never} designSystem={designSystem} />,
    )
    expect(h1TextOf(html)).toBe('Thomas Marco Zimmermann')
  })
})
