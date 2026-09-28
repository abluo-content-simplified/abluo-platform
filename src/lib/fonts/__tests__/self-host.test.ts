import { describe, expect, it } from 'vitest'
import { rewriteFontUrls, upstreamCssUrl, upstreamFileUrl } from '@/lib/fonts/self-host'
import { buildGoogleFontsUrl } from '@/lib/google-fonts'

const q = (s: string) => new URLSearchParams(s)

describe('self-hosted fonts', () => {
  it('the site links to OUR endpoint, never to Google', () => {
    const url = buildGoogleFontsUrl('Poppins', 'Barlow Condensed')
    expect(url.startsWith('/api/fonts/css?')).toBe(true)
    expect(url).not.toContain('googleapis')
  })
  it('round-trips what buildGoogleFontsUrl emits to the Google css2 URL', () => {
    const url = buildGoogleFontsUrl('Poppins', 'Barlow Condensed')
    const up = upstreamCssUrl(new URL(url, 'https://x.test').searchParams)
    expect(up).toBe(
      'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap'
    )
  })
  it('is not an open proxy', () => {
    expect(upstreamCssUrl(q(''))).toBeNull()
    expect(upstreamCssUrl(q('family=Poppins&url=https://evil.test'))).toBeNull()
    expect(upstreamCssUrl(q('family=<script>'))).toBeNull()
    expect(upstreamCssUrl(q('family=Poppins&display=evil'))).toBeNull()
  })
  it('rewrites every gstatic URL to our file endpoint', () => {
    const css = "src: url(https://fonts.gstatic.com/s/poppins/v22/a.woff2) format('woff2');"
    expect(rewriteFontUrls(css)).toBe("src: url(/api/fonts/file/s/poppins/v22/a.woff2) format('woff2');")
  })
  it('file paths: fonts only, no traversal', () => {
    expect(upstreamFileUrl(['s', 'poppins', 'v22', 'a.woff2'])).toBe('https://fonts.gstatic.com/s/poppins/v22/a.woff2')
    expect(upstreamFileUrl(['s', '..', 'a.woff2'])).toBeNull()
    expect(upstreamFileUrl(['s', 'poppins', 'evil.js'])).toBeNull()
    expect(upstreamFileUrl([])).toBeNull()
  })
})
