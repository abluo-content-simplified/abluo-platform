import { describe, expect, it } from 'vitest'
import { mergePickedFiles, pickedType } from '../pick-files'

const rules = { max: 3, maxBytes: 5_000_000, accept: ['image/png', 'image/jpeg', 'image/webp'] }
const f = (name: string, size = 100, type = 'image/png') => ({ name, size, type })

describe('mergePickedFiles', () => {
  it('keeps valid images', () => {
    const r = mergePickedFiles([], [f('a.png'), f('b.jpg', 10, 'image/jpeg')], rules)
    expect(r.files).toHaveLength(2)
    expect(r.problems).toEqual([])
  })
  it('rejects other types (HEIC, PDF) and names them', () => {
    const r = mergePickedFiles([], [f('a.heic', 10, 'image/heic'), f('b.pdf', 10, 'application/pdf')], rules)
    expect(r.files).toEqual([])
    expect(r.problems.map((p) => p.kind)).toEqual(['type', 'type'])
  })
  it('falls back on the extension when the phone gives no type', () => {
    expect(pickedType(f('IMG_1.JPG', 1, ''))).toBe('image/jpeg')
    expect(mergePickedFiles([], [f('IMG_1.jpeg', 1, '')], rules).files).toHaveLength(1)
  })
  it('rejects files over the size limit', () => {
    const r = mergePickedFiles([], [f('big.png', 5_000_001)], rules)
    expect(r.problems).toEqual([{ kind: 'size', name: 'big.png' }])
  })
  it('stops at the maximum count and keeps the earlier ones', () => {
    const r = mergePickedFiles([f('1.png'), f('2.png')], [f('3.png'), f('4.png')], rules)
    expect(r.files.map((x) => x.name)).toEqual(['1.png', '2.png', '3.png'])
    expect(r.problems).toEqual([{ kind: 'count', name: '4.png' }])
  })
  it('enforces the total ceiling', () => {
    const r = mergePickedFiles([f('1.png', 3_000)], [f('2.png', 2_000), f('3.png', 100)], { ...rules, totalBytesMax: 5_000 })
    expect(r.files.map((x) => x.name)).toEqual(['1.png', '2.png'])
    expect(r.problems).toEqual([{ kind: 'total', name: '3.png' }])
  })
})
