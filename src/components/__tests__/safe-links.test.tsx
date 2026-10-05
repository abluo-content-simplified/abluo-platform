import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import { safeLinkHref } from '@/lib/links/safe-href'

const UNSAFE = [
  'javascript:alert(1)',
  ' JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  '//evil.example/x',
  '/\\evil.example',
  'https://',
  'ftp://x.it',
]
const SAFE = ['https://studio.it/a?b=1#c', 'http://x.it', '/contatti', 'mailto:a@b.it', 'tel:+39054412', '#prenota']

function body(href: unknown, blank?: boolean) {
  return [
    {
      _type: 'block',
      _key: 'b',
      style: 'normal',
      markDefs: [{ _type: 'link', _key: 'l', href, ...(blank === undefined ? {} : { blank }) }],
      children: [{ _type: 'span', _key: 's', text: 'Click', marks: ['l'] }],
    },
  ]
}

describe('safeLinkHref', () => {
  it('refuses unsafe schemes and malformed targets', () => {
    for (const h of UNSAFE) expect(safeLinkHref(h), h).toBeNull()
    expect(safeLinkHref(undefined)).toBeNull()
    expect(safeLinkHref(42)).toBeNull()
  })
  it('keeps http(s), mailto, tel, site-relative and fragment links', () => {
    for (const h of SAFE) expect(safeLinkHref(h), h).toBe(h)
  })
})

describe('article body links (blog + news)', () => {
  const render = (href: unknown, blank?: boolean) =>
    renderToStaticMarkup(<PortableText value={body(href, blank) as never} components={articlePortableTextComponents} />)

  it('an unsafe href renders the text without a link', () => {
    for (const h of UNSAFE) {
      const html = render(h)
      expect(html, h).not.toContain('<a')
      expect(html).toContain('Click')
    }
  })
  it('a safe href renders a link; new tab follows the rule (external yes, internal no), blank overrides', () => {
    // Links round 2: external sites open in a new tab automatically …
    const external = render('https://studio.it')
    expect(external).toContain('href="https://studio.it"')
    expect(external).toContain('target="_blank"')
    expect(external).toContain('rel="noopener noreferrer"')
    // … site pages, mailto and tel do not …
    for (const h of ['/contatti', 'mailto:a@b.it', 'tel:+39054412', '#prenota']) expect(render(h), h).not.toContain('target=')
    // … and `blank` overrides either way.
    expect(render('https://studio.it', false)).not.toContain('target=')
    const blank = render('/contatti', true)
    expect(blank).toContain('target="_blank"')
    expect(blank).toContain('rel="noopener noreferrer"')
  })
})

describe('section rich-text renderers', () => {
  it('Text / MediaContent / Team sections gate hrefs through safeLinkHref', () => {
    for (const f of ['TextSection.tsx', 'MediaContentSection.tsx', 'TeamSection.tsx']) {
      const src = readFileSync(resolve(__dirname, '../sections', f), 'utf8')
      expect(src, f).toContain('safeLinkHref(linkDef.href)')
      expect(src, f).not.toContain('href={linkDef.href}')
    }
  })
})
