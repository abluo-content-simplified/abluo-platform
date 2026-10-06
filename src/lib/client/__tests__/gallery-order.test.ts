import { describe, it, expect } from 'vitest'
import { dropIndex, moveByKey, moveItem, newItemKey, removeKeys } from '../gallery-order'

const items = ['a', 'b', 'c', 'd'].map((key) => ({ key }))
const keys = (xs: { key: string }[]) => xs.map((x) => x.key).join('')

describe('gallery order helpers', () => {
  it('moves items and clamps', () => {
    expect(keys(moveItem(items, 0, 2))).toBe('bcad')
    expect(keys(moveItem(items, 3, 0))).toBe('dabc')
    expect(keys(moveItem(items, 1, 99))).toBe('acdb')
    expect(keys(moveItem(items, 9, 0))).toBe('abcd')
    expect(items.map((i) => i.key).join('')).toBe('abcd') // never mutates
  })

  it('moves by key one step, staying in bounds', () => {
    expect(keys(moveByKey(items, 'b', -1))).toBe('bacd')
    expect(keys(moveByKey(items, 'a', -1))).toBe('abcd')
    expect(keys(moveByKey(items, 'd', 1))).toBe('abcd')
    expect(keys(moveByKey(items, 'zz', 1))).toBe('abcd')
  })

  it('removes selected keys', () => {
    expect(keys(removeKeys(items, ['b', 'd']))).toBe('ac')
  })

  it('finds the nearest tile for a drop', () => {
    const rects = [
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 110, top: 0, width: 100, height: 100 },
      { left: 0, top: 110, width: 100, height: 100 },
    ]
    expect(dropIndex(rects, 150, 40)).toBe(1)
    expect(dropIndex(rects, 20, 190)).toBe(2)
    expect(dropIndex([], 0, 0)).toBe(-1)
  })

  it('makes keys the server accepts, never reusing one', () => {
    let n = 0
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    const k1 = newItemKey([], () => seq[n++ % seq.length])
    expect(k1).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    n = 0
    const k2 = newItemKey([k1], () => seq[n++ % seq.length])
    expect(k2).not.toBe(k1)
  })
})
