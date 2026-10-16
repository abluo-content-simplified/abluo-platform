import { describe, expect, it } from 'vitest'
import { readImageInfo } from '@/lib/media/image-info'
import { decideProcessing, MEDIA_POLICY } from '@/lib/media/processing-policy'

// ── Minimal headers (no pixel data — the reader never decodes) ─────────────
function jpegHeader(width: number, height: number, sof = 0xc0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]
  const frame = [0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return new Uint8Array([0xff, 0xd8, ...app0, ...dqt, ...frame, 0xff, 0xda, 0, 2])
}
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const str = (s: string) => [...s].map((c) => c.charCodeAt(0))
function pngHeader(width: number, height: number, animated = false): Uint8Array {
  const sig = [0x89, ...str('PNG'), 0x0d, 0x0a, 0x1a, 0x0a]
  const ihdr = [...be32(13), ...str('IHDR'), ...be32(width), ...be32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0]
  const actl = animated ? [...be32(8), ...str('acTL'), ...be32(2), ...be32(0), 0, 0, 0, 0] : []
  const idat = [...be32(0), ...str('IDAT'), 0, 0, 0, 0]
  return new Uint8Array([...sig, ...ihdr, ...actl, ...idat])
}
function webpVp8x(width: number, height: number, animated = false): Uint8Array {
  const b = new Uint8Array(30)
  b.set(str('RIFF'), 0)
  b.set(str('WEBP'), 8)
  b.set(str('VP8X'), 12)
  b[20] = animated ? 0x02 : 0
  const w = width - 1
  const h = height - 1
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24)
  b.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27)
  return b
}

describe('readImageInfo', () => {
  it('reads JPEG size from the frame header, skipping earlier segments', () => {
    expect(readImageInfo(jpegHeader(4032, 3024))).toEqual({ type: 'image/jpeg', width: 4032, height: 3024, animated: false })
    expect(readImageInfo(jpegHeader(2560, 1920, 0xc2))?.width).toBe(2560) // progressive
  })
  it('reads PNG size and detects APNG', () => {
    expect(readImageInfo(pngHeader(800, 600))).toEqual({ type: 'image/png', width: 800, height: 600, animated: false })
    expect(readImageInfo(pngHeader(800, 600, true))?.animated).toBe(true)
  })
  it('reads extended WebP size and the animation flag', () => {
    expect(readImageInfo(webpVp8x(1200, 900))).toEqual({ type: 'image/webp', width: 1200, height: 900, animated: false })
    expect(readImageInfo(webpVp8x(1200, 900, true))?.animated).toBe(true)
  })
  it('returns null for anything else', () => {
    expect(readImageInfo(new Uint8Array(str('GIF89a......')))).toBeNull()
    expect(readImageInfo(new Uint8Array([1, 2, 3]))).toBeNull()
  })
  it('keeps the format but no size when a JPEG header is truncated', () => {
    expect(readImageInfo(jpegHeader(100, 100).subarray(0, 30))).toEqual({ type: 'image/jpeg', width: null, height: null, animated: false })
  })
})

describe('decideProcessing', () => {
  const jpg = (w: number, h: number) => ({ type: 'image/jpeg' as const, width: w, height: h, animated: false })

  it('keeps small files (the 120 KB book cover)', () => {
    expect(decideProcessing({ bytes: 120 * 1024, info: jpg(500, 750) })).toEqual({ action: 'keep', reason: 'small' })
  })
  it('optimises the browser-prepared phone photo (measured: 1.1 MB at 2560×1920)', () => {
    expect(decideProcessing({ bytes: 1_152_162, info: jpg(2560, 1920) })).toEqual({ action: 'optimize', reason: 'heavy' })
  })
  it('keeps an already-compressed JPEG (Tinify output density)', () => {
    expect(decideProcessing({ bytes: 330_000, info: jpg(2560, 1920) })).toEqual({ action: 'keep', reason: 'already_compressed' })
  })
  it('keeps modest WebP, optimises a heavy one', () => {
    const webp = { type: 'image/webp' as const, width: 2000, height: 1500, animated: false }
    expect(decideProcessing({ bytes: 600 * 1024, info: webp }).action).toBe('keep')
    expect(decideProcessing({ bytes: 2 * 1024 * 1024, info: webp }).action).toBe('optimize')
  })
  it('never re-encodes animations', () => {
    expect(decideProcessing({ bytes: 3_000_000, info: { type: 'image/png', width: 400, height: 400, animated: true } })).toEqual({
      action: 'keep',
      reason: 'animated',
    })
  })
  it('falls back to bytes alone when the size is unreadable', () => {
    const info = { type: 'image/jpeg' as const, width: null, height: null, animated: false }
    expect(decideProcessing({ bytes: MEDIA_POLICY.unknownSizeKeepBytes, info }).action).toBe('keep')
    expect(decideProcessing({ bytes: MEDIA_POLICY.unknownSizeKeepBytes + 1, info }).action).toBe('optimize')
    expect(decideProcessing({ bytes: 2_000_000, info: null }).action).toBe('optimize')
  })
})
