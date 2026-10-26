/**
 * The page queries, EXECUTED with groq-js against fixture documents: a
 * restricted page's title, SEO, background and sections never leave Sanity
 * unless the route binds $unlocked after authorising the visitor; a child
 * page under a restricted parent is withheld too; another project's page is
 * never returned; the GROQ rule and parseAccessPolicy() agree on every shape.
 */
import { describe, it, expect } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { pageBySlugQuery } from '@/lib/sanity/queries'
import { pageIsOpen } from '../groq'
import { parseAccessPolicy, slugAncestorPaths } from '../policy'

const G = '11111111-1111-4111-8111-111111111111'
const page = (id: string, slug: string, access?: unknown, project = 'site-a') => ({
  _id: id,
  _type: 'page',
  projectSlug: project,
  pageType: 'landing',
  title: { _type: 'localizedString', en: `Title of ${id}` },
  seoTitle: { _type: 'localizedString', en: `SEO of ${id}` },
  seoDescription: { _type: 'localizedText', en: `Description of ${id}` },
  backgroundPattern: 'none',
  slug: { en: { _type: 'slug', current: slug } },
  sections: [{ _type: 'textSection', _key: 'k1', heading: { _type: 'localizedString', en: `SECRET body of ${id}` } }],
  ...(access === undefined ? {} : { access }),
})

const DATASET = [
  { _id: 'project-a', _type: 'project', projectSlug: 'site-a' },
  page('public', 'about'),
  page('members', 'members', { visibility: 'restricted', groups: [G], navigation: 'locked' }),
  page('child', 'members/timetable'),
  page('grandchild', 'members/timetable/archive', { visibility: 'public' }),
  page('typo', 'typo', { visibility: 'Restricted' }),
  page('novis', 'novis', { groups: [G] }),
  page('explicit-public', 'open', { visibility: 'public', groups: [G] }),
  page('other-project', 'members', undefined, 'site-b'),
]

/**
 * groq-js does not evaluate a parameter used as an attribute key
 * (`slug[$locale]`), which the Content Lake does. Inline the locale params as
 * string keys — same semantics, executable here.
 */
function inlineLocaleKeys(query: string, params: Record<string, unknown>): string {
  return query
    .replace(/\[\$locale\]/g, `[${JSON.stringify(params.locale)}]`)
    .replace(/\[\$defaultLocale\]/g, `[${JSON.stringify(params.defaultLocale)}]`)
}

async function run(query: string, params: Record<string, unknown>) {
  const tree = parse(inlineLocaleKeys(query, params))
  const res = await evaluate(tree, { dataset: DATASET, params })
  return res.get()
}
const fetchPage = (slug: string, opts: { unlocked?: boolean; project?: string } = {}) =>
  run(pageBySlugQuery, {
    projectSlug: opts.project ?? 'site-a',
    tenantSlug: 'tenant-a',
    locale: 'en',
    defaultLocale: 'en',
    slug,
    ancestorPaths: slugAncestorPaths(slug),
    unlocked: opts.unlocked ?? false,
  })

const CONTENT_KEYS = ['title', 'seoTitle', 'seoDescription', 'ogImage', 'noindex', 'backgroundPattern', 'sections']

describe('pageBySlugQuery — content only when open, or after authorisation', () => {
  it('a public page returns its content in one read', async () => {
    const r = await fetchPage('about')
    expect(r.title).toBe('Title of public')
    expect(r.sections).toHaveLength(1)
    expect(r.contentWithheld).toBe(false)
  })

  it('a restricted page returns routing data and its policy — and NOTHING else', async () => {
    const r = await fetchPage('members')
    expect(r._id).toBe('members')
    expect(r.contentWithheld).toBe(true)
    expect(r.access).toEqual({ visibility: 'restricted', groups: [G], navigation: 'locked' })
    for (const k of CONTENT_KEYS) expect(r, k).not.toHaveProperty(k)
    expect(JSON.stringify(r)).not.toMatch(/SECRET|Title of|SEO of|Description of/)
  })

  it('a child under a restricted parent is withheld and carries the parent policy (AND along the path)', async () => {
    for (const slug of ['members/timetable', 'members/timetable/archive']) {
      const r = await fetchPage(slug)
      expect(r.contentWithheld, slug).toBe(true)
      expect(r.ancestorAccess, slug).toEqual([{ access: { visibility: 'restricted', groups: [G] } }])
      expect(JSON.stringify(r), slug).not.toMatch(/SECRET|Title of/)
    }
  })

  it('malformed policies are closed: a typo or a missing visibility withholds the content', async () => {
    for (const slug of ['typo', 'novis']) {
      const r = await fetchPage(slug)
      expect(r.contentWithheld, slug).toBe(true)
      expect(JSON.stringify(r), slug).not.toContain('SECRET')
    }
    expect((await fetchPage('open')).contentWithheld).toBe(false)
  })

  it('after authorisation ($unlocked) the same query returns the content', async () => {
    const r = await fetchPage('members', { unlocked: true })
    expect(r.title).toBe('Title of members')
    expect(r.sections).toHaveLength(1)
  })

  it('never another project’s page, locked or not', async () => {
    const r = await fetchPage('members', { project: 'site-b' })
    expect(r._id).toBe('other-project')
    expect(r.contentWithheld).toBe(false)
    const none = await fetchPage('about', { project: 'site-c' })
    expect(none).toBeNull()
  })

  it('a restricted page of project A does not lock the same path on project B', async () => {
    const r = await fetchPage('members', { project: 'site-b' })
    expect(r.ancestorAccess).toEqual([])
  })
})

describe('the GROQ rule and parseAccessPolicy() agree', () => {
  const shapes: unknown[] = [
    undefined, null, {}, { visibility: 'public' }, { visibility: 'public', groups: [G] },
    { visibility: 'restricted' }, { visibility: 'restricted', groups: [G] }, { visibility: 'Restricted' },
    { visibility: 'private' }, { groups: [G] }, { navigation: 'locked' }, { visibility: null },
  ]
  it.each(shapes.map((s) => [JSON.stringify(s) ?? 'undefined', s]))('%s', async (_, shape) => {
    const doc = shape === undefined ? {} : { access: shape }
    const tree = parse(`*[0]{ "open": ${pageIsOpen()} }`)
    const groqOpen = (await (await evaluate(tree, { dataset: [doc] })).get()).open
    expect(groqOpen).toBe(parseAccessPolicy(shape).visibility === 'public')
  })
})
