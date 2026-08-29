import { describe, it, expect } from 'vitest'
import { fontToGoogleParam, buildGoogleFontsUrl, FONT_WEIGHT_PARAMS, DEFAULT_FONT_WEIGHTS } from '@/lib/google-fonts'

describe('fontToGoogleParam', () => {
  it('fetches Syne up to 800 — the weight the display headline actually uses', () => {
    expect(fontToGoogleParam('Syne')).toBe('Syne:wght@400;500;600;700;800')
  })

  it('fetches DM Sans from 300', () => {
    expect(fontToGoogleParam('DM Sans')).toBe('DM+Sans:wght@300;400;500;600;700')
  })

  it('falls back to the default range for an unmapped family', () => {
    expect(fontToGoogleParam('Space Grotesk')).toBe(`Space+Grotesk:${DEFAULT_FONT_WEIGHTS}`)
  })

  it('leaves the mapped families that predate this change untouched', () => {
    expect(fontToGoogleParam('Poppins')).toBe('Poppins:wght@300;400;500;600;700')
    expect(fontToGoogleParam('Barlow Condensed')).toBe('Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;1,400')
  })

  it('never requests a weight outside a mapped family — no entry exceeds 900', () => {
    for (const params of Object.values(FONT_WEIGHT_PARAMS)) {
      for (const w of params.matchAll(/(?:^|[;,@])(\d{3})(?=[;,]|$)/g)) {
        expect(Number(w[1])).toBeLessThanOrEqual(900)
      }
    }
  })
})

describe('buildGoogleFontsUrl', () => {
  it('emits the No!Logo pairing with Syne 800', () => {
    expect(buildGoogleFontsUrl('Syne', 'DM Sans')).toBe(
      'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap',
    )
  })

  it('requests one family when heading and body are the same', () => {
    expect(buildGoogleFontsUrl('Syne', 'Syne')).toBe(
      'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap',
    )
  })
})
