/**
 * Every Media Library upload is compressed with TinyPNG before it reaches
 * Sanity (createMediaAsset → optimizeImage). Was covered through the retired
 * POST /api/media route; now tested on the helper itself. No network.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMediaAsset, type MediaAssetWriteClient } from '../create-media-asset'

function fakeClient() {
  const upload = vi.fn(async () => ({ _id: 'image-x-10x10-jpg', url: 'https://cdn/x.jpg', metadata: { dimensions: { width: 10, height: 10 } } }))
  const create = vi.fn(async (d: Record<string, unknown>) => ({ ...d, _id: 'media-1' }))
  return { client: { assets: { upload }, create } as unknown as MediaAssetWriteClient, upload, create }
}

const base = { filename: 'photo.jpg', contentType: 'image/jpeg', tenantId: 'client-a' }

describe('createMediaAsset — optimisation', () => {
  it('uploads the TinyPNG output, not the original', async () => {
    const f = fakeClient()
    const optimize = vi.fn(async () => ({ data: Buffer.from('tiny'), contentType: 'image/jpeg', optimized: true as const, bytesBefore: 12, bytesAfter: 4 }))
    await createMediaAsset(f.client, { ...base, data: Buffer.from('original-jpeg') }, { optimize, decide: () => ({ action: 'optimize', reason: 'heavy' }), log: () => {} })
    expect(optimize).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg')
    expect(f.upload).toHaveBeenCalledWith('image', Buffer.from('tiny'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
  })

  it('still uploads the original when TinyPNG is unavailable', async () => {
    const f = fakeClient()
    const optimize = vi.fn(async (data: Buffer, contentType: string) => ({
      data,
      contentType,
      optimized: false as const,
      reason: 'no_key' as const,
      bytesBefore: data.length,
      bytesAfter: data.length,
    }))
    await createMediaAsset(f.client, { ...base, filename: 'logo.png', contentType: 'image/png', data: Buffer.from('original-png') }, { optimize, decide: () => ({ action: 'optimize', reason: 'heavy' }), log: () => {} })
    expect((f.upload.mock.calls[0] as unknown[])[1]).toEqual(Buffer.from('original-png'))
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ _type: 'mediaAsset', tenant: { _type: 'reference', _ref: 'client-a' } }))
  })
})

describe('createMediaAsset — processing policy (ADR-035)', () => {
  it('stores a small image as is, without calling TinyPNG, and records why', async () => {
    const f = fakeClient()
    const optimize = vi.fn()
    const r = await createMediaAsset(f.client, { ...base, data: Buffer.from('tiny-cover') }, { optimize, log: () => {} })
    expect(optimize).not.toHaveBeenCalled()
    expect(r.optimization).toEqual({ optimized: false, reason: 'small', bytesBefore: 10, bytesAfter: 10 })
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ processing: expect.objectContaining({ status: 'ready', reason: 'small' }) }))
  })
})
