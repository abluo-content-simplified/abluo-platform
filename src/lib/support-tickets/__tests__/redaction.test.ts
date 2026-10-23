import { describe, expect, it } from 'vitest'
import { REDACTION_MASK as M, maskRanges, normalizeRanges, segmentBody, wordRanges } from '../redaction'

describe('partial redaction', () => {
  it('masks chosen parts one-for-one and keeps spaces', () => {
    const r = maskRanges('Mario Rossi has a problem', [{ start: 0, end: 11 }])
    expect(r.body).toBe(`${M.repeat(5)} ${M.repeat(5)} has a problem`)
    expect(r.body.length).toBe('Mario Rossi has a problem'.length)
    expect(r.removed).toBe(10)
  })
  it('merges overlapping and reversed ranges, clamps out-of-bounds', () => {
    expect(normalizeRanges([{ start: 5, end: 2 }, { start: 4, end: 8 }, { start: 20, end: 99 }], 10)).toEqual([{ start: 2, end: 8 }])
  })
  it('several parts; nothing chosen changes nothing', () => {
    expect(maskRanges('ab cd ef', [{ start: 0, end: 2 }, { start: 6, end: 8 }]).body).toBe(`${M}${M} cd ${M}${M}`)
    expect(maskRanges('ab', [])).toEqual({ body: 'ab', removed: 0 })
  })
  it('segments text and masked runs for rendering', () => {
    expect(segmentBody(`Hi ${M}${M}${M}, thanks`)).toEqual([{ kind: 'text', text: 'Hi ' }, { kind: 'masked', length: 3 }, { kind: 'text', text: ', thanks' }])
    expect(segmentBody('plain')).toEqual([{ kind: 'text', text: 'plain' }])
  })
  it('word ranges for tap-to-hide', () => {
    expect(wordRanges('Hi  Mario\nRossi')).toEqual([{ start: 0, end: 2 }, { start: 4, end: 9 }, { start: 10, end: 15 }])
  })
})
