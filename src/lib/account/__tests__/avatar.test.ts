import { describe, expect, it } from 'vitest'
import { avatarObjectPath, avatarPathFromUrl, sniffImageType } from '../avatar'

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)])

describe('sniffImageType', () => {
  it('recognises jpeg, png, webp by their first bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg')
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp')
  })
  it('refuses anything else (svg, html, gif)', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(sniffImageType(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(sniffImageType(new Uint8Array())).toBeNull()
  })
})

describe('avatar paths', () => {
  const uid = 'b331865f-c7f8-4cc6-919b-0cfbf78466d2'
  it('keeps every file under the person\'s own id', () => {
    expect(avatarObjectPath(uid, 'image/webp', 42)).toBe(`${uid}/42.webp`)
  })
  it('rejects an id that could escape the folder', () => {
    expect(() => avatarObjectPath('../x', 'image/png')).toThrow()
  })
  it('only maps URLs from our own avatars bucket back to a path', () => {
    const base = 'https://abc.supabase.co'
    expect(avatarPathFromUrl(`${base}/storage/v1/object/public/avatars/${uid}/1.jpg`, base)).toBe(`${uid}/1.jpg`)
    expect(avatarPathFromUrl(`${base}/storage/v1/object/public/media/x.jpg`, base)).toBeNull()
    expect(avatarPathFromUrl('https://evil.example/avatars/x.jpg', base)).toBeNull()
  })
})
