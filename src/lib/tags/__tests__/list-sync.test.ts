import { describe, expect, it, vi } from 'vitest'
import { appendListOps, ensureInternalTagList, planListAdditions, planTagListSync } from '../list-sync'
import { countTagsWithListed, INTERNAL_TAG_LIST_MAX } from '../internal-tags'
import { withListStore } from './fake-list-store'

const quiet = () => ({ warn: vi.fn() })

describe('planListAdditions', () => {
  it('appends new names only, ignoring case, accents and spacing (also within one call)', () => {
    expect(planListAdditions(['été', 'sea'], ['Ete', ' SEA ', 'sky', 'Sky', 'café', 'cafe'])).toEqual({ add: ['sky', 'café'], capped: false })
    expect(planListAdditions([], ['  ', 3, null])).toEqual({ add: [], capped: false })
  })
  it('stops at the cap and says so', () => {
    expect(planListAdditions(['a', 'b'], ['c', 'd', 'e'], 3)).toEqual({ add: ['c'], capped: true })
    expect(planListAdditions(['a', 'b', 'c'], ['a'], 3)).toEqual({ add: [], capped: false })
  })
})

describe('appendListOps', () => {
  it('creates the list if missing and appends without a revision guard', () => {
    const calls: unknown[] = []
    const tx = { createIfNotExists: (d: unknown) => (calls.push(['create', d]), tx), patch: (id: string, v: unknown) => (calls.push(['patch', id, v]), tx) }
    appendListOps(tx, 'amelie', 'galleries', ['trips'])
    expect(calls).toEqual([
      ['create', { _id: 'internalTagList.amelie.galleries', _type: 'internalTagList', projectSlug: 'amelie', scope: 'galleries', tags: [] }],
      ['patch', 'internalTagList.amelie.galleries', { setIfMissing: { tags: [] } }],
      ['patch', 'internalTagList.amelie.galleries', { insert: { after: 'tags[-1]', items: ['trips'] } }],
    ])
    expect(appendListOps(tx, 'amelie', 'media', [])).toBe(tx)
    expect(calls).toHaveLength(3)
  })
})

describe('planTagListSync / ensureInternalTagList', () => {
  it('a full list is not extended, the caller is not failed, and a warning is logged', async () => {
    const full = Array.from({ length: INTERNAL_TAG_LIST_MAX }, (_, i) => `t${i}`)
    const client = { fetch: vi.fn(async () => full) }
    const log = quiet()
    expect(await planTagListSync(client.fetch, 'amelie', 'media', ['new'], log)).toEqual([])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('full'), expect.objectContaining({ projectSlug: 'amelie' }))
  })
  it('a failed read or write is logged and swallowed', async () => {
    const log = quiet()
    const broken = { fetch: vi.fn(async () => Promise.reject(new Error('down'))) }
    expect(await ensureInternalTagList(broken, 'amelie', 'media', ['x'], log)).toEqual([])
    const c = { fetch: vi.fn(async () => null) }
    withListStore(c, {}, { failListCommit: true })
    await expect(ensureInternalTagList(c, 'amelie', 'media', ['x'], log)).resolves.toEqual([])
    expect(log.warn).toHaveBeenCalledTimes(2)
  })
  it('a tag whose last item drops it stays on the list, at count 0', async () => {
    const c = { fetch: vi.fn(async () => null) }
    const store = withListStore(c)
    await ensureInternalTagList(c, 'amelie', 'media', ['sea'], quiet())
    expect(store.lists.get('internalTagList.amelie.media')!.tags).toEqual(['sea'])
    // The photo loses "sea": nothing touches the list, the manager shows it unused.
    expect(countTagsWithListed([{ id: 'a', tags: [] }], store.lists.get('internalTagList.amelie.media')!.tags!)).toEqual([{ tag: 'sea', count: 0 }])
  })
})
