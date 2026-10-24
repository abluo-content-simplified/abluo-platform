/**
 * The internal tag lists backfill planner (scripts/lib/internal-tag-lists-backfill.mjs):
 * which tags items carry that their project's list lacks, and the exact
 * mutations --apply would send. No network.
 */
import { describe, expect, it } from 'vitest'
import {
  backfillMutations,
  INTERNAL_TAG_LIST_MAX as PORTED_MAX,
  listIdFor,
  planTagListBackfill,
  tagMatchKey as portedKey,
  usedTags,
} from '../lib/internal-tag-lists-backfill.mjs'
import { INTERNAL_TAG_LIST_MAX, internalTagListId, tagMatchKey } from '@/lib/tags/internal-tags'

const photo = (id: string, tags: string[], projectSlug = 'amelie') => ({ _id: id, _type: 'mediaAsset', projectSlug, tags })
const gallery = (id: string, tags: string[]) => ({ _id: id, _type: 'gallery', projectSlug: 'amelie', tags })

describe('port parity with src/lib/tags/internal-tags.ts', () => {
  it('same match key, id and cap', () => {
    for (const s of ['Été', '  Café   Bar ', 'ÅNGSTRÖM', 'tag 2']) expect(portedKey(s)).toBe(tagMatchKey(s))
    expect(listIdFor('amelie', 'media')).toBe(internalTagListId('amelie', 'media'))
    expect(listIdFor('a.b', 'media')).toBeNull()
    expect(PORTED_MAX).toBe(INTERNAL_TAG_LIST_MAX)
  })
})

describe('usedTags', () => {
  it('most used first; photos published only, galleries with drafts; each key once', () => {
    const items = [photo('p1', ['sea', 'été']), photo('p2', ['sea', 'ete']), photo('drafts.p3', ['draft-only']), photo('versions.x.p4', ['release'])]
    expect(usedTags(items, 'media')).toEqual(['sea', 'ete'])
    expect(usedTags([gallery('g1', ['trips']), gallery('drafts.g2', ['walks'])], 'galleries')).toEqual(['trips', 'walks'])
  })
})

describe('planTagListBackfill (dry run)', () => {
  it('plans new lists for both scopes and patches for an existing one, never duplicating a key', () => {
    const plan = planTagListBackfill({
      projectSlug: 'amelie',
      items: [photo('p1', ['sea', 'Été']), gallery('g1', ['trips'])],
      lists: [{ _id: 'internalTagList.amelie.media', _rev: 'r1', projectSlug: 'amelie', tags: ['ete', 'moon'] }],
    })
    expect(plan.scopes).toEqual([
      { scope: 'media', listId: 'internalTagList.amelie.media', existing: ['ete', 'moon'], add: ['sea'], capped: false, create: false, rev: 'r1' },
      { scope: 'galleries', listId: 'internalTagList.amelie.galleries', existing: [], add: ['trips'], capped: false, create: true, rev: null },
    ])
    expect(backfillMutations(plan)).toEqual([
      { patch: { id: 'internalTagList.amelie.media', ifRevisionID: 'r1', set: { tags: ['ete', 'moon', 'sea'] } } },
      { create: { _id: 'internalTagList.amelie.galleries', _type: 'internalTagList', projectSlug: 'amelie', scope: 'galleries', tags: ['trips'] } },
    ])
  })

  it('nothing to do when every used tag is listed (idempotent re-run)', () => {
    const plan = planTagListBackfill({ projectSlug: 'amelie', items: [photo('p1', ['sea'])], lists: [{ _id: 'internalTagList.amelie.media', _rev: 'r', projectSlug: 'amelie', tags: ['SEA'] }] })
    expect(backfillMutations(plan)).toEqual([])
  })

  it('ignores another project’s items and lists', () => {
    const plan = planTagListBackfill({
      projectSlug: 'amelie',
      items: [photo('p1', ['mine']), photo('p9', ['theirs'], 'other')].filter((i) => i.projectSlug === 'amelie'),
      lists: [{ _id: 'internalTagList.amelie.media', _rev: 'x', projectSlug: 'other', tags: ['mine'] }],
    })
    expect(plan.scopes[0]).toMatchObject({ add: ['mine'], create: true })
  })

  it('stops at the cap, most used first', () => {
    const full = Array.from({ length: INTERNAL_TAG_LIST_MAX - 1 }, (_, i) => `t${i}`)
    const plan = planTagListBackfill({
      projectSlug: 'amelie',
      items: [photo('p1', ['rare', 'common']), photo('p2', ['common'])],
      lists: [{ _id: 'internalTagList.amelie.media', _rev: 'r', projectSlug: 'amelie', tags: full }],
    })
    expect(plan.scopes[0]).toMatchObject({ add: ['common'], capped: true })
  })

  it('a slug that cannot form a safe id is blocked, not written', () => {
    const plan = planTagListBackfill({ projectSlug: 'Bad.Slug', items: [photo('p1', ['x'], 'Bad.Slug')], lists: [] })
    expect(plan.scopes.every((s) => s.blocked)).toBe(true)
    expect(backfillMutations(plan)).toEqual([])
  })
})
