import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PortableText } from '@portabletext/react'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import {
  autoOpensInNewTab,
  blankToStore,
  internalTargetPath,
  isExternalLink,
  opensInNewTab,
  resolveBodyLinks,
  siteHostsForProject,
} from '../link-target'

const HOSTS = ['ch-psicoterapeuta.com', 'hoffmann.preview.abluo.app']

describe('new-tab rule', () => {
  it.each([
    ['https://other.example/x', true],
    ['http://other.example', true],
    ['https://ch-psicoterapeuta.com/chi-sono', false],
    ['https://www.ch-psicoterapeuta.com/', false],
    ['https://CH-Psicoterapeuta.com:443/x', false],
    ['https://hoffmann.preview.abluo.app/it', false],
    ['/contatti', false],
    ['mailto:a@b.it', false],
    ['tel:+39054412', false],
    ['#top', false],
  ])('%s → new tab %s', (href, expected) => {
    expect(autoOpensInNewTab({ href }, HOSTS)).toBe(expected)
    expect(isExternalLink(href, HOSTS)).toBe(expected)
  })

  it('internal references never open a new tab automatically', () => {
    expect(autoOpensInNewTab({ internal: { _type: 'reference', _ref: 'p1' } }, HOSTS)).toBe(false)
  })

  it('blank overrides the rule both ways', () => {
    expect(opensInNewTab({ href: 'https://other.example', blank: false }, HOSTS)).toBe(false)
    expect(opensInNewTab({ href: '/contatti', blank: true }, HOSTS)).toBe(true)
    expect(opensInNewTab({ internal: { _ref: 'x' }, blank: true }, HOSTS)).toBe(true)
    expect(opensInNewTab({ href: 'https://other.example', blank: 'yes' }, HOSTS)).toBe(true)
  })

  it('stores blank only when the choice differs from the rule', () => {
    expect(blankToStore(true, true)).toBeUndefined()
    expect(blankToStore(false, false)).toBeUndefined()
    expect(blankToStore(false, true)).toBe(false)
    expect(blankToStore(true, false)).toBe(true)
  })

  it('knows a project’s own hosts from the generated route table', () => {
    expect(siteHostsForProject('abluo')).toContain('abluo.app')
    expect(siteHostsForProject('no-such-project')).toEqual([])
    expect(siteHostsForProject(undefined)).toEqual([])
  })
})

describe('internal targets', () => {
  it.each([
    [{ _type: 'page', slug: 'chi-sono', projectSlug: 'hoffmann', live: true }, 'chi-sono'],
    [{ _type: 'page', slug: 'servizi/ansia', projectSlug: 'hoffmann', live: true }, 'servizi/ansia'],
    [{ _type: 'page', pageType: 'home', slug: 'home', projectSlug: 'hoffmann', live: true }, ''],
    [{ _type: 'post', slug: 'mindfulness', projectSlug: 'hoffmann', live: true }, 'blog/mindfulness'],
    [{ _type: 'newsArticle', slug: 'apertura', projectSlug: 'hoffmann', live: true }, 'news/apertura'],
    [{ _type: 'event', slug: 'workshop', projectSlug: 'hoffmann', live: true }, 'events/workshop'],
    [{ _type: 'post', slug: 'futuro', projectSlug: 'hoffmann', live: false }, null],
    [{ _type: 'post', slug: null, projectSlug: 'hoffmann', live: true }, null],
    [{ _type: 'page', slug: 'x', projectSlug: 'livener', live: true }, null],
    [{ _type: 'author', slug: 'x', projectSlug: 'hoffmann', live: true }, null],
    [null, null],
  ])('%j → %j', (target, path) => {
    expect(internalTargetPath(target, 'hoffmann')).toBe(path)
  })
})

const block = (markDefs: unknown[]) => ({
  _type: 'block',
  _key: 'b',
  style: 'normal',
  markDefs,
  children: [{ _type: 'span', _key: 's', text: 'Leggi qui', marks: ['l'] }],
})
const internal = (internalTarget: unknown, extra: Record<string, unknown> = {}) => [
  block([{ _type: 'link', _key: 'l', internal: { _type: 'reference', _ref: 'p1', _weak: true }, internalTarget, ...extra }]),
]
const render = (body: unknown) =>
  renderToStaticMarkup(<PortableText value={body as never} components={articlePortableTextComponents} />)
const OPTS = { siteBase: '/de/hoffmann', siteHosts: HOSTS, projectSlug: 'hoffmann' }

describe('resolveBodyLinks + article renderer', () => {
  it('resolves an internal link to the URL in the current language, same tab', () => {
    const body = resolveBodyLinks(internal({ _type: 'post', slug: 'achtsamkeit', projectSlug: 'hoffmann', live: true }), OPTS)
    expect(body[0].markDefs).toEqual([{ _type: 'link', _key: 'l', href: '/de/hoffmann/blog/achtsamkeit', blank: false }])
    const html = render(body)
    expect(html).toContain('href="/de/hoffmann/blog/achtsamkeit"')
    expect(html).not.toContain('target=')
  })

  it('links the home page to the site base (own domain: "/it")', () => {
    const body = resolveBodyLinks(internal({ _type: 'page', pageType: 'home', slug: 'home', projectSlug: 'hoffmann' }), { ...OPTS, siteBase: '/it' })
    expect(render(body)).toContain('href="/it"')
  })

  it('honours a new-tab override on an internal link', () => {
    const body = resolveBodyLinks(internal({ _type: 'page', slug: 'chi-sono', projectSlug: 'hoffmann', live: true }, { blank: true }), OPTS)
    expect(render(body)).toContain('target="_blank"')
  })

  it.each([
    ['missing (deleted / unpublished)', null],
    ['not live yet', { _type: 'post', slug: 'x', projectSlug: 'hoffmann', live: false }],
    ['not translated', { _type: 'page', slug: null, projectSlug: 'hoffmann', live: true }],
    ['another project', { _type: 'page', slug: 'x', projectSlug: 'livener', live: true }],
  ])('falls back to plain text when the target is %s', (_l, target) => {
    const html = render(resolveBodyLinks(internal(target), OPTS))
    expect(html).not.toContain('<a')
    expect(html).toContain('Leggi qui')
  })

  it('applies the rule to external links and keeps own-domain absolute links in the same tab', () => {
    const ext = resolveBodyLinks([block([{ _type: 'link', _key: 'l', href: 'https://other.example' }])], OPTS)
    expect(render(ext)).toContain('target="_blank"')
    const own = resolveBodyLinks([block([{ _type: 'link', _key: 'l', href: 'https://ch-psicoterapeuta.com/chi-sono' }])], OPTS)
    expect(render(own)).not.toContain('target=')
    const override = resolveBodyLinks([block([{ _type: 'link', _key: 'l', href: 'https://other.example', blank: false }])], OPTS)
    expect(render(override)).not.toContain('target=')
  })

  it('drops unsafe hrefs and leaves other content untouched', () => {
    const image = { _type: 'image', _key: 'i', asset: { _ref: 'image-a-1x1-png' } }
    const other = { _type: 'internalNote', _key: 'n', text: 'x' }
    const body = resolveBodyLinks([block([{ _type: 'link', _key: 'l', href: 'javascript:alert(1)' }, other]), image], OPTS)
    const first = body[0] as { markDefs: unknown[] }
    expect(first.markDefs[0]).toEqual({ _type: 'link', _key: 'l', blank: false })
    expect(first.markDefs[1]).toBe(other)
    expect(body[1]).toBe(image)
    expect(render(body)).not.toContain('<a')
    expect(resolveBodyLinks(undefined, OPTS)).toBeUndefined()
  })
})

describe('website queries dereference internal links', () => {
  it('post (live + draft preview) and news bodies project internalTarget in the current language', async () => {
    const { postBySlugQuery, newsArticleBySlugQuery } = await import('@/lib/sanity/queries')
    const { postDraftPreviewQuery } = await import('@/lib/sanity/post-preview-query')
    for (const q of [postBySlugQuery, newsArticleBySlugQuery, postDraftPreviewQuery]) {
      expect(q).toContain('"internalTarget": internal->{')
      expect(q).toContain('"slug": slug[$locale].current')
    }
    expect(postBySlugQuery).toMatch(/_id,\s*projectSlug,/)
  })
})
