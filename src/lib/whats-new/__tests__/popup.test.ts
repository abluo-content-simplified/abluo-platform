import { describe, expect, it } from 'vitest'
import { buildClientFeed, selectPopupUpdate, type ClientProductUpdate, type ProductUpdateRow } from '../model'

const u = (id: string, over: Partial<ClientProductUpdate> = {}): ClientProductUpdate => ({
  id,
  title: id,
  body: '',
  lang: 'en',
  imageUrl: null,
  cta: null,
  publishedAt: '2026-10-01T00:00:00Z',
  unread: true,
  popup: true,
  ...over,
})

describe('selectPopupUpdate', () => {
  it('is null when nothing is flagged, or nothing flagged is unread', () => {
    expect(selectPopupUpdate([])).toBeNull()
    expect(selectPopupUpdate([u('a', { popup: false })])).toBeNull()
    expect(selectPopupUpdate([u('a', { unread: false })])).toBeNull()
  })
  it('picks the NEWEST flagged unread update, only one', () => {
    const list = [u('old', { publishedAt: '2026-09-01T00:00:00Z' }), u('new', { publishedAt: '2026-10-20T00:00:00Z' }), u('mid', { publishedAt: '2026-10-10T00:00:00Z' })]
    expect(selectPopupUpdate(list)?.id).toBe('new')
  })
  it('ignores an unflagged newer update and a read newer flagged one', () => {
    const list = [
      u('plain-newest', { popup: false, publishedAt: '2026-10-22T00:00:00Z' }),
      u('read-newer', { unread: false, publishedAt: '2026-10-21T00:00:00Z' }),
      u('flagged', { publishedAt: '2026-10-05T00:00:00Z' }),
    ]
    expect(selectPopupUpdate(list)?.id).toBe('flagged')
  })
  it('never offers one already shown in this session', () => {
    const list = [u('a', { publishedAt: '2026-10-20T00:00:00Z' }), u('b', { publishedAt: '2026-10-10T00:00:00Z' })]
    expect(selectPopupUpdate(list, new Set(['a']))?.id).toBe('b')
    expect(selectPopupUpdate(list, new Set(['a', 'b']))).toBeNull()
  })
})

describe('buildClientFeed + popup flag (audience, unread)', () => {
  const row = (id: string, audience: unknown, published_at: string): ProductUpdateRow => ({
    id,
    slug: id,
    status: 'published',
    published_at,
    title: { en: id },
    body: {},
    image_url: null,
    cta_label: null,
    cta_url: null,
    audience,
    created_at: published_at,
    updated_at: published_at,
  })
  const rows = [
    row('everyone', {}, '2026-10-10T00:00:00Z'),
    row('events-only', { modules: ['events'] }, '2026-10-20T00:00:00Z'),
  ]
  const base = { locale: 'en', readIds: new Set<string>(), supabaseUrl: undefined, popupIds: new Set(['everyone', 'events-only']) }

  it('a flagged update outside the audience is never offered', () => {
    const feed = buildClientFeed(rows, { ...base, enabledModuleIds: ['blog'] })
    expect(selectPopupUpdate(feed)?.id).toBe('everyone')
  })
  it('inside the audience the newest flagged one wins', () => {
    const feed = buildClientFeed(rows, { ...base, enabledModuleIds: ['events'] })
    expect(selectPopupUpdate(feed)?.id).toBe('events-only')
  })
  it('once read, it is not offered again', () => {
    const feed = buildClientFeed(rows, { ...base, readIds: new Set(['events-only']), enabledModuleIds: ['events'] })
    expect(selectPopupUpdate(feed)?.id).toBe('everyone')
  })
  it('without the flag set (migration 045 not applied) there is no pop-up', () => {
    const feed = buildClientFeed(rows, { locale: 'en', readIds: new Set(), supabaseUrl: undefined, enabledModuleIds: [] })
    expect(feed.every((x) => x.popup === false)).toBe(true)
    expect(selectPopupUpdate(feed)).toBeNull()
  })
})
