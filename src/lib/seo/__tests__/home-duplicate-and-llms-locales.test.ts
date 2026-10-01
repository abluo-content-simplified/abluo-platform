// ─── Two structural guards for the discoverability pass ──────────────────────
//
// Both rules live inside route files that cannot be imported in a unit test
// (they are server components with `force-dynamic` and top-level Sanity
// clients). The existing `public-url-shape.test.ts` sets the precedent: read
// the route source and assert the rule is still expressed there. A structural
// test is weaker than a behavioural one, but it is far stronger than nothing,
// and it fails loudly when someone deletes the branch during a refactor.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const SLUG_ROUTE = 'src/app/[locale]/(website)/[tenant]/[...slug]/page.tsx'
const LLMS_ROUTE = 'src/app/llms.txt/route.ts'
const SITEMAP = 'src/app/sitemap.ts'

describe('the home page is not reachable at its own slug', () => {
  const src = read(SLUG_ROUTE)

  it('redirects when the resolved page is the home page', () => {
    expect(src).toMatch(/pageType === 'home'/)
    // The redirect must be permanent: these URLs were indexable.
    const branch = src.slice(src.indexOf("pageType === 'home'"))
    expect(branch.slice(0, 900)).toMatch(/permanentRedirect\(/)
  })

  it('builds the redirect target the same way the canonical is built', () => {
    // A bare `/${locale}/${tenantId}` target would put the project segment in
    // a public URL on a custom domain — the defect 26014fa removed from the
    // canonical. canonicalUrl() is the single place that shape is decided.
    const branch = src.slice(src.indexOf("pageType === 'home'"))
    expect(branch.slice(0, 900)).toMatch(/canonicalOrigin\(/)
    expect(branch.slice(0, 900)).toMatch(/canonicalUrl\(/)
  })

  it('only builds an absolute target on production', () => {
    // Off production the site is reached by path on a platform host. An
    // absolute target built from `customDomain` sent preview visitors to the
    // live site — measured on preview.abluo.app before this gate existed:
    //   /en/nologo/home        -> https://nologo.cloud/en
    //   /it/studiomartegani/home -> https://studiomartegani.com/it
    const branch = src.slice(src.indexOf("pageType === 'home'"))
    expect(branch.slice(0, 900)).toMatch(/isProduction\(\) \? canonicalOrigin\(/)
  })

  it('agrees with the sitemap, which already excludes the home page', () => {
    expect(read(SITEMAP)).toMatch(/pageType, ""\) != "home"|pageType.*!=.*"home"/)
  })
})

describe('llms.txt lists every published language', () => {
  const src = read(LLMS_ROUTE)

  it('reads the whole localized objects rather than one locale projection', () => {
    // The old query resolved title/slug/description for $locale only, so six
    // of seven languages were invisible to any model reading the file.
    expect(src).not.toMatch(/"slug": slug\[\$locale\]\.current/)
    expect(src).toMatch(/"titles": title/)
    expect(src).toMatch(/"slugs": slug/)
    expect(src).toMatch(/"descriptions": seoDescription/)
  })

  it('emits a section per non-default locale', () => {
    expect(src).toMatch(/otherLocales/)
    expect(src).toMatch(/## Pages \(\$\{loc\}\)/)
  })

  it('skips a page that has no slug in a given language', () => {
    // An hreflang-style rule: a link to a page that does not exist in that
    // language is worse than no link.
    expect(src).toMatch(/if \(!isHome && !slug\) continue/)
  })

  it('identifies the home page by pageType, not by the literal slug "home"', () => {
    expect(src).not.toMatch(/page\.slug === 'home'/)
    expect(src).toMatch(/page\.pageType === 'home'/)
  })
})
