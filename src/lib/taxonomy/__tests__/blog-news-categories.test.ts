/**
 * Posts and News categories on the taxonomy system (ADR-033 Amendment J).
 * The point: a blog category served from `taxonomyTerm` records is the SAME public
 * page as the one served from the old config list - title, description, colour,
 * noindex, redirects from retired keys - and with no records nothing changes.
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { getModuleConfig, type ModuleConfigRecord } from '@/lib/modules/config'
import { findRoutableCategory, listRoutableCategories, resolveCategoriesFor } from '@/lib/modules/categories'
import { projectModuleConfigQuery, dashboardPostsContextQuery } from '@/lib/sanity/queries'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { manageableTaxonomyModules } from '../manageable'
import { termIsRoutable } from '../rules'
import { categoryKeyVocabulary, cleanTextMap, flattenRedirectKeys, moduleCategoryKeysGroq, moduleRoutableTermsGroq, termsToConfigEntries } from '../vocabulary'

// A Hoffmann-shaped blog: colours, descriptions, retired keys, a noindex entry.
const CONFIG = [
  { _key: 'k1', value: 'parole-riflessioni', label: { it: 'Parole e Riflessioni', de: 'Worte und Reflexionen' }, description: { it: 'Pensieri.', de: 'Gedanken.' } },
  { _key: 'k2', value: 'prendersi-cura-di-se', label: { it: 'Prendersi cura di sé', de: 'Sich kümmern' }, color: '#43554A', redirectFrom: ['mindfulness', 'cambiare-vita'], description: { it: 'Cura.' } },
  { _key: 'k3', value: 'poco', label: { en: 'Little' }, noindex: true },
]
const TERMS = CONFIG.map((e, i) => ({
  key: e.value,
  order: (i + 1) * 1000,
  color: (e as { color?: string }).color ?? null,
  label: { _type: 'localizedString', ...e.label },
  description: (e as { description?: object }).description ? { _type: 'localizedText', ...(e as { description: object }).description } : null,
  // stored per language, like the schema's `redirectFrom` type
  redirectFrom: (e as { redirectFrom?: string[] }).redirectFrom ? { _type: 'redirectFrom', it: (e as { redirectFrom: string[] }).redirectFrom } : null,
  noindex: (e as { noindex?: boolean }).noindex ?? null,
}))

const old = [{ moduleId: 'blog', config: { categories: CONFIG, readingSpeed: 180 } }] as ModuleConfigRecord[]
const neu = [{ moduleId: 'blog', config: { categories: CONFIG, readingSpeed: 180 }, categoryTerms: TERMS }] as unknown as ModuleConfigRecord[]

describe('getModuleConfig dual-read', () => {
  it('without term records returns the stored config object itself', () => {
    expect(getModuleConfig(old, 'blog')).toBe(old[0].config)
    expect(getModuleConfig([{ moduleId: 'blog', config: { a: 1 }, categoryTerms: [] }], 'blog')).toEqual({ a: 1 })
    expect(getModuleConfig([{ moduleId: 'blog', config: null, categoryTerms: null }], 'blog')).toBeNull()
  })
  it('with term records they ARE the category list; other config is kept', () => {
    const c = getModuleConfig(neu, 'blog')!
    expect(c.readingSpeed).toBe(180)
    expect((c.categories as { value: string }[]).map((e) => e.value)).toEqual(['parole-riflessioni', 'prendersi-cura-di-se', 'poco'])
  })
  it('a module with terms but no config row still gets its categories', () => {
    expect(getModuleConfig([{ moduleId: 'news', categoryTerms: [{ key: 'a', label: { en: 'A' } }] }], 'news')?.categories).toHaveLength(1)
  })
})

describe('/category/<key> is identical from term records', () => {
  for (const locale of ['it', 'de', 'en']) {
    it(`findRoutableCategory: same page for every key (${locale})`, () => {
      for (const e of CONFIG) {
        expect(findRoutableCategory(e.value, neu, 'blog', locale, 'it')).toEqual(findRoutableCategory(e.value, old, 'blog', locale, 'it'))
      }
    })
    it(`listRoutableCategories and badges match (${locale})`, () => {
      expect(listRoutableCategories(neu, 'blog', locale, 'it')).toEqual(listRoutableCategories(old, 'blog', locale, 'it'))
      const post = { categoryKeys: ['prendersi-cura-di-se', 'parole-riflessioni', 'gone'] }
      expect(resolveCategoriesFor(post, neu, 'blog', locale, 'it')).toEqual(resolveCategoriesFor(post, old, 'blog', locale, 'it'))
    })
  }
  it('retired keys 301 to the same category; unknown keys 404 (empty result)', () => {
    expect(findRoutableCategory('mindfulness', neu, 'blog', 'it', 'it')).toEqual({ redirectTo: 'prendersi-cura-di-se' })
    expect(findRoutableCategory('cambiare-vita', neu, 'blog', 'it', 'it')).toEqual({ redirectTo: 'prendersi-cura-di-se' })
    expect(findRoutableCategory('nope', neu, 'blog', 'it', 'it')).toEqual({})
  })
  it('description, colour and noindex come through', () => {
    expect(findRoutableCategory('poco', neu, 'blog', 'it', 'it').category?.noindex).toBe(true)
    expect(findRoutableCategory('prendersi-cura-di-se', neu, 'blog', 'de', 'it').category).toMatchObject({ color: '#43554A', description: 'Cura.', title: 'Sich kümmern' })
  })
})

describe('term row cleaning', () => {
  it('drops bookkeeping keys and blanks from label maps', () => {
    expect(cleanTextMap({ _type: 'localizedString', translationStatus: {}, it: 'A', en: ' ', de: null })).toEqual({ it: 'A' })
  })
  it('merges per-language redirect lists into one de-duplicated list; a flat list passes through', () => {
    expect(flattenRedirectKeys({ _type: 'redirectFrom', it: ['a', 'b'], de: ['b', 'c'], en: null })).toEqual(['a', 'b', 'c'])
    expect(flattenRedirectKeys(['x', ' x ', ''])).toEqual(['x'])
    expect(flattenRedirectKeys(null)).toEqual([])
  })
  it('orders by order then key, ignores invalid and duplicate keys', () => {
    const e = termsToConfigEntries([{ key: 'b', order: 2, label: { en: 'B' } }, { key: 'a', order: 1, label: { en: 'A' } }, { key: '', label: {} }, { key: 'a', label: { en: 'dup' } }, null])
    expect(e.map((x) => [x.value, x.label.en])).toEqual([['a', 'A'], ['b', 'B']])
  })
})

describe('key vocabulary (validation of a save)', () => {
  it('term keys win when any exist, else the config keys', () => {
    expect(categoryKeyVocabulary(['a', 'b'], ['x'])).toEqual(['a', 'b'])
    expect(categoryKeyVocabulary([], ['x'])).toEqual(['x'])
    expect(categoryKeyVocabulary(undefined, undefined)).toEqual([])
  })
  it('GROQ builders reject anything but a plain module id', () => {
    expect(() => moduleCategoryKeysGroq('blog" || true')).toThrow()
    expect(() => moduleRoutableTermsGroq('Blog')).toThrow()
    expect(moduleCategoryKeysGroq('news')).toContain('$projectSlug')
    expect(moduleRoutableTermsGroq('blog')).toContain('$projectSlug')
  })
})

describe('the GROQ itself (groq-js)', () => {
  const dataset = [
    { _id: 'p1', _type: 'project', projectSlug: 'a', moduleInstallations: [{ moduleId: 'blog', enabled: true, config: { categories: CONFIG } }, { moduleId: 'news', enabled: true, config: { categories: [{ value: 'old', label: { en: 'Old' } }] } }, { moduleId: 'events', config: { categories: [] } }] },
    { _id: 'p2', _type: 'project', projectSlug: 'b', moduleInstallations: [{ moduleId: 'blog', enabled: true, config: { categories: CONFIG } }] },
    ...TERMS.map((t) => ({ _id: `term.a.blog.category.${t.key}`, _type: 'taxonomyTerm', projectSlug: 'a', module: 'blog', kind: 'category', ...t })),
    // another project's term and another module's term must not leak in
    { _id: 'term.b.blog.category.zzz', _type: 'taxonomyTerm', projectSlug: 'zz', module: 'blog', kind: 'category', key: 'zzz', label: { en: 'Z' } },
    { _id: 'term.a.catalogue.category.c', _type: 'taxonomyTerm', projectSlug: 'a', module: 'catalogue', kind: 'category', key: 'c', label: { en: 'C' } },
  ]
  const run = async (q: string, projectSlug: string) => (await evaluate(parse(q), { dataset, params: { projectSlug } })).get()

  it('projectModuleConfigQuery projects the blog terms of THIS project only, and nothing for other modules', async () => {
    const modules = (await run(projectModuleConfigQuery.replace(/\$locale|\$defaultLocale/g, 'null'), 'a')) as ModuleConfigRecord[]
    const blog = modules.find((m) => m.moduleId === 'blog')!
    expect(blog.categoryTerms?.map((t) => (t as { key: string }).key)).toEqual(['parole-riflessioni', 'prendersi-cura-di-se', 'poco'])
    expect(modules.find((m) => m.moduleId === 'news')!.categoryTerms ?? null).toEqual([])
    expect(modules.find((m) => m.moduleId === 'events')!.categoryTerms ?? null).toBeNull()
    // and the page is the same one the config list gave
    expect(findRoutableCategory('mindfulness', modules, 'blog', 'it', 'it')).toEqual({ redirectTo: 'prendersi-cura-di-se' })
  })
  it('a project with no records reads exactly the old list', async () => {
    const modules = (await run(projectModuleConfigQuery.replace(/\$locale|\$defaultLocale/g, 'null'), 'b')) as ModuleConfigRecord[]
    expect(modules[0].categoryTerms ?? []).toEqual([])
    expect(getModuleConfig(modules, 'blog')!.categories).toEqual(CONFIG)
  })
  it('dashboardPostsContextQuery carries the terms', async () => {
    const r = (await run(dashboardPostsContextQuery, 'a')) as { categoryTerms: { key: string }[]; categories: unknown[] }
    expect(r.categoryTerms.map((t) => t.key)).toEqual(['parole-riflessioni', 'prendersi-cura-di-se', 'poco'])
    expect(r.categories).toHaveLength(3)
  })
})

describe('manifests', () => {
  const grant = (permissions: string[]) => ({ permissions, enabledModuleIds: ['blog', 'news', 'catalogue'] })
  it('blog and news declare category terms only (no tags), used by the real field', () => {
    for (const [id, type] of [['blog', 'post'], ['news', 'newsArticle']] as const) {
      const m = MODULE_REGISTRY.find((x) => x.id === id)!
      expect(m.taxonomies).toEqual([expect.objectContaining({ kind: 'category', usedBy: [{ type, field: 'categories' }] })])
    }
  })
  it('only blog category pages are routable', () => {
    expect(MODULE_REGISTRY.find((x) => x.id === 'blog')!.taxonomies?.[0].routable).toBe(true)
    expect(termIsRoutable('blog', 'category')).toBe(true)
    expect(termIsRoutable('news', 'category')).toBe(false)
  })
  it('owner/editor manage them, viewers list them read-only', () => {
    const owner = ['blog.taxonomy.write', 'blog.post.read', 'news.taxonomy.write', 'news.article.read']
    expect(manageableTaxonomyModules(grant(owner)).filter((m) => m.module !== 'catalogue').map((m) => [m.module, m.canWrite])).toEqual([['blog', true], ['news', true]])
    expect(manageableTaxonomyModules(grant(['blog.post.read', 'news.article.read'])).map((m) => [m.module, m.canWrite])).toEqual([['blog', false], ['news', false]])
    expect(manageableTaxonomyModules(grant([]))).toEqual([])
  })
  it('the roles that hold the write permission by default include owner and editor', () => {
    for (const id of ['blog', 'news']) {
      const p = MODULE_REGISTRY.find((x) => x.id === id)!.platformContract.permissions.find((x) => x.id === `${id}.taxonomy.write`)!
      expect(p.defaultRoles).toEqual(expect.arrayContaining(['owner', 'editor']))
    }
  })
})
