import { describe, it, expect } from 'vitest'
import { headingFamily, firstUsableFontUrl, FALLBACK_FAMILY } from '../og-font'

/**
 * The generated social card (app/[locale]/(website)/[tenant]/opengraph-image.tsx).
 *
 * The fragile parts are pure, so they are tested here rather than by rendering
 * a PNG: which family to ask Google for, and parsing the TrueType src out of
 * the css2 response. Satori cannot read WOFF2, so if that parse ever starts
 * matching a woff2 src the cards silently stop rendering.
 */

describe('headingFamily', () => {
  it('takes googleFont when the source is google', () => {
    expect(headingFamily({ source: 'google', googleFont: 'Oswald', libraryFont: null })).toBe('Oswald')
  })

  // Geist and Barlow Condensed are stored as `library` but are published on
  // Google Fonts, which is why one fetch path serves both sources.
  it('takes libraryFont when the source is library', () => {
    expect(headingFamily({ source: 'library', googleFont: null, libraryFont: 'Barlow Condensed' })).toBe('Barlow Condensed')
  })

  it.each([
    [null],
    [undefined],
    [{ source: 'library', googleFont: null, libraryFont: null }],
    [{ source: 'google', googleFont: '   ', libraryFont: null }],
  ])('is null when no usable family is declared (%#)', (input) => {
    expect(headingFamily(input as never)).toBeNull()
  })

  it('has a fallback family to fall back TO', () => {
    expect(FALLBACK_FAMILY.length).toBeGreaterThan(0)
  })
})

describe('firstUsableFontUrl', () => {
  const TTF = `@font-face{font-family:'Oswald';font-weight:700;src:url(https://fonts.gstatic.com/s/oswald/v53/x.ttf) format('truetype');}`
  const WOFF = `@font-face{font-family:'Oswald';font-weight:700;src:url(https://fonts.gstatic.com/s/oswald/v53/x.woff) format('woff');}`
  const WOFF2 = `@font-face{font-family:'Oswald';src:url(https://fonts.gstatic.com/s/oswald/v53/x.woff2) format('woff2');}`

  it('finds a truetype source', () => {
    expect(firstUsableFontUrl(TTF)).toBe('https://fonts.gstatic.com/s/oswald/v53/x.ttf')
  })

  // What Google ACTUALLY returns for the old-Safari user-agent. Verified
  // 2026-10-13 for all six families in use: every one was woff, none truetype.
  // Matching truetype alone matched nothing and 503'd every card.
  it('finds a woff source, which is what the endpoint really serves', () => {
    expect(firstUsableFontUrl(WOFF)).toBe('https://fonts.gstatic.com/s/oswald/v53/x.woff')
  })

  // The one format Satori cannot parse. Matching it would throw at render time.
  it('never matches woff2', () => {
    expect(firstUsableFontUrl(WOFF2)).toBeNull()
  })

  it('prefers truetype when the response offers both', () => {
    expect(firstUsableFontUrl(WOFF + TTF)).toBe('https://fonts.gstatic.com/s/oswald/v53/x.ttf')
  })

  it('handles double quotes in the format(), as the endpoint sometimes emits', () => {
    expect(firstUsableFontUrl(`src:url(https://x/y.ttf) format("truetype");`)).toBe('https://x/y.ttf')
    expect(firstUsableFontUrl(`src:url(https://x/y.woff) format("woff");`)).toBe('https://x/y.woff')
  })

  it('is null for junk', () => {
    expect(firstUsableFontUrl('')).toBeNull()
    expect(firstUsableFontUrl('not css at all')).toBeNull()
  })
})
