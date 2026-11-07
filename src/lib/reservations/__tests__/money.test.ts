import { describe, expect, it } from 'vitest'
import { assertCents, proportionalRefund, splitCents, sumCents } from '../money'

describe('assertCents / sumCents', () => {
  it('accepts integers, rejects the rest', () => {
    expect(() => assertCents(100)).not.toThrow()
    expect(() => assertCents(-5)).not.toThrow()
    for (const bad of [1.5, NaN, Infinity, '10', null, undefined, 2 ** 60]) expect(() => assertCents(bad)).toThrow()
  })
  it('sums lines incl. negative adjustments', () => {
    expect(sumCents([])).toBe(0)
    expect(sumCents([12000, 3000, -500])).toBe(14500)
    expect(() => sumCents([100, 0.5])).toThrow()
  })
})

describe('proportionalRefund', () => {
  it('is exact when divisible', () => expect(proportionalRefund(12000, 12, 3)).toBe(3000))
  it('floors the remainder', () => {
    expect(proportionalRefund(1000, 3, 1)).toBe(333)
    expect(proportionalRefund(1000, 3, 2)).toBe(666)
    expect(proportionalRefund(1, 3, 2)).toBe(0)
  })
  it('all cancelled refunds the full total; none refunds zero', () => {
    expect(proportionalRefund(1000, 3, 3)).toBe(1000)
    expect(proportionalRefund(1000, 3, 0)).toBe(0)
    expect(proportionalRefund(0, 3, 1)).toBe(0)
  })
  it('never exceeds total and handles large totals', () => {
    const big = 9_000_000_000_000
    expect(proportionalRefund(big, 7, 6)).toBeLessThanOrEqual(big)
    expect(Number.isSafeInteger(proportionalRefund(big, 7, 6))).toBe(true)
  })
  it('validates input', () => {
    expect(() => proportionalRefund(-1, 3, 1)).toThrow()
    expect(() => proportionalRefund(100, 0, 0)).toThrow()
    expect(() => proportionalRefund(100, 3, 4)).toThrow()
    expect(() => proportionalRefund(100, 3, -1)).toThrow()
    expect(() => proportionalRefund(100.5, 3, 1)).toThrow()
  })
})

describe('splitCents', () => {
  it('adds up exactly, remainder to the earliest parts', () => {
    expect(splitCents(1000, 3)).toEqual([334, 333, 333])
    expect(splitCents(2, 5)).toEqual([1, 1, 0, 0, 0])
    expect(splitCents(900, 3)).toEqual([300, 300, 300])
    expect(splitCents(12345, 7).reduce((a, b) => a + b, 0)).toBe(12345)
  })
  it('validates input', () => {
    expect(() => splitCents(100, 0)).toThrow()
    expect(() => splitCents(-1, 2)).toThrow()
  })
})
