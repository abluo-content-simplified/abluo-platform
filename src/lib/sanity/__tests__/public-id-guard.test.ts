import { describe, expect, it } from 'vitest'
import { assertSinglePublicIdOwner } from '../public-id-guard'

const fetchOf = (rows: unknown[]) => async () => rows

describe('assertSinglePublicIdOwner (ADR-038 D2)', () => {
  it('a document and its draft are one owner', async () => {
    expect(await assertSinglePublicIdOwner(fetchOf([{ _id: 'e1', projectSlug: 'cyce' }, { _id: 'drafts.e1', projectSlug: 'cyce' }]), 'cyce', 'p')).toBe('e1')
  })
  it('two documents → ambiguous; none → not found; another project → ambiguous', async () => {
    await expect(assertSinglePublicIdOwner(fetchOf([{ _id: 'e1', projectSlug: 'cyce' }, { _id: 'drafts.copy', projectSlug: 'cyce' }]), 'cyce', 'p')).rejects.toMatchObject({ code: 'ambiguous' })
    await expect(assertSinglePublicIdOwner(fetchOf([]), 'cyce', 'p')).rejects.toMatchObject({ code: 'not_found' })
    await expect(assertSinglePublicIdOwner(fetchOf([{ _id: 'e1', projectSlug: 'livener' }]), 'cyce', 'p')).rejects.toMatchObject({ code: 'ambiguous' })
  })
})
