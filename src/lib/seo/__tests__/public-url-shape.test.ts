import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the shape of every PUBLIC URL the app emits.
 *
 * The defect these lock out: ten metadata functions each built their canonical
 * by hand as `https://${customDomain}/${locale}/${tenantId}/…`, putting the
 * internal routing segment into the address given to search engines. Both
 * spellings answer on a custom domain, so nothing broke and nothing failed —
 * `livener.net/en` simply told Google its canonical was
 * `https://livener.net/en/livener` for as long as the site had been live.
 *
 * There was no test for it, which is precisely why it survived. These two are
 * structural: they read the route files rather than the rendered output, so
 * they catch a regression at the moment it is typed rather than in production.
 */

const ROUTES_ROOT = 'src/app'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full)
  }
  return out
}

const routeFiles = walk(ROUTES_ROOT).filter((f) => !f.includes('__tests__'))

describe('public URLs never carry the project segment', () => {
  /**
   * The exact interpolation that caused it. Matches a template literal that
   * places `${tenantId}` (or `${tenantSlug}`) straight after a locale in a URL
   * built on a canonical base.
   */
  const OFFENDING = /\$\{(?:canonicalBase|origin|tenantBase)\}\/\$\{\w+\}\/\$\{tenant(?:Id|Slug)\}/

  it('no route file interpolates the project segment into a canonical base', () => {
    const offenders = routeFiles.filter((f) => OFFENDING.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the metadata routes build their URLs with the shared helper', () => {
    // Every file that emits `alternates` must go through @/lib/seo/canonical,
    // so the shape is decided in one place instead of ten.
    const withAlternates = routeFiles.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return src.includes('alternates:') && src.includes('customDomain')
    })
    expect(withAlternates.length).toBeGreaterThan(0)
    for (const file of withAlternates) {
      expect(readFileSync(file, 'utf8'), file).toContain('@/lib/seo/canonical')
    }
  })
})

describe('the sitemap is scoped to the host it is served on', () => {
  const src = readFileSync('src/app/sitemap.ts', 'utf8')

  it('filters projects by the request host', () => {
    // Without this line the file emits every tenant's URLs on every domain —
    // 31 entries across five client domains, on all five of them.
    expect(src).toContain('normalizeHost(customDomain) !== requestHost')
  })

  it('reads the request host rather than assuming one', () => {
    expect(src).toContain("(await headers()).get('host')")
  })

  it('builds its entries with the shared canonical helper', () => {
    expect(src).toContain("from '@/lib/seo/canonical'")
    expect(src).not.toContain('${tenantSlug}')
  })
})

describe('llms.txt is host-scoped and staging-gated', () => {
  const src = readFileSync('src/app/llms.txt/route.ts', 'utf8')

  it('matches the project on the request host', () => {
    expect(src).toContain('customDomain == $host')
  })

  it('404s on staging and outside production, like the empty sitemap', () => {
    expect(src).toContain('isStagingHost(host)')
    expect(src).toContain('if (!isProduction()) return NOT_FOUND')
  })
})
