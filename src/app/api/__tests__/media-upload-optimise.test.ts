/**
 * Every Media Library upload is compressed with TinyPNG — the admin route too
 * (POST /api/media → createMediaAsset → optimizeImage). No network: the
 * optimiser and Sanity are fakes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const optimizeImage = vi.fn()
const upload = vi.fn()
const create = vi.fn()
const fetch = vi.fn()

vi.mock('@/lib/api/auth', () => ({ requireAbluoAdmin: vi.fn(async () => ({ userId: 'admin', platformRole: 'abluo_admin' })) }))
vi.mock('@/lib/sanity/server-clients', () => ({
  sanityWriteClient: { assets: { upload }, create, fetch },
  sanityServerReadClient: { fetch },
}))
vi.mock('@/lib/media/optimize-image', () => ({ optimizeImage }))

function post(file: Blob, name = 'photo.jpg') {
  const fd = new FormData()
  fd.append('file', new File([file], name, { type: file.type }))
  fd.append('tenant', 'client-a')
  fd.append('altText', 'A photo')
  return new NextRequest(new URL('/api/media', 'https://admin.abluo.app'), { method: 'POST', body: fd } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetch.mockImplementation(async (query: string) =>
    query.includes('tenantExists') ? { tenantExists: true, project: null } : { _id: 'media-1', altText: 'A photo' }
  )
  upload.mockResolvedValue({ _id: 'image-x-10x10-jpg', url: 'https://cdn/x.jpg', metadata: { dimensions: { width: 10, height: 10 } } })
  create.mockImplementation(async (d: Record<string, unknown>) => ({ ...d, _id: 'media-1' }))
})

describe('POST /api/media — optimisation', () => {
  it('uploads the TinyPNG output, not the original, and reports the saving', async () => {
    optimizeImage.mockResolvedValue({
      data: Buffer.from('tiny'),
      contentType: 'image/jpeg',
      optimized: true,
      bytesBefore: 12,
      bytesAfter: 4,
    })
    const { POST } = await import('@/app/api/media/route')
    const res = await POST(post(new Blob(['original-jpeg'], { type: 'image/jpeg' })))
    expect(res.status).toBe(201)
    expect(optimizeImage).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg')
    expect(upload).toHaveBeenCalledWith('image', Buffer.from('tiny'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect((await res.json()).optimization).toEqual({ optimized: true, bytesBefore: 12, bytesAfter: 4 })
  })

  it('still uploads the original when TinyPNG is unavailable', async () => {
    optimizeImage.mockImplementation(async (data: Buffer, contentType: string) => ({
      data,
      contentType,
      optimized: false,
      reason: 'no_key',
      bytesBefore: data.length,
      bytesAfter: data.length,
    }))
    const { POST } = await import('@/app/api/media/route')
    const res = await POST(post(new Blob(['original-png'], { type: 'image/png' }), 'logo.png'))
    expect(res.status).toBe(201)
    expect(upload.mock.calls[0][1]).toEqual(Buffer.from('original-png'))
    expect((await res.json()).optimization).toMatchObject({ optimized: false, reason: 'no_key' })
  })
})
