import { describe, expect, it } from 'vitest'
import { SANITY_MUTATION_MAX_BYTES, SANITY_MUTATION_SAFETY_MARGIN, checkMutationSize, estimateMutationBytes } from '../limits'

describe('Sanity mutation payload limit (C6 §6.11, REVIEW-step3 C-13)', () => {
  it('is the one named 4 MB constant with a 20 % margin', () => {
    expect(SANITY_MUTATION_MAX_BYTES).toBe(4_000_000)
    expect(SANITY_MUTATION_SAFETY_MARGIN).toBe(0.2)
    expect(checkMutationSize(3_200_000)).toEqual({ bytes: 3_200_000, limit: 4_000_000, budget: 3_200_000, fits: true })
    expect(checkMutationSize(3_200_001).fits).toBe(false)
  })

  it('estimates the UTF-8 request body, multi-byte characters included', () => {
    const m = [{ createOrReplace: { _id: 'a', _type: 't', name: { it: 'Menù' } } }]
    expect(estimateMutationBytes(m)).toBe(new TextEncoder().encode(JSON.stringify({ mutations: m })).length)
    expect(estimateMutationBytes(m)).toBe(JSON.stringify({ mutations: m }).length + 1) // ù is two bytes
  })

  it('B-05 support: tests inject a small limit', () => {
    const bytes = estimateMutationBytes(Array.from({ length: 60 }, (_, i) => ({ patch: { id: `d${i}`, set: { x: 'y'.repeat(50) } } })))
    expect(checkMutationSize(bytes, { limit: 1000 }).fits).toBe(false)
    expect(checkMutationSize(bytes).fits).toBe(true)
    expect(checkMutationSize(Number.NaN).fits).toBe(false)
  })
})
