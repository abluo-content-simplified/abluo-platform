import { describe, expect, it, vi } from 'vitest'
import { baseDocumentId, duplicatePublicIds, publicIdOwners, validateUniquePublicId, PUBLIC_ID_DUPLICATE_MESSAGE } from '../public-id'

describe('publicId ownership (ADR-038 D2)', () => {
  it('a draft, a release version and the published document are one document', () => {
    expect(baseDocumentId('drafts.abc')).toBe('abc')
    expect(baseDocumentId('versions.rel1.abc')).toBe('abc')
    expect(baseDocumentId('abc')).toBe('abc')
    expect(publicIdOwners(['abc', 'drafts.abc', 'versions.r.abc'])).toEqual(['abc'])
  })
  it('finds one publicId on two different documents', () => {
    const d = duplicatePublicIds([
      { _id: 'a', publicId: 'p1' },
      { _id: 'drafts.a', publicId: 'p1' },
      { _id: 'drafts.b', publicId: 'p1' },
      { _id: 'c', publicId: 'p2' },
      { _id: 'd' },
    ])
    expect([...d]).toEqual([['p1', ['a', 'b']]])
  })
})

describe('validateUniquePublicId (Studio)', () => {
  const ctx = (docId: string, ids: string[]) => ({
    document: { _id: docId },
    getClient: () => ({ fetch: vi.fn().mockResolvedValue(ids) }),
  })
  it('passes when only this document (and its draft) carry the id', async () => {
    expect(await validateUniquePublicId('p1', ctx('drafts.a', ['a', 'drafts.a']))).toBe(true)
  })
  it('fails on a copy that still carries its original id', async () => {
    expect(await validateUniquePublicId('p1', ctx('drafts.copy', ['a', 'drafts.copy']))).toBe(PUBLIC_ID_DUPLICATE_MESSAGE)
  })
  it('fails open when Studio cannot query (the server guard is the hard check)', async () => {
    expect(await validateUniquePublicId('p1', { document: { _id: 'a' } })).toBe(true)
    expect(await validateUniquePublicId(undefined, ctx('a', ['b']))).toBe(true)
  })
})
