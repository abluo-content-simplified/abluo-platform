/**
 * ADR-040 B2.2 — "protecting a page means protecting its content everywhere":
 * metadata, structured data, sitemap, llms.txt, navigation, internal links,
 * public APIs and caching. Queries are EXECUTED with groq-js against fixtures;
 * route wiring is checked from source so a refactor cannot quietly bypass the
 * gate.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { evaluate, parse } from 'groq-js'
import { SITEMAP_PAGES_QUERY } from '@/lib/seo/sitemap-queries'
import { LLMS_PAGES_QUERY } from '@/lib/seo/llms'
import { NAV_LINK_FIELDS } from '@/lib/sanity/queries'
import { isRenderableNavLink, navAccessMode, resolveNavLink, resolveNavLinks } from '@/lib/sanity/nav-links'
import type { NavLink } from '@/lib/sanity/types'
import { closedPaths, isListable, type ListedPage } from '../listing'
import { deniedPageMetadata, grantedPageMetadata, RESTRICTED_ROBOTS } from '../page-metadata'
import { ACCESS_MESSAGES_FOR_TEST, getAccessMessages } from '@/lib/i18n/access-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

const SRC = resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
const G = '11111111-1111-4111-8111-111111111111'
const SECRET = 'SECRET'

const page = (id: string, slug: string, access?: unknown, extra: Record<string, unknown> = {}) => ({
  _id: id,
  _type: 'page',
  projectSlug: 'site-a',
  pageType: 'landing',
  title: { en: `${SECRET} title ${id}` },
  seoDescription: { en: `${SECRET} description ${id}` },
  slug: { en: { _type: 'slug', current: slug } },
  sections: [{ _type: 'photoGallerySection', _key: 'g', galleries: [] }],
  ...(access === undefined ? {} : { access }),
  ...extra,
})
const DATASET = [
  page('about', 'about'),
  page('members', 'members', { visibility: 'restricted', groups: [G], navigation: 'locked' }),
  page('child', 'members/timetable'),
  page('staff', 'staff', { visibility: 'restricted', groups: [G] }),
  page('broken', 'broken', { visibility: 'Restricted' }),
  page('membership', 'membership'), // prefix of "members" without a slash: stays public
]
const inline = (q: string, p: Record<string, unknown>) =>
  q.replace(/\[\$locale\]/g, `[${JSON.stringify(p.locale)}]`).replace(/\[\$defaultLocale\]/g, `[${JSON.stringify(p.defaultLocale)}]`)
async function run(query: string, params: Record<string, unknown> = {}, dataset: unknown[] = DATASET) {
  return (await evaluate(parse(inline(query, params)), { dataset, params })).get()
}

// ── Metadata, titles, Open Graph, structured data ────────────────────────────

describe('metadata of a closed page', () => {
  const m = deniedPageMetadata({ locale: 'it', siteName: 'Scuola' })
  it('names only the site and the generic "members only" text', () => {
    expect(m.title).toBe(`${getAccessMessages('it').restrictedTitle} — Scuola`)
    expect(m.description).toBeNull()
    expect(m.alternates).toBeNull() // no canonical, no hreflang (they would list its slugs)
    expect(m.openGraph).toEqual({ title: m.title, siteName: 'Scuola', type: 'website' }) // no page image, no url
    expect(JSON.stringify(m)).not.toMatch(/members|timetable/i)
  })
  it('is noindex, nofollow, noarchive, noimageindex', () => {
    expect(m.robots).toEqual(RESTRICTED_ROBOTS)
    expect(RESTRICTED_ROBOTS).toMatchObject({ index: false, follow: false, nocache: true, googleBot: { index: false, noimageindex: true } })
  })
  it('a page a member may see keeps its metadata but is never indexable', () => {
    const g = grantedPageMetadata({ title: 'T', robots: { index: true, follow: true } })
    expect(g.robots).toEqual(RESTRICTED_ROBOTS)
    expect(g.title).toBe('T')
  })
  it('the route returns the denied metadata BEFORE reading any page field, and no JSON-LD when closed', () => {
    const route = read('app/[locale]/(website)/[tenant]/[...slug]/page.tsx')
    const meta = route.slice(route.indexOf('export async function generateMetadata'), route.indexOf('export default async function'))
    const denied = meta.indexOf("gate?.kind === 'denied'")
    expect(denied).toBeGreaterThan(0)
    expect(meta.indexOf('page.seoTitle')).toBeGreaterThan(denied)
    const body = route.slice(route.indexOf('export default async function'))
    const closed = body.indexOf("gate.kind === 'denied'")
    expect(closed).toBeGreaterThan(0)
    for (const after of ['hydrateSections', 'collectSectionFaqItems', 'JsonLd', 'SectionRenderer']) {
      const at = body.indexOf(after)
      if (at >= 0) expect(at, after).toBeGreaterThan(closed)
    }
  })
})

// ── Sitemap and llms.txt ──────────────────────────────────────────────────────

describe('sitemap.xml and llms.txt', () => {
  it('the sitemap query never reads a closed page\'s images, and flags it closed', async () => {
    const rows = (await run(SITEMAP_PAGES_QUERY)) as Array<ListedPage & { images: unknown; slug: { en: { current: string } } }>
    const by = Object.fromEntries(rows.map((r) => [r.slug.en.current, r]))
    expect(by.members.open).toBe(false)
    expect(by.members.images).toBeNull()
    expect(by.broken.open).toBe(false) // malformed → closed
    expect(by.about.open).toBe(true)
  })
  it('llms.txt never reads a closed page\'s title or description', async () => {
    const rows = (await run(LLMS_PAGES_QUERY, { projectSlug: 'site-a' })) as Array<Record<string, unknown>>
    const closed = rows.filter((r) => r.open !== true)
    expect(closed.length).toBe(3)
    for (const r of closed) {
      expect(r.titles).toBeUndefined()
      expect(r.descriptions).toBeUndefined()
    }
    expect(JSON.stringify(closed)).not.toContain(SECRET)
  })
  it('listing drops closed pages, everything under them, and a missing flag; keeps look-alike prefixes', async () => {
    const rows = (await run(SITEMAP_PAGES_QUERY)) as ListedPage[]
    const closed = closedPaths(rows, 'en')
    const listed = rows.filter((r) => isListable(r, 'en', closed)).map((r) => r.slug!.en!.current).sort()
    expect(listed).toEqual(['about', 'membership'])
    expect(isListable({ slug: { en: { current: 'x' } } }, 'en', new Set())).toBe(false) // no flag → not listed
  })
  it('both routes filter with isListable', () => {
    expect(read('app/sitemap.ts')).toMatch(/isListable\(/)
    expect(read('app/llms.txt/route.ts')).toMatch(/isListable\(/)
    expect(read('app/llms.txt/route.ts')).toMatch(/LLMS_PAGES_QUERY/)
  })
})

// ── Navigation and internal links ─────────────────────────────────────────────

describe('navigation', () => {
  const link = (over: Partial<NavLink>): NavLink => ({ label: 'Members', linkType: 'internal', hasPageRef: true, pageSlug: 'members', ...over })
  it('a restricted target is hidden by default', () => {
    const l = link({ pageAccess: { visibility: 'restricted' } })
    expect(navAccessMode(l)).toBe('hidden')
    expect(isRenderableNavLink(l)).toBe(false)
  })
  it('"show with a lock" keeps the link and adds the localized lock label', () => {
    const l = link({ pageAccess: { visibility: 'restricted', navigation: 'locked' } })
    expect(isRenderableNavLink(l)).toBe(true)
    expect(resolveNavLink(l, 'de', 'site-a').lockedLabel).toBe(getAccessMessages('de').lockedLinkLabel)
  })
  it('a malformed rule on the target is treated as restricted (hidden)', () => {
    expect(navAccessMode(link({ pageAccess: { visibility: 'Restricted' } }))).toBe('hidden')
  })
  it('a public page under a closed one is hidden too', () => {
    expect(navAccessMode(link({ pageUnderClosed: true }))).toBe('hidden')
    expect(navAccessMode(link({ pageAccess: { visibility: 'public' }, pageUnderClosed: false }))).toBe('public')
  })
  it('restricted children are filtered out of a public parent', () => {
    const parent = link({ label: 'About', pageSlug: 'about', children: [link({ label: 'Hidden', pageAccess: { visibility: 'restricted' } }), link({ label: 'Open', pageSlug: 'open' })] })
    const [out] = resolveNavLinks([parent], 'en', 'site-a')
    expect(out.children?.map((c) => c.label)).toEqual(['Open'])
  })
  it('the nav projection reads the target\'s rule and menu mode — never its groups or content', async () => {
    expect(NAV_LINK_FIELDS).toMatch(/pageRef->access\{ visibility, navigation \}/)
    const nav = [
      { _id: 'nav', _type: 'navHolder', projectSlug: 'site-a', links: [
        { _key: '1', label: { en: 'M' }, linkType: 'internal', pageRef: { _ref: 'members' } },
        { _key: '2', label: { en: 'C' }, linkType: 'internal', pageRef: { _ref: 'child' } },
        { _key: '3', label: { en: 'A' }, linkType: 'internal', pageRef: { _ref: 'about' } },
        { _key: '4', label: { en: 'P' }, linkType: 'internal', pageRef: { _ref: 'membership' } },
      ] },
      ...DATASET,
    ]
    const params = { projectSlug: 'site-a', locale: 'en', defaultLocale: 'en' }
    const q = `*[_id == "nav"][0].links[]{ ${NAV_LINK_FIELDS.replace(/"label": [^\n]*\n/, '"label": label.en,\n')} }`
    const out = (await run(q, params, nav)) as NavLink[]
    expect(JSON.stringify(out)).not.toContain(SECRET)
    expect(JSON.stringify(out)).not.toContain(G)
    expect(out.map(navAccessMode)).toEqual(['locked', 'hidden', 'public', 'public'])
  })
  it('no projection dereferences a page reference\'s content (title, SEO, sections, groups)', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); continue }
        if (!/\.(ts|tsx)$/.test(name)) continue
        if (/pageRef->\s*(title|seo\w*|sections|ogImage|access\.groups|access\{[^}]*groups)/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})

// ── The placeholder, the route wiring, APIs and caching ───────────────────────

describe('the route reads pages only through the gate', () => {
  it('the slug route uses loadGatedPage and never pageBySlugQuery directly', () => {
    const route = read('app/[locale]/(website)/[tenant]/[...slug]/page.tsx')
    expect(route).toMatch(/loadGatedPage\(/)
    expect(route).not.toMatch(/pageBySlugQuery/)
  })
  it('page-gate.server.ts is the only code that runs pageBySlugQuery', () => {
    const users: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); continue }
        if (/\.(ts|tsx)$/.test(name) && /fetch\w*<[^>]*>\(\s*pageBySlugQuery|fetch\w*\(\s*pageBySlugQuery/.test(readFileSync(p, 'utf8'))) users.push(p.slice(SRC.length + 1))
      }
    }
    walk(SRC)
    expect(users).toEqual(['lib/access/page-gate.server.ts'])
  })
  it('the placeholder takes no page data and imports nothing from Sanity', () => {
    for (const file of ['components/site/RestrictedPage.tsx', 'components/site/AccessPrompt.tsx']) {
      const src = read(file)
      const imports = src.split('\n').filter((l) => /^import /.test(l)).join('\n')
      expect(imports, file).not.toMatch(/sanity|groq|access\/(page-gate|store|server|visitor)/i)
      expect(src, file).not.toMatch(/fetchForTenant|\bpage\.\w|WebsitePage/)
    }
    const props = read('components/site/RestrictedPage.tsx').match(/export type RestrictedPageProps = \{([\s\S]*?)\n\}/)![1]
    const keys = [...props.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).sort()
    expect(keys).toEqual(['actions', 'fields', 'homeHref', 'locale', 'notice', 'returnTo', 'signedIn'])
  })
  it('the home page cannot be gated: its route and query do not read access', () => {
    expect(read('app/[locale]/(website)/[tenant]/page.tsx')).not.toMatch(/access|loadGatedPage/i)
    const q = read('lib/sanity/queries.ts')
    const home = q.slice(q.indexOf('export const pageHomeQuery'), q.indexOf('`', q.indexOf('export const pageHomeQuery') + 40) + 1)
    expect(home).not.toMatch(/access/)
  })
})

describe('public APIs', () => {
  it('/api/v1 exposes events only — no page content', () => {
    expect(readdirSync(join(SRC, 'app/api/v1')).filter((n) => n !== '__tests__').sort()).toEqual(['events', 'openapi.json'])
  })
  it('no API route reads page documents or the page projections', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        const s = readFileSync(p, 'utf8')
        if (/_type == "page"|pageBySlugQuery|pageHomeQuery|PAGE_SECTIONS_PROJECTION|galleryPreviewPageQuery/.test(s)) offenders.push(p)
      }
    }
    walk(join(SRC, 'app/api'))
    expect(offenders).toEqual([])
  })
  it('the only generic document reader is admin-only', () => {
    expect(read('app/api/sanity/document/route.ts')).toMatch(/requireAbluoAdmin\(\)[\s\S]*status: 403/)
  })
})

describe('cache behaviour', () => {
  it('every response is Cache-Control: private, no-store (next.config headers, all paths)', () => {
    const cfg = readFileSync(resolve(SRC, '../next.config.ts'), 'utf8')
    expect(cfg).toMatch(/source: '\/\(\.\*\)',\s*headers: \[[^\]]*\{ key: 'Cache-Control', value: 'private, no-store' \}/)
  })
  it('the page route and the site layout are force-dynamic (never statically cached)', () => {
    expect(read('app/[locale]/(website)/[tenant]/[...slug]/page.tsx')).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(read('app/[locale]/(website)/[tenant]/layout.tsx')).toMatch(/export const dynamic = 'force-dynamic'/)
  })
  it('the gate memoises per request only (React cache), never across requests', () => {
    const src = read('lib/access/page-gate.server.ts')
    expect(src).toMatch(/import \{ cache \} from 'react'/)
    expect(src).not.toMatch(/unstable_cache|'use cache'|revalidate/)
  })
})

describe('visitor-facing text', () => {
  it('exists in every platform language, complete and non-empty', () => {
    const keys = Object.keys(ACCESS_MESSAGES_FOR_TEST.en).sort()
    for (const { code } of Object.values(PLATFORM_LOCALES)) {
      const m = (ACCESS_MESSAGES_FOR_TEST as unknown as Record<string, Record<string, string>>)[code]
      expect(m, code).toBeDefined()
      expect(Object.keys(m).sort(), code).toEqual(keys)
      for (const k of keys) expect(m[k].trim(), `${code}.${k}`).not.toBe('')
    }
  })
  it('an unknown locale falls back to English', () => {
    expect(getAccessMessages('xx')).toEqual(ACCESS_MESSAGES_FOR_TEST.en)
  })
})
