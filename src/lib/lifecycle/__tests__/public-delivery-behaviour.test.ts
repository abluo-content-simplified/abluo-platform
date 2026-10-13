/**
 * ADR-032 D3 — the real website queries, run with groq-js against fixtures at
 * a fixed `now`: only public items come back, on every kind of path (lists,
 * picks, detail, old slug, dereferenced references, sitemap, llms.txt).
 */

import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import * as Q from '@/lib/sanity/queries'
import { SITEMAP_EVENTS_QUERY, SITEMAP_NEWS_QUERY, SITEMAP_PAGES_QUERY, SITEMAP_POSTS_QUERY } from '@/lib/seo/sitemap-queries'
import { LLMS_NEWS_QUERY, LLMS_POSTS_QUERY } from '@/lib/seo/llms'

const NOW = new Date('2026-10-12T10:00:00.000Z')
const PAST = '2026-10-01T09:00:00.000Z'
const FUTURE = '2026-11-01T10:00:00.000Z'
const P = 'acme'

type State = 'live' | 'scheduled' | 'expired' | 'archived'
const WINDOW: Record<State, Record<string, string>> = {
  live: { publishedAt: PAST },
  scheduled: { publishedAt: FUTURE },
  expired: { publishedAt: PAST, expiresAt: PAST },
  archived: { publishedAt: PAST, archivedAt: PAST },
}
const STATES = Object.keys(WINDOW) as State[]
const ref = (id: string) => ({ _type: 'reference', _ref: id, _key: id })
const slug = (s: string) => ({ en: { _type: 'slug', current: s } })

const linkBody = (target: string) => ({
  en: [{ _type: 'block', _key: 'b', children: [{ _type: 'span', _key: 's', text: 'x', marks: ['m'] }], markDefs: [{ _type: 'link', _key: 'm', internal: ref(target) }] }],
})

const dataset: Record<string, unknown>[] = [
  ...STATES.map((s) => ({ _id: `post-${s}`, _type: 'post', projectSlug: P, title: { en: s }, slug: slug(`post-${s}`), redirectFrom: { en: [`old-post-${s}`] }, ...WINDOW[s] })),
  ...STATES.map((s) => ({ _id: `news-${s}`, _type: 'newsArticle', projectSlug: P, title: { en: s }, slug: slug(`news-${s}`), redirectFrom: { en: [`old-news-${s}`] }, ...WINDOW[s] })),
  // Events and galleries use the 'optional' rule: no window fields = public.
  { _id: 'event-live', _type: 'event', projectSlug: P, title: { en: 'e' }, slug: slug('event-live'), startDate: FUTURE },
  { _id: 'event-unlisted', _type: 'event', projectSlug: P, title: { en: 'e' }, slug: slug('event-unlisted'), visibility: 'unlisted', startDate: FUTURE },
  { _id: 'event-archived', _type: 'event', projectSlug: P, title: { en: 'e' }, slug: slug('event-archived'), redirectFrom: { en: ['old-event-archived'] }, archivedAt: PAST, startDate: FUTURE },
  { _id: 'gallery-live', _type: 'gallery', projectSlug: P, internalName: 'live', items: [] },
  { _id: 'gallery-archived', _type: 'gallery', projectSlug: P, internalName: 'archived', archivedAt: PAST, items: [] },
  // A live post that points at archived content, and links to a scheduled one.
  { _id: 'post-refs', _type: 'post', projectSlug: P, title: { en: 'r' }, slug: slug('post-refs'), publishedAt: PAST, relatedEvent: ref('event-archived'), gallery: ref('gallery-archived'), body: linkBody('post-scheduled') },
  { _id: 'post-refs-ok', _type: 'post', projectSlug: P, title: { en: 'r' }, slug: slug('post-refs-ok'), publishedAt: PAST, relatedEvent: ref('event-live'), gallery: ref('gallery-live'), body: linkBody('post-live') },
  {
    _id: 'page-1', _type: 'page', projectSlug: P, slug: slug('page'), title: { en: 'p' },
    sections: [
      { _type: 'photoGallerySection', _key: 'g1', galleries: [ref('gallery-live'), ref('gallery-archived')] },
      { _type: 'photoGallerySection', _key: 'g2', gallery: ref('gallery-archived') },
      { _type: 'blogListingSection', _key: 'b1', filterMode: 'manual', posts: STATES.map((s) => ref(`post-${s}`)) },
      { _type: 'newsListingSection', _key: 'n1', filterMode: 'manual', articles: STATES.map((s) => ref(`news-${s}`)) },
      { _type: 'eventsListingSection', _key: 'e1', filterMode: 'manual', events: [ref('event-live'), ref('event-archived')], event: ref('event-archived') },
    ],
  },
]

async function run<T = unknown>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const base = { projectSlug: P, locale: 'en', defaultLocale: 'en', charsPerMinute: 1000 }
  const value = await evaluate(parse(query, { params: { ...base, ...params } }), { dataset, params: { ...base, ...params }, timestamp: NOW })
  return (await value.get()) as T
}

const ids = (rows: { _id?: string }[] | null) => (rows ?? []).map((r) => r._id).sort()

describe('detail and old-slug lookups return public items only', () => {
  for (const s of STATES) {
    const visible = s === 'live'
    it(`post ${s}`, async () => {
      expect(!!(await run(Q.postBySlugQuery, { slug: `post-${s}` }))).toBe(visible)
      expect(!!(await run(Q.postByOldSlugQuery, { slug: `old-post-${s}` }))).toBe(visible)
    })
    it(`news ${s}`, async () => {
      expect(!!(await run(Q.newsArticleBySlugQuery, { slug: `news-${s}` }))).toBe(visible)
      expect(!!(await run(Q.newsArticleByOldSlugQuery, { slug: `old-news-${s}` }))).toBe(visible)
    })
  }
  it('event: live and unlisted resolve by URL, archived does not', async () => {
    expect(await run(Q.eventBySlugQuery, { slug: 'event-live' })).toBeTruthy()
    expect(await run(Q.eventBySlugQuery, { slug: 'event-unlisted' })).toBeTruthy()
    expect(await run(Q.eventBySlugQuery, { slug: 'event-archived' })).toBeNull()
    expect(await run(Q.eventByOldSlugQuery, { slug: 'old-event-archived' })).toBeNull()
  })
})

describe('lists and hand-picked items', () => {
  it('blog listing (latest)', async () => {
    const rows = await run<{ _id: string }[]>(Q.blogListingPostsNewestQuery, { filterMode: 'latest', categoryKey: null, eventId: null, maxItems: 50 })
    expect(ids(rows)).toEqual(['post-live', 'post-refs', 'post-refs-ok'])
  })
  it('manual picks: posts, news, events', async () => {
    expect(ids(await run(Q.blogListingManualPostsQuery, { postIds: STATES.map((s) => `post-${s}`) }))).toEqual(['post-live'])
    expect(ids(await run(Q.newsListingManualArticlesQuery, { articleIds: STATES.map((s) => `news-${s}`) }))).toEqual(['news-live'])
    expect(ids(await run(Q.eventsListingManualEventsQuery, { eventIds: ['event-live', 'event-archived'] }))).toEqual(['event-live'])
  })
  it('the page projection drops non-public picks and galleries', async () => {
    const page = await run<{ sections: Record<string, unknown>[] }>(Q.pageBySlugQuery, { slug: 'page' })
    const [g1, g2, b1, n1, e1] = page.sections
    expect((g1.galleries as { _id: string }[]).map((g) => g._id)).toEqual(['gallery-live'])
    expect(g2.gallery).toBeNull()
    expect(b1.postIds).toEqual(['post-live'])
    expect(n1.articleIds).toEqual(['news-live'])
    expect(e1.eventIds).toEqual(['event-live'])
    expect(e1.eventId).toBeNull()
  })
})

describe('references from public content', () => {
  it('a live post hides an archived event and gallery, and marks a link to a scheduled post not live', async () => {
    const post = await run<Record<string, any>>(Q.postBySlugQuery, { slug: 'post-refs' })
    expect(post.relatedEvent).toBeNull()
    expect(post.gallery).toBeNull()
    expect(post.body[0].markDefs[0].internalTarget.live).toBe(false)
  })
  it('and keeps them when they are public', async () => {
    const post = await run<Record<string, any>>(Q.postBySlugQuery, { slug: 'post-refs-ok' })
    expect(post.relatedEvent?._id).toBe('event-live')
    expect(post.gallery?._id).toBe('gallery-live')
    expect(post.body[0].markDefs[0].internalTarget.live).toBe(true)
  })
})

describe('sitemap and llms.txt list public items only', () => {
  const slugs = (rows: { slug?: { en?: { current?: string } } }[]) => rows.map((r) => r.slug?.en?.current).sort()
  it('sitemap', async () => {
    expect(slugs(await run(SITEMAP_POSTS_QUERY))).toEqual(['post-live', 'post-refs', 'post-refs-ok'])
    expect(slugs(await run(SITEMAP_NEWS_QUERY))).toEqual(['news-live'])
    expect(slugs(await run(SITEMAP_EVENTS_QUERY))).toEqual(['event-live'])
    const pages = await run<{ images: unknown[] }[]>(SITEMAP_PAGES_QUERY)
    expect(pages).toHaveLength(1)
  })
  it('llms.txt', async () => {
    const rows = await run<{ slugs: { en: { current: string } } }[]>(LLMS_POSTS_QUERY)
    expect(rows.map((r) => r.slugs.en.current).sort()).toEqual(['post-live', 'post-refs', 'post-refs-ok'])
    const news = await run<{ slugs: { en: { current: string } } }[]>(LLMS_NEWS_QUERY)
    expect(news.map((r) => r.slugs.en.current)).toEqual(['news-live'])
  })
})
