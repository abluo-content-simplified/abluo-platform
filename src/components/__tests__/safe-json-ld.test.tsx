import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArticleJsonLd, CollectionJsonLd } from '../JsonLd'
import { safeJsonLd } from '@/lib/seo/safe-json-ld'

// Client-dashboard users write post titles/excerpts (ADR-025), which the
// website emits inside <script type="application/ld+json">. A title must never
// be able to close that script element.
const HOSTILE = [
  '</script><script>alert(1)</script>',
  '</SCRIPT ><img src=x onerror=alert(1)>',
  '<!-- <script>',
  'a & b > c \u2028 d \u2029 e',
  '"quotes" \\ backslash',
]

/** The text content of every inline JSON-LD script in `html`. */
function payloads(html: string): string[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])
}

describe('safeJsonLd', () => {
  it('escapes < > & U+2028 U+2029 and round-trips through JSON.parse', () => {
    for (const s of HOSTILE) {
      const value = { headline: s, nested: [{ name: s }] }
      const out = safeJsonLd(value)
      expect(out).not.toMatch(new RegExp('[<>&\u2028\u2029]'))
      expect(JSON.parse(out)).toEqual(value)
    }
  })

  it('ArticleJsonLd: a hostile headline/description cannot close the script', () => {
    for (const s of HOSTILE) {
      const html = renderToStaticMarkup(
        <ArticleJsonLd origin="https://example.com" locale="it" pathSegments={['blog', 'x']} headline={s} description={s} />
      )
      const [payload, ...rest] = payloads(html)
      expect(rest).toHaveLength(0)
      expect(payload.toLowerCase()).not.toContain('</script')
      expect(payload).not.toContain('<')
      const parsed = JSON.parse(payload)
      expect(parsed.headline).toBe(s)
      expect(parsed.description).toBe(s)
    }
  })

  it('CollectionJsonLd: hostile item names cannot close the script', () => {
    for (const s of HOSTILE) {
      const html = renderToStaticMarkup(
        <CollectionJsonLd
          origin="https://example.com"
          locale="it"
          pathSegments={['news']}
          name={s}
          description={s}
          items={[{ pathSegments: ['news', 'a'], name: s }]}
        />
      )
      const [payload, ...rest] = payloads(html)
      expect(rest).toHaveLength(0)
      expect(payload).not.toContain('<')
      const parsed = JSON.parse(payload)
      expect(parsed.name).toBe(s)
      expect(parsed.mainEntity.itemListElement[0].name).toBe(s)
    }
  })

  it('no inline JSON emitter in src/ uses a bare JSON.stringify', () => {
    const root = resolve(__dirname, '../..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(p)
        } else if (/\.(tsx?|jsx?)$/.test(name)) {
          const src = readFileSync(p, 'utf8')
          if (/__html:\s*JSON\.stringify/.test(src)) offenders.push(p)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
