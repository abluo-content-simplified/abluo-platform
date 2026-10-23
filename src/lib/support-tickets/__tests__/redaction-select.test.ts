import { describe, expect, it } from 'vitest'
import { REDACTION_MASK as M } from '../redaction'
import { addRange, hiddenCount, isMaskedWord, pieces, rangeFromPoints, subtractRange, toggleRange } from '../redaction-select'

describe('redaction selection helpers', () => {
  it('maps two selection points to a range, in either direction', () => {
    expect(rangeFromPoints({ pieceStart: 0, offset: 2 }, { pieceStart: 6, offset: 3 }, 30)).toEqual({ start: 2, end: 9 })
    expect(rangeFromPoints({ pieceStart: 6, offset: 3 }, { pieceStart: 0, offset: 2 }, 30)).toEqual({ start: 2, end: 9 })
  })
  it('returns null for an empty selection and clamps to the body', () => {
    expect(rangeFromPoints({ pieceStart: 4, offset: 1 }, { pieceStart: 4, offset: 1 }, 30)).toBeNull()
    expect(rangeFromPoints({ pieceStart: 25, offset: 0 }, { pieceStart: 40, offset: 0 }, 30)).toEqual({ start: 25, end: 30 })
  })
  it('adds, merges and subtracts ranges', () => {
    const a = addRange([{ start: 0, end: 3 }], { start: 3, end: 6 }, 20)
    expect(a).toEqual([{ start: 0, end: 6 }])
    expect(subtractRange(a, { start: 2, end: 4 }, 20)).toEqual([{ start: 0, end: 2 }, { start: 4, end: 6 }])
  })
  it('toggles a word on and off', () => {
    const on = toggleRange([], { start: 6, end: 11 }, 20)
    expect(on).toEqual([{ start: 6, end: 11 }])
    expect(toggleRange(on, { start: 6, end: 11 }, 20)).toEqual([])
  })
  it('counts only characters that would really be hidden', () => {
    expect(hiddenCount(`ab cd ${M}${M}`, [{ start: 0, end: 8 }])).toBe(4)
  })
  it('knows a fully masked word', () => {
    expect(isMaskedWord(`${M}${M}${M}`, { start: 0, end: 3 })).toBe(true)
    expect(isMaskedWord(`a${M}`, { start: 0, end: 2 })).toBe(false)
  })
  it('splits a body into words and spaces with offsets', () => {
    expect(pieces('hi  you\nok')).toEqual([
      { start: 0, text: 'hi', word: true },
      { start: 2, text: '  ', word: false },
      { start: 4, text: 'you', word: true },
      { start: 7, text: '\n', word: false },
      { start: 8, text: 'ok', word: true },
    ])
  })
})
