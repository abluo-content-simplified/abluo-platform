import { describe, expect, it } from 'vitest'
import { sniffImage, stripMetadata } from '../image'

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length } return o }
const be32 = (n: number) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
const le32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255)
const pngChunk = (type: string, data: Uint8Array) => cat(be32(data.length), enc(type), data, Uint8Array.of(0, 0, 0, 0))
const has = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle))

const PNG_SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const png = cat(PNG_SIG, pngChunk('IHDR', cat(be32(390), be32(844), Uint8Array.of(8, 6, 0, 0, 0))), pngChunk('tEXt', enc('Author\0Mario Rossi')),
  pngChunk('eXIf', enc('GPSDATA')), pngChunk('IDAT', Uint8Array.of(1, 2, 3)), pngChunk('IEND', new Uint8Array()))

const seg = (marker: number, data: Uint8Array) => cat(Uint8Array.of(0xff, marker, ((data.length + 2) >> 8) & 255, (data.length + 2) & 255), data)
const jpg = cat(Uint8Array.of(0xff, 0xd8), seg(0xe0, enc('JFIF\0')), seg(0xe1, enc('Exif\0\0GPSDATA')), seg(0xfe, enc('comment Mario')),
  seg(0xc0, Uint8Array.of(8, 0x03, 0x4c, 0x01, 0x86, 3)), Uint8Array.of(0xff, 0xda, 0, 2), Uint8Array.of(9, 9, 9), Uint8Array.of(0xff, 0xd9))

const riffChunk = (type: string, data: Uint8Array) => cat(enc(type), le32(data.length), data, data.length % 2 ? Uint8Array.of(0) : new Uint8Array())
const vp8x = Uint8Array.of(0x0c | 0x10, 0, 0, 0, 0x85, 0x01, 0, 0x4b, 0x03, 0) // flags EXIF+XMP+alpha, 390x844
const webpBody = cat(enc('WEBP'), riffChunk('VP8X', vp8x), riffChunk('VP8L', Uint8Array.of(0x2f, 0, 0, 0, 0)), riffChunk('EXIF', enc('GPSDATA')), riffChunk('XMP ', enc('<x>Mario</x>')))
const webp = cat(enc('RIFF'), le32(webpBody.length), webpBody)

describe('sniffImage', () => {
  it('recognises by bytes, not name', () => {
    expect(sniffImage(png)).toBe('image/png')
    expect(sniffImage(jpg)).toBe('image/jpeg')
    expect(sniffImage(webp)).toBe('image/webp')
    expect(sniffImage(enc('<svg></svg>'))).toBeNull()
    expect(sniffImage(enc('%PDF-1.7'))).toBeNull()
  })
})

describe('stripMetadata (ADR-039 D10)', () => {
  it('PNG: drops text and EXIF chunks, keeps the image, reads the size', () => {
    const r = stripMetadata(png)!
    expect(r.mime).toBe('image/png')
    expect([r.width, r.height]).toEqual([390, 844])
    expect(has(r.bytes, 'GPSDATA') || has(r.bytes, 'Mario')).toBe(false)
    expect(has(r.bytes, 'IDAT') && has(r.bytes, 'IEND')).toBe(true)
  })
  it('JPEG: drops APP1 and comments, keeps the scan', () => {
    const r = stripMetadata(jpg)!
    expect([r.width, r.height]).toEqual([390, 844])
    expect(has(r.bytes, 'GPSDATA') || has(r.bytes, 'Mario')).toBe(false)
    expect(has(r.bytes, 'JFIF')).toBe(true)
    expect(r.bytes.at(-1)).toBe(0xd9)
  })
  it('WebP: drops EXIF/XMP, clears their flags, fixes the RIFF size', () => {
    const r = stripMetadata(webp)!
    expect([r.width, r.height]).toEqual([390, 844])
    expect(has(r.bytes, 'GPSDATA') || has(r.bytes, 'Mario')).toBe(false)
    const size = r.bytes[4] | (r.bytes[5] << 8) | (r.bytes[6] << 16) | (r.bytes[7] << 24)
    expect(size).toBe(r.bytes.length - 8)
    expect(r.bytes[20] & 0x0c).toBe(0)
  })
  it('refuses damaged or unknown files', () => {
    expect(stripMetadata(png.subarray(0, 30))).toBeNull()
    expect(stripMetadata(jpg.subarray(0, 10))).toBeNull()
    expect(stripMetadata(enc('GIF89a....'))).toBeNull()
  })
})
