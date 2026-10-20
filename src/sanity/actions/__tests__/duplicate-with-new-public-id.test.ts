import { describe, expect, it } from 'vitest'
import { duplicateDocumentBody, hasPublicIdField } from '../duplicate-with-new-public-id'

describe('Duplicate with a fresh publicId (ADR-038 D2)', () => {
  const source = {
    _id: 'drafts.e1', _rev: 'r', _createdAt: 'x', _updatedAt: 'y', _type: 'event',
    publicId: 'old', projectSlug: 'cyce', title: { en: 'Yoga' }, slug: { en: { current: 'yoga' } },
    _publishGuard: 'g', _lifecycleGuard: 'h',
  }
  it('copies the content, never the id, revision, history guards or publicId', () => {
    const body = duplicateDocumentBody(source, 'new')
    expect(body.publicId).toBe('new')
    expect(body).toMatchObject({ _type: 'event', projectSlug: 'cyce', title: { en: 'Yoga' }, slug: { en: { current: 'yoga' } } })
    for (const k of ['_id', '_rev', '_createdAt', '_updatedAt', '_publishGuard', '_lifecycleGuard']) expect(body).not.toHaveProperty(k)
  })
  it('is applied only to types that declare publicId', () => {
    expect(hasPublicIdField({ fields: [{ name: 'title' }, { name: 'publicId' }] })).toBe(true)
    expect(hasPublicIdField({ fields: [{ name: 'title' }] })).toBe(false)
    expect(hasPublicIdField(undefined)).toBe(false)
  })
})
